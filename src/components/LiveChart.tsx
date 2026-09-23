/**
 * LiveChart — recharts time-series with a configurable window.
 * Renders only real data points; the axis labels stay human-readable.
 */
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts'
import type { HistoricalReading } from '../types'

export type TimeWindow = '1h' | '6h' | '24h' | '7d'

export interface ChartPoint {
  ts: number
  label: string
  value: number
}

export function windowMs(window: TimeWindow): number {
  const hours = window === '1h' ? 1 : window === '6h' ? 6 : window === '24h' ? 24 : 168
  return hours * 3600_000
}

/** Extract + filter a single parameter series across a window. */
export function buildSeries(
  history: HistoricalReading[],
  parameter: 'temperature' | 'turbidity' | 'ph' | 'tds',
  window: TimeWindow,
): ChartPoint[] {
  const cutoff = Date.now() - windowMs(window)
  return history
    .map((r) => ({ ts: r.timestamp, value: r[parameter] }))
    .filter((x): x is { ts: number; value: number } => typeof x.value === 'number' && Number.isFinite(x.value) && x.ts > 0 && x.ts >= cutoff)
    .map((x) => ({ ts: x.ts, label: fmtAxis(x.ts), value: x.value }))
    .sort((a, b) => a.ts - b.ts)
}

function fmtAxis(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function LiveChart({ points, unit, color = '#0e7490', height = 220 }: { points: ChartPoint[]; unit: string; color?: string; height?: number }) {
  if (points.length < 2) {
    return <p className="muted chart-hint">Not enough data for a chart yet — add at least two dated readings.</p>
  }
  return (
    <div className="chart-box" aria-label="Trend chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2ebee" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={40} reversed={false} />
          <YAxis tick={{ fontSize: 10 }} width={46} domain={['auto', 'auto']} />
          <RTooltip formatter={(v) => `${v}${unit ? ' ' + unit : ''}`} labelFormatter={(l) => l} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}