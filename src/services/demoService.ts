/**
 * DEMO MODE — clearly labelled sample data for development while the
 * hardware is offline. When DEMO MODE is active the UI always shows a
 * persistent DEMO MODE banner. Values here are never presented as real data.
 */
import type { CurrentReadings, HistoricalReading, PumpState, WaterAlert } from '../types'

export const DEMO_LIVE = true

let simTime = Date.now() - 72 * 3600_000

export function demoCurrent(): CurrentReadings {
  const t = simTime
  // Values stay realistic but move slightly so charts and trends look alive.
  const temperature = 27 + Math.sin(t / 600_000) * 1.2
  const turbidity = Math.max(0.5, 4 + Math.sin(t / 900_000) * 2)
  return {
    temperature: round1(temperature),
    turbidity: round1(turbidity),
    ph: 7.1,
    tds: 380,
    pumpStatus: true,
    esp32Online: true,
    timestamp: simTime,
  }
}

export function demoHistory(limit = 300): HistoricalReading[] {
  const out: HistoricalReading[] = []
  for (let i = limit; i > 0; i--) {
    const t = simTime - i * 60_000
    out.push({
      temperature: round1(28 + Math.sin(t / 900_000) * 1.5),
      turbidity: round1(Math.max(0.5, 4 + Math.sin(t / 1_200_000) * 2)),
      ph: 7.4,
      tds: 380,
      timestamp: t,
    })
  }
  out.push({ ...demoCurrent(), timestamp: simTime } as HistoricalReading)
  return out
}

export function demoPump(): PumpState {
  return { command: '', status: 'RUNNING', startedAt: simTime - 15 * 60_000, cycleCount: 4 }
}

export function demoAlerts(): Omit<WaterAlert, 'acknowledged'>[] {
  return []
}

/** Advance the simulated clock. */
export function tickDemo() {
  simTime += 1500
}

function round1(v: number) {
  return Math.round(v * 10) / 10
}