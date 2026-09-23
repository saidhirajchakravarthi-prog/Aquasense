/**
 * AI Decision Engine (Phase 4, Part B).
 *
 * Layer 1 (always on): deterministic decision synthesis over the Phase-3
 *   analysis object — every conclusion cites database evidence.
 * Layer 2 (optional): Gemini 2.0 Flash refines wording/decision ONLY within
 *   the allowed decision set and can NEVER override a hard-breach PURIFY /
 *   CHANGE_TREATMENT; any deviation or failure falls back to Layer 1.
 * The deterministic analysis is never replaced. The engine is labelled
 * honestly: 'RULE_BASED' (no key configured) or 'GEMINI' (LLM refinement).
 */
import type { Pool } from 'pg'
import { analyzeWaterQuality } from './waterQualityEngine.js'
import { buildTreatmentRecommendation } from './treatmentRecommendation.js'

export type Decision = 'PURIFY' | 'DO_NOT_PURIFY' | 'RETEST' | 'ADDITIONAL_TEST_REQUIRED' | 'CHANGE_TREATMENT' | 'INSUFFICIENT_EVIDENCE'

export interface WaterQualityDecision {
  decision: Decision
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  currentCondition: string
  detectedProblems: string[]
  missingEvidence: string[]
  recommendedAction: string
  additionalTests: string[]
  reasoning: string[]
  evidence: Array<{ parameter: string; value: number | null; status: string; standard: string }>
  engine: 'RULE_BASED' | 'GEMINI'
  analysisTimestamp: string
  caveat: string
  /** Optional interpretation from the Python AI engine (AI_ENGINE_URL). NEVER changes the decision. */
  aiInterpretation?: { engine: string; currentCondition: unknown; detectedProblems: unknown; evidenceSufficiency: unknown; recommendedActionSupport: unknown; caveat: string }
  aiInterpretationError?: string
  treatmentRecommendation: ReturnType<typeof buildTreatmentRecommendation>
}

const DECISIONS: Decision[] = ['PURIFY', 'DO_NOT_PURIFY', 'RETEST', 'ADDITIONAL_TEST_REQUIRED', 'CHANGE_TREATMENT', 'INSUFFICIENT_EVIDENCE']
const PRIORITY_TESTS = ['e_coli', 'total_coliform', 'fluoride', 'arsenic', 'nitrate', 'iron']
const stdLabel = (a: { standard: { kind: string; referenceSource: string } | null }): string =>
  a.standard ? `${a.standard.kind} — ${a.standard.referenceSource}` : 'NO_STANDARD_AVAILABLE'
const trace = (a: { parameter: string; value: number | null; status: string; standard: { kind: string; referenceSource: string } | null }) => ({
  parameter: a.parameter, value: a.value, status: a.status, standard: stdLabel(a),
})

export function synthesizeDecision(analysis: NonNullable<Awaited<ReturnType<typeof analyzeWaterQuality>>>): WaterQualityDecision {
  const problems = analysis.measurements.filter(
    (a) => a.status === 'ABOVE_PERMISSIBLE' || a.status === 'ABOVE_ACCEPTABLE' || a.status === 'BELOW_LIMIT',
  )
  const missing = analysis.notMeasured
  const additionalTests: string[] = []
  const reasoning: string[] = []
  const detectedProblems = problems.map(
    (a) => `${a.displayName} = ${a.value}${a.unit ? ' ' + a.unit : ''} — ${a.status}: ${a.explanation}`,
  )
  for (const a of analysis.measurements)
    reasoning.push(`${a.displayName} = ${a.value}${a.unit ? ' ' + a.unit : ''} — ${a.status} against ${stdLabel(a)}.`)
  for (const a of missing)
    reasoning.push(`${a.displayName}: NOT MEASURED — no current measurement exists; it is excluded from any "safe" judgement.`)

  const hard = problems.filter((a) => a.status === 'ABOVE_PERMISSIBLE' || a.status === 'BELOW_LIMIT')
  const soft = problems.filter((a) => a.status === 'ABOVE_ACCEPTABLE')
  const addPriorityTests = () => {
    for (const code of PRIORITY_TESTS) {
      const n = missing.find((m) => m.parameter === code)
      if (n && !additionalTests.includes(n.displayName)) additionalTests.push(n.displayName)
    }
    for (const n of missing) if (!additionalTests.includes(n.displayName)) additionalTests.push(n.displayName)
  }

  let decision: Decision
  let recommendedAction: string
  if (analysis.overall.status === 'NO_DATA') {
    decision = 'INSUFFICIENT_EVIDENCE'
    recommendedAction = 'No measurements exist for this water source. Record ESP32 and manual measurements first — nothing can be decided without data.'
    reasoning.push('The analysis contains zero measurements, so no evidence-based action is possible.')
  } else if (hard.length > 0) {
    const chlorineLow = hard.find((a) => a.parameter === 'residual_chlorine')
    if (chlorineLow) {
      decision = 'CHANGE_TREATMENT'
      recommendedAction = `Disinfection appears inadequate: residual free chlorine is ${chlorineLow.value} ${chlorineLow.unit ?? ''}, below the 0.2 mg/L desirable minimum (IS 10500:2012). Adjust the disinfection/chlorination process and retest.`
      reasoning.push('Residual free chlorine below the desirable minimum indicates disinfection is inadequate — a treatment-process change is indicated before consumption.')
    } else {
      decision = 'PURIFY'
      recommendedAction = `Purification is justified: ${hard.map((a) => `${a.displayName} ${a.value}${a.unit ? ' ' + a.unit : ''} (${a.status})`).join('; ')}. Retest after treatment to confirm recovery.`
      reasoning.push('At least one parameter exceeds its permissible limit (or an acceptable minimum with no relaxation) — treatment is justified by the registered standard.')
    }
    for (const a of hard) reasoning.push(`${a.displayName}: ${a.explanation}`)
    addPriorityTests()
    if (missing.some((m) => m.parameter === 'e_coli' || m.parameter === 'total_coliform'))
      reasoning.push('Microbiological parameters have NOT been measured — contamination cannot be excluded even where listed breaches are treated.')
  } else if (soft.length > 0) {
    decision = 'RETEST'
    recommendedAction = `Retest to confirm: ${soft.map((a) => `${a.displayName} ${a.value}${a.unit ? ' ' + a.unit : ''} exceeds the acceptable limit (${a.standard?.maxValue}) but is within the permissible limit (${a.standard?.criticalValue})`).join('; ')}. If confirmed, purification/treatment is justified.`
    for (const a of soft) reasoning.push(`${a.displayName}: ${a.explanation}`)
    reasoning.push('A single acceptable-limit exceedance can be transient; confirmation by retest precedes treatment decisions.')
    addPriorityTests()
  } else if (missing.length > 0) {
    decision = 'ADDITIONAL_TEST_REQUIRED'
    recommendedAction = 'Measured parameters are within their acceptable limits, but complete water safety cannot be established because important parameters remain unmeasured. Perform the missing tests before drawing any conclusion.'
    reasoning.push('Measured parameters are within limits, but unmeasured parameters (including microbiological ones) prevent any statement of complete safety.')
    addPriorityTests()
  } else {
    decision = 'DO_NOT_PURIFY'
    recommendedAction = 'No treatment action is indicated by the available measured evidence: all expected parameters are measured and within their registered acceptable limits.'
    reasoning.push('All expected parameters are measured and within their registered acceptable limits; the standard defines no exceedance that requires treatment.')
  }

  const confidence =
    analysis.overall.status === 'NO_DATA' || analysis.evidence.noStandardCount > 0
      ? 'LOW'
      : problems.length > 0 || missing.length > 0
        ? 'MEDIUM'
        : 'HIGH'

  const missingEvidence = [
    ...missing.map((a) => `${a.displayName}: NOT_MEASURED (never treated as safe)`),
    ...analysis.measurements
      .filter((a) => a.standardStatus === 'NO_STANDARD_AVAILABLE')
      .map((a) => `${a.displayName}: NO_STANDARD_AVAILABLE — a measurement exists but no official standard is registered`),
  ]
  const treatmentRecommendation = buildTreatmentRecommendation([
    ...problems,
    ...analysis.measurements.filter((a) => a.parameter === 'conductivity' && a.status === 'NO_STANDARD_AVAILABLE'),
  ], missing.map((a) => a.parameter))

  return {
    decision,
    confidence,
    currentCondition: analysis.overall.explanation,
    detectedProblems,
    missingEvidence,
    recommendedAction,
    additionalTests,
    reasoning,
    evidence: [...analysis.measurements, ...analysis.notMeasured].map(trace),
    engine: 'RULE_BASED',
    analysisTimestamp: analysis.analysisTimestamp,
    caveat: analysis.overall.caveat + ' The AI decision is decision support traceable to the cited evidence — not a potability certification.',
    treatmentRecommendation,
  }
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

/** Optional Python AI interpretation layer (AI_ENGINE_URL). It can NEVER change
 * the decision — only annotate it. Failures degrade to no annotation, honestly. */
async function pythonInterpretation(analysis: unknown, base: WaterQualityDecision): Promise<Pick<WaterQualityDecision, 'aiInterpretation' | 'aiInterpretationError'>> {
  const url = process.env.AI_ENGINE_URL
  if (!url) return {}
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis, decision: base }),
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { aiInterpretationError: `Python AI engine returned HTTP ${response.status}` }
    const body = (await response.json()) as WaterQualityDecision['aiInterpretation']
    if (!body || typeof body !== 'object') return { aiInterpretationError: 'Python AI engine returned an unexpected payload' }
    return { aiInterpretation: body }
  } catch (error) {
    return { aiInterpretationError: `Python AI engine unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Entry point: deterministic synthesis + optional Gemini refinement (never replaces it). */
export async function decide(pool: Pool, waterSourceId: string): Promise<WaterQualityDecision | null> {
  const analysis = await analyzeWaterQuality(pool, waterSourceId)
  if (!analysis) return null
  const base = synthesizeDecision(analysis)
  const interpretation = await pythonInterpretation(analysis, base)
  const key = process.env.GEMINI_API_KEY
  if (!key) return { ...base, ...interpretation }

  const prompt = `You are the AquaSense AI decision engine for rural water systems. You receive a DETERMINISTIC water-quality analysis (measurements, statuses against BIS IS 10500:2012, missing parameters, evidence sufficiency). Reply in JSON ONLY with exactly this shape:
{"decision":"PURIFY|DO_NOT_PURIFY|RETEST|ADDITIONAL_TEST_REQUIRED|CHANGE_TREATMENT|INSUFFICIENT_EVIDENCE","confidence":"HIGH|MEDIUM|LOW","currentCondition":"...","recommendedAction":"...","additionalTests":["..."],"reasoning":["..."]}
Rules: parameters with no measurement are NOT safe; never claim complete safety while parameters are unmeasured; never downgrade the deterministic decision when it is PURIFY or CHANGE_TREATMENT; keep every conclusion traceable to the provided evidence; government records are NOT part of this current-sample analysis. Analysis JSON:
${JSON.stringify(analysis)}`

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    if (!response.ok) return base
    const json = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return base
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return base
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<{
      decision: Decision
      confidence: 'HIGH' | 'MEDIUM' | 'LOW'
      currentCondition: string
      recommendedAction: string
      additionalTests: string[]
      reasoning: string[]
    }>
    if (!parsed.decision || !DECISIONS.includes(parsed.decision)) return base
    const canRefine = base.decision !== 'PURIFY' && base.decision !== 'CHANGE_TREATMENT'
    return {
      ...base,
      decision: canRefine ? parsed.decision : base.decision,
      confidence: parsed.confidence === 'HIGH' || parsed.confidence === 'MEDIUM' || parsed.confidence === 'LOW' ? parsed.confidence : base.confidence,
      currentCondition: parsed.currentCondition ?? base.currentCondition,
      recommendedAction: parsed.recommendedAction ?? base.recommendedAction,
      additionalTests: Array.isArray(parsed.additionalTests) ? parsed.additionalTests : base.additionalTests,
      reasoning: Array.isArray(parsed.reasoning) && parsed.reasoning.length > 0 ? parsed.reasoning : base.reasoning,
      engine: 'GEMINI',
      ...interpretation,
    }
  } catch {
    return base
  }
}