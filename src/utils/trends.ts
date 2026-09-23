/**
 * Trend detection, alert generation and plain-language explanations.
 * All thresholds come from the Settings page (configurable monitoring limits).
 */
import type { CurrentReadings, HistoricalReading, Thresholds, WaterAlert } from '../types'
import { computeConfidence, computeQuality } from './quality'

export function detectTrends(history: HistoricalReading[], t: Thresholds): string[] {
  const trends: string[] = []
  const analyse = (name: 'temperature' | 'turbidity' | 'ph' | 'tds', unit: string) => {
    const series = history
      .map((r) => ({ v: r[name], ts: r.timestamp }))
      .filter((x): x is { v: number; ts: number } => typeof x.v === 'number' && Number.isFinite(x.v))
      .sort((a, b) => a.ts - b.ts)
    if (series.length < 4) return
    const baseline = series.slice(Math.max(0, series.length - 5), series.length - 1)
    const baseAvg = baseline.reduce((s, x) => s + x.v, 0) / Math.max(1, baseline.length)
    const latest = series[series.length - 1].v
    if (baseAvg === 0) return
    const delta = latest - baseAvg
    if (Math.abs(delta) >= Math.abs(baseAvg) * t.suddenChangeFactor && Math.abs(delta) > 2) {
      const direction = delta > 0 ? 'increased significantly' : 'decreased significantly'
      trends.push(
        `${name} has ${direction} compared with the recent baseline (${baseAvg.toFixed(1)} → ${latest}${unit ? ' ' + unit : ''}). ${
          name === 'turbidity'
            ? 'This may indicate increased suspended particles or a filtration issue.'
            : name === 'tds'
              ? 'This may indicate a change in dissolved mineral load.'
              : 'This may indicate a process or sensor change worth investigating.'
        } Continue purification and perform a follow-up measurement.`,
      )
    }
  }
  analyse('turbidity', 'NTU')
  analyse('tds', 'ppm')
  analyse('temperature', '°C')
  analyse('ph', '')
  return trends
}

export const SENSOR_DISCONNECT_MS = 120_000

/** Build the current alert set (PDF §13 — messages match the spec). */
export function buildAlerts(
  current: CurrentReadings,
  snapshot: ReturnType<typeof computeQuality>,
  trends: string[],
  _t: Thresholds,
  now: number,
): Omit<WaterAlert, 'acknowledged'>[] {
  const out: Omit<WaterAlert, 'acknowledged'>[] = []
  const stale = current.timestamp !== null && now - current.timestamp > SENSOR_DISCONNECT_MS
  if (current.esp32Online === false || stale)
    out.push({
      type: 'ESP32_DISCONNECTED', severity: 'WARNING', parameter: undefined, value: null,
      message: 'No recent sensor data received.',
      explanation: `Last ESP32 packet arrived ${current.timestamp ? Math.round((now - current.timestamp) / 1000) + ' seconds ago' : 'never'}.`,
      recommendedAction: 'Check Wi-Fi and power on the ESP32, then confirm readings resume.',
      timestamp: now,
    })

  const pushes: Record<string, (issue: string) => void> = {
    turbidity: (issue) => out.push({
      type: 'HIGH_TURBIDITY', severity: issue.includes('critical') ? 'CRITICAL' : 'WARNING',
      message: 'High turbidity detected. Increased suspended particles may be present.',
      explanation: issue, parameter: 'turbidity', value: current.turbidity,
      recommendedAction: 'Inspect the source and filter; re-test after settling.', timestamp: now,
    }),
    ph: (issue) => out.push({
      type: 'ABNORMAL_PH', severity: issue.includes('far outside') ? 'CRITICAL' : 'WARNING',
      message: 'pH outside the configured monitoring range.',
      explanation: `${issue}. pH is measured manually after chemical testing.`,
      parameter: 'ph', value: current.ph,
      recommendedAction: 'Repeat the chemical test; if confirmed, inspect dosing/settling.', timestamp: now,
    }),
    tds: (issue) => out.push({
      type: 'HIGH_TDS', severity: issue.includes('critical') ? 'CRITICAL' : 'WARNING',
      message: 'Elevated dissolved solids detected. Additional water-quality testing is recommended.',
      explanation: `${issue}. TDS comes from an external meter.`, parameter: 'tds', value: current.tds,
      recommendedAction: 'Cross-check meter calibration and consider further testing.', timestamp: now,
    }),
    temperature: (issue) => out.push({
      type: 'TEMPERATURE_ABNORMAL', severity: 'WARNING',
      message: 'Temperature outside the configured monitoring range.',
      explanation: issue, parameter: 'temperature', value: current.temperature,
      recommendedAction: 'Verify DS18B20 probe placement and wiring.', timestamp: now,
    }),
  }
  for (const issue of snapshot.issues) {
    for (const key of Object.keys(pushes)) {
      if (issue.toLowerCase().includes(key)) { pushes[key](issue); break }
    }
  }
  for (const trend of trends)
    out.push({
      type: 'SUDDEN_CHANGE', severity: 'WARNING',
      message: 'Sudden change detected compared with recent readings.',
      explanation: trend,
      recommendedAction: 'Continue purification and perform a follow-up measurement.',
      timestamp: now,
    })
  return out
}

/** Plain-language explanation suited to rural / non-technical users. */
export function explainReading(
  snapshot: ReturnType<typeof computeQuality>,
  trends: string[],
  current: CurrentReadings,
): string {
  const parts: string[] = [
    snapshot.status === 'GOOD'
      ? 'The water looks normal right now — all tested values are inside their normal monitoring ranges.'
      : `Attention: the water condition looks ${snapshot.status.toLowerCase()} right now.`,
  ]
  if (current.temperature !== null) parts.push(`Water temperature is about ${current.temperature} degrees.`)
  if (current.turbidity !== null)
    parts.push(`Cloudiness (turbidity) reads ${current.turbidity} NTU${current.turbidity > 5 ? ', which is higher than we like' : ''}.`)
  if (current.ph !== null) parts.push(`The pH test strip shows ${current.ph}.`)
  if (current.tds !== null) parts.push(`Dissolved solids read ${current.tds} ppm on the external meter.`)
  if (trends.length) parts.push('A value changed quickly recently — keep purifying and measure again shortly.')
  parts.push('This dashboard does not certify drinking-water safety. Microbiological and additional chemical testing may be required.')
  return parts.join(' ')
}

/** Deterministic, no-key AI fallback engine. */
export function ruleBasedAnalysis(
  current: CurrentReadings,
  history: HistoricalReading[],
  t: Thresholds,
): Omit<import('../types').AiResult, 'engine'> {
  const snapshot = computeQuality(current, t)
  const trends = detectTrends(history, t)
  return {
    status: snapshot.status,
    risk: snapshot.risk,
    score: snapshot.score,
    analysis: snapshot.issues.length
      ? `${snapshot.issues.join('; ')}. Based on configured monitoring thresholds only.`
      : 'Current monitored parameters are within the configured monitoring ranges.',
    recommendation: snapshot.issues.length
      ? 'Review the affected parameters, repeat the manual tests where needed, and continue normal filtration until values recover.'
      : 'Continue normal filtration and re-test periodically.',
    confidence: computeConfidence(snapshot, current),
    detectedIssues: snapshot.issues,
    trends,
    limitations: [
      'Sensor and manual readings do not certify potability on their own.',
      'Microbiological and additional chemical testing may be required to establish drinking-water safety.',
      'Parameters without data were not assumed safe.',
    ],
    simpleExplanation: explainReading(snapshot, trends, current),
    timestamp: Date.now(),
  }
}