/**
 * Configurable monitoring thresholds + water-quality scoring.
 * These are MONITORING thresholds configured in Settings — they are NOT
 * universal drinking-water safety certification limits.
 */
import type { CurrentReadings, QualityStatus, RiskLevel, Thresholds } from '../types'

export const DEFAULT_THRESHOLDS: Thresholds = {
  temperatureMin: 10,
  temperatureMax: 40,
  turbidityWarning: 5,
  turbidityCritical: 10,
  phMin: 6.5,
  phMax: 8.5,
  phCriticalSpread: 2,
  tdsWarning: 500,
  tdsCritical: 2000,
  suddenChangeFactor: 3,
}

const KEY = 'aquasense.thresholds.v1'

export function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_THRESHOLDS, ...(JSON.parse(raw) as Partial<Thresholds>) } : { ...DEFAULT_THRESHOLDS }
  } catch {
    return { ...DEFAULT_THRESHOLDS }
  }
}

export function saveThresholds(t: Thresholds) {
  localStorage.setItem(KEY, JSON.stringify(t))
}

interface Band { warning: boolean; critical: boolean }

function evaluate(name: string, value: number, t: Thresholds): { band: Band; issue: string } | null {
  switch (name) {
    case 'turbidity':
      if (value > t.turbidityCritical)
        return { band: { warning: true, critical: true }, issue: `Turbidity ${value} NTU exceeds the critical monitoring level (${t.turbidityCritical} NTU)` }
      if (value > t.turbidityWarning)
        return { band: { warning: true, critical: false }, issue: `Turbidity ${value} NTU is above the warning level (${t.turbidityWarning} NTU)` }
      return null
    case 'ph':
      if (value < t.phMin - t.phCriticalSpread || value > t.phMax + t.phCriticalSpread)
        return { band: { warning: true, critical: true }, issue: `pH ${value} is far outside the monitored range (${t.phMin}-${t.phMax})` }
      if (value < t.phMin || value > t.phMax)
        return { band: { warning: true, critical: false }, issue: `pH ${value} is outside the configured monitoring range (${t.phMin}-${t.phMax})` }
      return null
    case 'tds':
      if (value > t.tdsCritical)
        return { band: { warning: true, critical: true }, issue: `TDS ${value} ppm exceeds the critical monitoring level (${t.tdsCritical} ppm)` }
      if (value > t.tdsWarning)
        return { band: { warning: true, critical: false }, issue: `TDS ${value} ppm is above the warning level (${t.tdsWarning} ppm)` }
      return null
    case 'temperature':
      if (value < t.temperatureMin || value > t.temperatureMax)
        return { band: { warning: true, critical: false }, issue: `Temperature ${value}°C is outside the monitored range (${t.temperatureMin}-${t.temperatureMax})` }
      return null
    default:
      return null
  }
}

export interface QualitySnapshot {
  status: QualityStatus
  score: number
  risk: RiskLevel
  issues: string[]
  availableParameters: string[]
  missingParameters: string[]
}

const PENALTY_WARN = 18
const PENALTY_CRIT = 55

/**
 * Score = 100 − 55×critical − 18×warning over parameters that HAVE values.
 * Parameters without values are UNKNOWN — excluded and listed as gaps.
 */
export function computeQuality(current: CurrentReadings, t: Thresholds): QualitySnapshot {
  const checks: Array<[string, number | null]> = [
    ['temperature', current.temperature],
    ['turbidity', current.turbidity],
    ['ph', current.ph],
    ['tds', current.tds],
  ]
  const issues: string[] = []
  const available: string[] = []
  let warnings = 0
  let criticals = 0
  for (const [name, value] of checks) {
    if (value === null || !Number.isFinite(value)) continue
    available.push(name)
    const outcome = evaluate(name, value, t)
    if (!outcome) continue
    issues.push(outcome.issue)
    outcome.band.critical ? criticals++ : warnings++
  }
  const score = Math.max(0, 100 - criticals * PENALTY_CRIT - warnings * PENALTY_WARN)
  const status: QualityStatus =
    criticals > 0 ? 'CRITICAL' : warnings > 1 ? 'POOR' : warnings === 1 ? 'MODERATE' : 'GOOD'
  const risk: RiskLevel = criticals > 0 ? 'HIGH' : warnings > 0 ? 'MEDIUM' : 'LOW'
    return {
    status, score, risk, issues, availableParameters: available,
    missingParameters: checks.filter(([, v]) => v === null || !Number.isFinite(v)).map(([n]) => n),
  }
}

/**
 * Confidence reflects how many monitoring parameters actually have data.
 * 0–100: more parameters present → higher confidence. Used by the AI fallback.
 */
export function computeConfidence(snapshot: QualitySnapshot, current: CurrentReadings): number {
  let base = 30
  if (current.temperature !== null) base += 8
  if (current.turbidity !== null) base += 8
  if (current.ph !== null) base += 6
  if (current.tds !== null) base += 6
  if (current.pumpStatus !== null) base += 2
  if (current.esp32Online !== null) base += 5
  return Math.max(20, Math.min(95, base + Math.max(0, 30 - snapshot.issues.length * 5)))
}
