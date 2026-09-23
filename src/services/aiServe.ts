/**
 * AI Water Quality Assistant.
 *
 * The LLM (Gemini via the backend /api/ai/analyze proxy) runs only when the
 * operator has configured a server-side key. Secret keys are NEVER exposed in
 * frontend code. When no key is configured, the backend falls back to a local
 * deterministic rule engine so the system still demonstrates safely.
 *
 * Every request carries current + recent historical readings, enabling trend
 * detection and plain-language explanations for non-technical users.
 */
import type { AiResult, CurrentReadings, HistoricalReading, Thresholds } from '../types'
import { loadThresholds } from '../utils/quality'
import { ruleBasedAnalysis } from '../utils/trends'

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api'

async function callBackend(current: CurrentReadings, history: HistoricalReading[], thresholds: Thresholds): Promise<AiResult | null> {
  try {
    const response = await fetch(`${API}/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, history: history.slice(-120), thresholds }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as Partial<AiResult>
    if (!data || !data.analysis || !data.engine) return null
    return data as AiResult
  } catch {
    return null
  }
}

/** Analyse CURRENT + HISTORICAL readings: backend LLM -> local rule engine. */
export async function analyzeWater(
  current: CurrentReadings,
  history: HistoricalReading[],
  thresholds: Thresholds = loadThresholds(),
): Promise<{ result: AiResult; engine: AiResult['engine']; usedBackend: boolean }> {
  const backend = await callBackend(current, history, thresholds)
  if (backend) return { result: backend, engine: backend.engine, usedBackend: true }
  const local = ruleBasedAnalysis(current, history, thresholds)
  return { result: { ...local, engine: 'RULE_BASED' }, engine: 'RULE_BASED', usedBackend: false }
}

/** Synchronous local analysis for immediate feedback. */
export function analyzeWaterLocal(
  current: CurrentReadings,
  history: HistoricalReading[],
  thresholds: Thresholds = loadThresholds(),
): AiResult {
  return { ...ruleBasedAnalysis(current, history, thresholds), engine: 'RULE_BASED' }
}