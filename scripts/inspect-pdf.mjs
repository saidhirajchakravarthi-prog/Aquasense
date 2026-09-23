// Read-only structural inspection of the CGWB PDFs (no writes, no DB access).
import { readFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) { console.error('usage: node scripts/inspect-pdf.mjs <file>'); process.exit(1) }
const buf = readFileSync(target)
const raw = buf.toString('latin1')

console.log('==== FILE ====', target, 'size', buf.length)

const filters = new Map()
for (const m of raw.matchAll(/\/Filter\s*\/([A-Za-z0-9]+)/g)) filters.set(m[1], (filters.get(m[1]) ?? 0) + 1)
console.log('filters:', JSON.stringify(Object.fromEntries(filters)))

const pages = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length
console.log('pages:', pages)

// Fonts: find all /Font dictionaries and their ToUnicode CMaps
const fonts = new Map()
for (const m of raw.matchAll(/(\d+)\s+0\s+obj\s*<<([^]*?)>>\s*endobj/g)) {
  const num = Number(m[1]), body = m[2]
  if (!/\/Font/.test(body) && !/\/Subtype\s*\//.test(body)) continue
  if (/\/FontDescriptor/.test(body) || /\/ToUnicode/.test(body)) {
    const base = body.match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/)?.[1] ?? '?'
    const enc = body.match(/\/Encoding\s*\/([A-Za-z0-9]+)/)?.[1] ?? 'none'
    const toU = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)?.[1]
    const diff = body.match(/\/Differences\s*\[([^]*?)\]/)?.[1] ?? null
    fonts.set(num, { base, enc, toU: toU ? Number(toU) : null, diff })
  }
}
console.log('font objs:', JSON.stringify(Object.fromEntries(fonts), null, 1))

// ToUnicode CMaps: extract the actual beginbfchar ranges
const cmaps = new Map()
for (const m of raw.matchAll(/(\d+)\s+0\s+obj\s*<<([^]*?)>>stream\s*([^]*?)endstream/g)) {
  const body = m[2], stream = m[3]
  if (/beginbfchar|begincidrange/.test(stream)) {
    const chars = [...stream.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)]
    if (chars.length > 0) cmaps.set(Number(m[1]), chars.slice(0, 8).map(c => `${c[1]}->${c[2]}`))
  }
}
console.log('cmaps (sample):', JSON.stringify(Object.fromEntries(cmaps), null, 1))

// Streams: count inflated-able, sample sizes
let inflatedOk = 0, inflatedFail = 0
for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
  const idx = m.index
  const si = raw.indexOf('stream', idx)
  const ei = raw.indexOf('endobj', idx)
  if (si === -1 || si > ei) continue
  let hs = si + 6
  while (raw[hs] === '\r' || raw[hs] === '\n') hs++
  const ts = raw.indexOf('endstream', hs)
  if (ts === -1) continue
  try {
    const { inflateSync } = await import('node:zlib')
    const dec = inflateSync(buf.subarray(hs, ts))
    inflatedOk++
    const head = dec.toString('latin1').slice(0, 80)
    if (/Tj|TJ|BT|ET|Tm/.test(head)) { if (!globalThis.__contentSeen) { globalThis.__contentSeen = 1; console.log('first content stream sample:\n', head) } }
  } catch { inflatedFail++ }
}
console.log('streams inflated ok/fail:', inflatedOk, inflatedFail)

// Extract ALL text by inflating streams and parsing BT...ET text blocks
const { inflateSync } = await import('node:zlib')
function extractText(streamBuf) {
  const s = streamBuf.toString('latin1')
  const out = []
  // Split into BT...ET blocks
  const blocks = s.split('BT')
  for (let bi = 1; bi < blocks.length; bi++) {
    const b = blocks[bi]
    const etIdx = b.indexOf('ET')
    const block = etIdx >= 0 ? b.slice(0, etIdx) : b
    // Extract strings from Tj and TJ operators
    for (const m of block.matchAll(/\(([^]*?)\)\s*Tg?/g)) {}
    for (const sm of block.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g)) {
      out.push(sm[1])
    }
    for (const sm of block.matchAll(/\[([^]*?)\]\s*TJ/g)) {
      for (const str of sm[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)) out.push(str[1])
    }
  }
  return out
}

let textBlocks = 0, totalStrings = 0
const allText = []
for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
  const idx = m.index
  const si = raw.indexOf('stream', idx)
  const ei = raw.indexOf('endobj', idx)
  if (si === -1 || si > ei) continue
  let hs = si + 6
  while (raw[hs] === '\r' || raw[hs] === '\n') hs++
  const ts = raw.indexOf('endstream', hs)
  if (ts === -1) continue
  try {
    const dec = inflateSync(buf.subarray(hs, ts))
    const strings = extractText(dec)
    if (strings.length > 0) {
      textBlocks++
      totalStrings += strings.length
      if (allText.length < 200) allText.push(...strings.map(s => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1')))
    }
  } catch {}
}
console.log('text blocks:', textBlocks, 'total strings:', totalStrings)

// Position-aware extraction: capture (x,y,text) using Tm operator + font size
function extractPositioned(streamBuf) {
  const s = streamBuf.toString('latin1')
  const items = []
  // Current text matrix tracking
  let tx = 0, ty = 0
  const lines = s.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    // Tm: "a b c d e f Tm" — for tables typically "0 1 -1 0 x y Tm" or "sx 0 0 sy x y Tm"
    const tm = line.match(/^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+Tm$/)
    if (tm) {
      const e = parseFloat(tm[5]), f = parseFloat(tm[6])
      tx = e; ty = f
    }
    // Td/TD movement
    const td = line.match(/^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+T[dD]$/)
    if (td) { tx += parseFloat(td[1]); ty += parseFloat(td[2]) }
    // Text showing
    const tj = line.match(/^\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj$/)
    if (tj && tx > -500 && ty > -500) {
      items.push({ x: Math.round(tx * 100) / 100, y: Math.round(ty * 100) / 100, t: tj[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1') })
    }
    const tj2 = line.match(/^\[([^\]]*)\]\s*TJ$/)
    if (tj2) {
      for (const str of tj2[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)) {
        items.push({ x: Math.round(tx * 100) / 100, y: Math.round(ty * 100) / 100, t: str[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1') })
      }
    }
    i++
  }
  return items
}

// Find page content streams — map page object to its content stream(s)
// Simpler: just extract positioned text from ALL streams and cluster by y
const positioned = []
for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
  const idx = m.index
  const si = raw.indexOf('stream', idx)
  const ei = raw.indexOf('endobj', idx)
  if (si === -1 || si > ei) continue
  let hs = si + 6
  while (raw[hs] === '\r' || raw[hs] === '\n') hs++
  const ts = raw.indexOf('endstream', hs)
  if (ts === -1) continue
  try {
    const dec = inflateSync(buf.subarray(hs, ts))
    const items = extractPositioned(dec)
    if (items.length > 0) positioned.push(...items)
  } catch {}
}
console.log('positioned items:', positioned.length)

// Cluster by y (round to nearest 3px) and sort by x to reconstruct rows
const rows = new Map()
for (const it of positioned) {
  const yk = Math.round(it.y / 3) * 3
  if (!rows.has(yk)) rows.set(yk, [])
  rows.get(yk).push(it)
}
const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0])
console.log('distinct y-rows:', sortedRows.length)

// Print first 25 rows (top of document)
console.log('--- FIRST 25 POSITIONED ROWS ---')
for (const [y, items] of sortedRows.slice(0, 25)) {
  const cells = items.sort((a, b) => a.x - b.x).map(c => `[${c.x}]${c.t}`).join(' | ')
  console.log(`y=${y}: ${cells}`)
}