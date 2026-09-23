// Extracts readable text from the SIH requirement PDF (FlateDecode + Identity-H fonts).
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, inflateRawSync } from 'node:zlib'

const SRC = 'C:/Users/DELL/Downloads/prooo sih prompt.pdf'
const OUT = new URL('./prooo-extracted.txt', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const buf = readFileSync(SRC)
const raw = buf.toString('latin1')

/* ------------------------------------------------ collect raw objects */
const objects = new Map() // num -> {dictStart, headStart, tailEnd}
for (const match of raw.matchAll(/(\d+)\s+0\s+obj\b/g)) {
  const num = Number(match[1])
  const dictStart = match.index
  const streamIdx = raw.indexOf('stream', match.index)
  const endObj = raw.indexOf('endobj', match.index)
  const isStream = streamIdx !== -1 && streamIdx < endObj && /stream\s*(\r?\n)/.test(raw.slice(streamIdx, streamIdx + 10))
  let headStart = -1, tailEnd = -1
  if (isStream) {
    headStart = streamIdx + 6
    while (raw[headStart] === '\r' || raw[headStart] === '\n') headStart++
    tailEnd = raw.indexOf('endstream', headStart)
  }
  objects.set(num, { dictStart, headStart, tailEnd })
}

function inflateObject(num) {
  const o = objects.get(num)
  if (!o || o.headStart === -1) return null
  try { return inflateSync(buf.subarray(o.headStart, o.tailEnd)).toString('latin1') }
  catch { try { return inflateRawSync(buf.subarray(o.headStart, o.tailEnd)).toString('latin1') } catch { return null } }
}

/* ------------------------------------------- ToUnicode CMaps per font */
function parseCmap(text) {
  const map = new Map()
  for (const m of text.matchAll(/beginbfchar\s*([^e]*?)\s*endbfchar/g)) {
    for (const e of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const dst = e[2].replace(/([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      map.set(parseInt(e[1], 16), dst)
    }
  }
  for (const m of text.matchAll(/beginbfrange\s*([^e]*?)\s*endbfrange/g)) {
    for (const e of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[)/g)) {
      const lo = parseInt(e[1], 16), hi = parseInt(e[2], 16)
      if (e[4] !== undefined) {
        const base = parseInt(e[4], 16)
        for (let i = 0; i <= hi - lo; i++) map.set(lo + i, String.fromCharCode(base + i))
      } else {
        // array form follows the [ token; take following hex triplets until ]
        const seg = m[1].slice(e.index)
        const list = [...seg.matchAll(/<([0-9A-Fa-f]{4})>/g)].slice(0, hi - lo + 1)
        list.forEach((x, i) => map.set(lo + i, String.fromCharCode(parseInt(x[1], 16))))
      }
    }
  }
  return map
}

/* ------------------------------------------- Global merged CID→Unicode */
const GLOBAL_CMAP = new Map()
let cmapStreams = 0
for (const [num] of objects) {
  const txt = inflateObject(num)
  if (!txt || !txt.includes('beginbfchar')) continue
  const local = parseCmap(txt)
  if (local.size === 0) continue
  cmapStreams++
  // Word assigns glyph ids doc-wide in first-use order across subsets, so
  // FIRST definition wins; later subset tables only extend coverage.
  for (const [cid, uni] of local) if (!GLOBAL_CMAP.has(cid)) GLOBAL_CMAP.set(cid, uni)
}
console.log(`cmap streams merged: ${cmapStreams}, total entries: ${GLOBAL_CMAP.size}`)
const fontCmaps = new Map() // every font resolves to the shared merged table


/* ------------------------------- pages -> contents + local font names */
const decodeString = (bytesLatin1, cmap) => {
  let out = ''
  for (let i = 0; i + 1 < bytesLatin1.length; i += 2) {
    const cid = (bytesLatin1.charCodeAt(i) << 8) | bytesLatin1.charCodeAt(i + 1)
    out += cmap?.get(cid) ?? ''
  }
  return out
}
// Escape-aware PDF string reader at index i (buf.charAt(i) must be '(')
const readPdfString = (text, i) => {
  let depth = 1, j = i + 1, out = ''
  while (j < text.length && depth > 0) {
    const ch = text[j]
    if (ch === '\\') { out += text[j + 1] ?? ''; j += 2; continue }
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (!depth) break }
    out += ch; j++
  }
  return out.slice(0) // includes escapes resolved naively
}

let result = []
for (const [num, o] of objects) {
  const dictEnd = o.headStart === -1 ? raw.length : o.headStart
  const body = raw.slice(o.dictStart, Math.min(dictEnd, o.dictStart + 1600))
  if (!/\/Type\s*\/Page\b/.test(body)) continue
  const cm = body.match(/\/Contents\s+(\d+)\s+0\s+R/)
  if (!cm) continue
  const fontRes = {}
  const fontBlock = body.match(/\/Font\s*<<(.*?)>>/s)?.[1] ?? ''
  for (const f of fontBlock.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) fontRes[f[1]] = Number(f[2])
  const content = inflateObject(Number(cm[1]))
  if (!content) continue

  let line = '', cidMode = false, curFontObj = 0
  const emitLine = () => { if (line.trim()) result.push(line.trim()); line = '' }

  for (let i = 0; i < content.length; i++) {
    const tok = content[i]
    if (tok === '/' && content[i - 1] !== '#') {
      const fm = content.slice(i, i + 24).match(/^(F\d+)\s+[\d.]+\s+Tf/)
      if (fm) { curFontObj = fontRes[fm[1]]; cidMode = true; continue }
      continue
    }
    // Hex string form: <004A0052...> or inside [ ... ] TJ
    if (tok === '<' && /[0-9A-Fa-f\s]/.test(content[i + 1] ?? '')) {
      const end = content.indexOf('>', i)
      if (end === -1) continue
      const hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, '')
      const cmap = GLOBAL_CMAP
      if (hex.length % 4 === 0 && hex.length >= 4) {
        for (let h = 0; h < hex.length; h += 4) {
          const cid = parseInt(hex.slice(h, h + 4), 16)
          line += cmap?.get(cid) ?? (cid > 31 && cid < 127 ? String.fromCharCode(cid) : '')
        }
        i = end
        continue
      }
    }
    if (tok === '(' && cidMode) {
      const str = readPdfString(content, i)
      line += decodeString(str, GLOBAL_CMAP)
      i += str.length + 1
      continue
    }
    if (tok === '(' && !cidMode) {
      const str = readPdfString(content, i)
      line += str.replace(/\\([()\\])/g, '$1')
      i += str.length + 1
      continue
    }
    if (tok === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D')) { emitLine(); continue }
    if (tok === 'E' && content[i + 1] === 'T') { emitLine(); continue }
  }
  emitLine()
}

writeFileSync('C:/Users/DELL/Downloads/SIH/scripts/prooo-extracted.txt', result.join('\n'), 'utf8')
console.log('Extracted lines:', result.length)
