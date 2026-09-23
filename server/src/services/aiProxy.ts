/**
 * Server-side AI proxy.
 *
 * Secrets (GEMINI_API_KEY) live ONLY here — never in the browser bundle.
 * When no key is configured we return a deterministic rule-based assessment,
 * so the dashboard remains fully demonstrable offline and never fails.
 *
 * IMPORTANT safety rule (project requirement): the assistant NEVER claims the
 * water is definitely safe for drinking based only on temperature, turbidity,
 * pH and TDS. Microbiological / additional chemical-testing caveats are always
 * included.
 */

type Status = 'GOOD' | 'MODERATE' | 'POOR' | 'CRITICAL'
type Risk = 'LOW' | 'MEDIUM' | 'HIGH'

interface InputShape {
  current?: Record<string, unknown> | null
  history?: Array<Record<string, unknown>> | null
  thresholds?: Record<string, unknown> | null
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

function buildResult(input: InputShape): {
  status: Status; risk: Risk; score: number; analysis: string; recommendation: string;
  confidence: number; detectedIssues: string[]; trends: string[]; limitations: string[];
  simpleExplanation: string; engine: string;
} {
  const c = input.current ?? {}
  const t = input.thresholds ?? {}
  const tur = num(c.turbidity), ph = num(c.ph), tds = num(c.tds)

  const issues: string[] = []
  if (tur !== null && num(t.turbidityCritical) !== null && tur > (t.turbidityCritical as number))
    issues.push(`Turbidity ${tur} NTU exceeds the critical monitoring level (${t.turbidityCritical} NTU)`)
  else if (tur !== null && num(t.turbidityWarning) !== null && tur > (t.turbidityWarning as number))
    issues.push(`Turbidity ${tur} NTU is above the warning level (${t.turbidityWarning} NTU)`)
  if (ph !== null && num(t.phMin) !== null && num(t.phMax) !== null && (ph < (t.phMin as number) || ph > (t.phMax as number)))
    issues.push(`pH ${ph} is outside the configured monitoring range (${t.phMin}–${t.phMax})`)
  if (tds !== null && num(t.tdsCritical) !== null && tds > (t.tdsCritical as number))
    issues.push(`TDS ${tds} ppm exceeds the critical monitoring level (${t.tdsCritical} ppm)`)
  else if (tds !== null && num(t.tdsWarning) !== null && tds > (t.tdsWarning as number))
    issues.push(`TDS ${tds} ppm is above the warning level (${t.tdsWarning} ppm)`)

  const warnings = issues.filter((i) => !i.toLowerCase().includes('critical')).length
  const critical = issues.filter((i) => i.toLowerCase().includes('critical')).length
  const score = Math.max(0, 100 - critical * 55 - warnings * 18)
  const status: Status = critical > 0 ? 'CRITICAL' : warnings > 1 ? 'POOR' : warnings === 1 ? 'MODERATE' : 'GOOD'
  const risk: Risk = critical > 0 ? 'HIGH' : warnings > 0 ? 'MEDIUM' : 'LOW'

  const trends: string[] = []
  const hist = input.history ?? []
  const detect = (key: 'turbidity' | 'tds' | 'temperature', unit: string) => {
    const series = hist
      .map((h) => ({ v: num(h[key]), ts: num(h.timestamp) ?? 0 }))
      .filter((x): x is { v: number; ts: number } => x.v !== null)
      .sort((a, b) => a.ts - b.ts)
    if (series.length < 4) return
    const baseline = series.slice(Math.max(0, series.length - 5), series.length - 1)
    const avg = baseline.reduce((s, x) => s + x.v, 0) / Math.max(1, baseline.length)
    const last = series[series.length - 1].v
    const factor = (t.suddenChangeFactor as number) || 3
    if (avg !== 0 && Math.abs(last - avg) >= Math.abs(avg) * factor && Math.abs(last - avg) > 2)
      trends.push(`${key} changed significantly vs the recent baseline (${avg.toFixed(1)} → ${last}${unit ? ' ' + unit : ''})`)
  }
  detect('turbidity', 'NTU'); detect('tds', 'ppm'); detect('temperature', '°C')

  const analysis = issues.length
    ? `${issues.join('. ')}. Based on configured monitoring thresholds only.`
    : 'Current monitored parameters are within the configured monitoring ranges.'
  const recommendation = issues.length
    ? 'Review the affected parameters, repeat manual tests where applicable, and continue normal filtration until values recover.'
    : 'Continue normal filtration and re-test periodically.'
  const limitations = [
    'These sensors (DS18B20, turbidity) plus manual pH/TDS do NOT certify drinking-water safety.',
    'Microbiological and additional chemical testing may be required to establish potability.',
  ]

  return {
    status, risk, score, analysis, recommendation,
    confidence: Math.max(35, Math.min(95,
      55 + (num(c.temperature) !== null ? 8 : 0) + (num(c.turbidity) !== null ? 8 : 0)
      + (num(c.ph) !== null ? 6 : 0) + (num(c.tds) !== null ? 6 : 0))),
    detectedIssues: issues, trends, limitations,
    simpleExplanation: issues.length
      ? `Some values are higher than normal (${issues.join('; ')}). Keep purifying and re-test shortly. This dashboard does not certify the water as safe.`
      : 'Your tested water values are inside normal monitoring ranges today. This dashboard does not certify drinking-water safety.',
    engine: 'RULE_BASED',
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

/** Primary entry: LLM when a key exists, deterministic fallback otherwise. */
export async function analyzeReading(input: InputShape): Promise<ReturnType<typeof buildResult>> {
  const fallback = buildResult(input)
  const key = process.env.GEMINI_API_KEY
  if (!key) return fallback

  const prompt = `You are the Smart Water Quality Assistant. Answer in JSON ONLY with this shape:
{"status":"GOOD|MODERATE|POOR|CRITICAL","risk":"LOW|MEDIUM|HIGH","score":0-100,"analysis":"...","recommendation":"...","confidence":0-100,"detectedIssues":[],"trends":[],"simpleExplanation":"plain words for rural/non-technical users"}

Apply the configured monitoring thresholds. Keep units (°C, NTU, ppm). NEVER claim the water is definitely safe to drink — state that microbiological and additional chemical testing may be required. Water data JSON:
${JSON.stringify(input)}`

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    if (!response.ok) return fallback
    const json = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return fallback
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return fallback
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<ReturnType<typeof buildResult>>
    if (!parsed.status || typeof parsed.score !== 'number') return fallback
    return {
      ...fallback,
      status: parsed.status, risk: parsed.risk ?? fallback.risk,
      score: Math.max(0, Math.min(100, parsed.score)),
      analysis: parsed.analysis ?? fallback.analysis,
      recommendation: parsed.recommendation ?? fallback.recommendation,
      confidence: parsed.confidence ?? fallback.confidence,
      detectedIssues: parsed.detectedIssues ?? fallback.detectedIssues,
      trends: parsed.trends ?? fallback.trends,
      simpleExplanation: parsed.simpleExplanation ?? fallback.simpleExplanation,
      engine: 'GEMINI',
    }
  } catch {
    return fallback
  }
}