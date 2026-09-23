import type { ReactNode } from 'react'
import type { CurrentReadings, DeviceStatus, QualityStatus, RiskLevel } from '../types'

/* ------------------------------------------------------------- Badges */

export function StatusBadge({ status }: { status: QualityStatus }) {
  const label = status === 'GOOD' ? 'Good' : status === 'MODERATE' ? 'Moderate' : status === 'POOR' ? 'Poor' : 'Critical'
  return <span className={`badge status-${status.toLowerCase().replace(' ', '')}`}>{label}</span>
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <span className={`badge risk-${risk.toLowerCase()}`}>{risk}</span>
}

export function ConnectedBadge({ online }: { online: boolean | null }) {
  if (online === null) return <span className="badge neutral">Not Connected</span>
  return online ? <span className="badge status-good">Connected</span> : <span className="badge status-critical">Offline</span>
}

export function SourceBadge({ source }: { source: string }) {
  return <span className="badge source">{source}</span>
}

/* -------------------------------------------------------------- Tooltip */

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tip-wrap">
      <span>{children}</span>
      <span className="tip" role="tooltip">{label}</span>
    </span>
  )
}

/* -------------------------------------------------------------- Cards */

export function SensorCard({
  label, value, unit, source, timestamp, status, icon, children,
}: {
  label: string
  value: number | null
  unit?: string
  source?: string
  timestamp?: string | number | null
  status?: 'good' | 'warning' | 'critical' | 'na'
  icon?: string
  children?: ReactNode
}) {
  const cls = status ?? (value === null ? 'na' : 'good')
  const fmtTs = timestamp ? new Date(timestamp).toLocaleString() : null
  return (
    <article className={`sensor-card ${cls}`}>
      <p className="sensor-label">{icon && <span className="sensor-icon" aria-hidden="true">{icon}</span>}{label}</p>
      <p className="sensor-value">
        {value === null ? <span className="na">—</span> : <>{value}<span className="unit"> {unit}</span></>}
      </p>
      {source && <p className="sensor-source">Source: {source}</p>}
      {fmtTs && <p className="sensor-source">Updated: {fmtTs}</p>}
      {children}
    </article>
  )
}

export function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {sub && <p className="metric-sub">{sub}</p>}
    </article>
  )
}

export function WaterQualityScore({ score, status, risk, onExplain }: { score: number | null; status: QualityStatus; risk: RiskLevel; onExplain?: () => void }) {
  return (
    <article className={`wq-score status-${status.toLowerCase().replace(' ', '')}`}>
      <p className="metric-label">Water Quality Score</p>
      <p className="score-number">{score === null ? '—' : score}<span>/100</span></p>
      <p className="score-status"><StatusBadge status={status} /> <RiskBadge risk={risk} /></p>
      {onExplain && <button type="button" className="btn-ghost small" onClick={onExplain}>Explain this reading</button>}
    </article>
  )
}

/* --------------------------------------------------------- Layout/state */

export function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  )
}

export function DemoBanner({ mode }: { mode: string }) {
  if (mode !== 'DEMO MODE') return null
  return (
    <div className="demo-banner" role="status">
      <strong>DEMO MODE</strong> — showing generated sample values, not real sensor data. Switch to REAL DATA in Settings.
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="state loading" role="status" aria-live="polite">{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <p>{message}</p>
      {onRetry && <button type="button" className="btn-ghost small" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state empty" role="status">
      <p><strong>{title}</strong></p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  )
}

export function NotConnected({ onConfigure }: { onConfigure?: () => void }) {
  return (
    <div className="state empty">
      <p><strong>Not Connected</strong></p>
      <p className="muted">Firebase Realtime Database is not configured. Add your VITE_FIREBASE_* variables and reload.</p>
      {onConfigure && <button type="button" className="btn-ghost small" onClick={onConfigure}>Go to Settings</button>}
    </div>
  )
}

/** Coverage row showing measured vs unknown parameters. */
export function CoverageRow({ current }: { current: CurrentReadings }) {
  const items: Array<[string, number | null, string]> = [
    ['Temperature', current.temperature, '°C'],
    ['Turbidity', current.turbidity, 'NTU'],
    ['pH', current.ph, ''],
    ['TDS', current.tds, 'ppm'],
  ]
  return (
    <p className="muted coverage">
      {items.map(([label, value, unit]) => (
        <span key={label} className="coverage-chip">
          {label}: {value === null ? '—' : `${value}${unit ? ' ' + unit : ''}`}
        </span>
      ))}
    </p>
  )
}

export function DeviceStatusBadge({ deviceStatus }: { deviceStatus: DeviceStatus }) {
  const className = deviceStatus.status === 'ONLINE' ? 'status-good' : deviceStatus.status === 'STALE' ? 'status-moderate' : 'status-critical'
  const age = deviceStatus.ageMs === null ? 'no accepted reading' : `${Math.round(deviceStatus.ageMs / 1000)}s since accepted reading`
  return <span className={`badge ${className}`} title={age}><span aria-hidden="true">●</span> {deviceStatus.status}</span>
}