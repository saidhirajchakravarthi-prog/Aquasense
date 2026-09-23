/**
 * Historical Case Intelligence — CURRENT PROBLEM -> historical government cases.
 *
 * Only value-based LABORATORY_MEASUREMENT records are case-matched. WQ6
 * affected-village counts appear as CONTEXT ONLY. Documented actions are shown
 * ONLY when the source record actually contains one (otherwise
 * "NO DOCUMENTED ACTION FOUND"). Historical evidence never becomes current evidence.
 */
import { useEffect, useState } from 'react'
import { fetchHistoricalCases } from '../services/apiService'
import type { HistoricalCaseIntelResult, HistoricalCase } from '../types'
import { EmptyState, ErrorState, Loading, Panel } from './ui'

const similarityBadge = (s: HistoricalCase['similarity']): string =>
  s === 'SIMILAR_CASE' ? 'badge status-good'
    : s === 'HISTORICAL_CONFLICT' ? 'badge status-critical'
      : 'badge status-moderate'

export function HistoricalCaseIntelPage({ waterSourceId }: { waterSourceId: string | null }) {
  const [data, setData] = useState<HistoricalCaseIntelResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!waterSourceId) { setData(null); return }
    let alive = true
    setLoading(true)
    setError(null)
    fetchHistoricalCases(waterSourceId)
      .then((r) => { if (alive) setData(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Historical case search failed.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [waterSourceId])

  if (!waterSourceId) {
    return (
      <EmptyState
        title="No water source selected"
        hint="Select a water source on the Dashboard; historical cases are searched for its CURRENT problems."
      />
    )
  }
  if (loading) return <Loading label="Searching historical government records…" />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="No case search result available" />

  return (
    <>
      <section className="panel-grid">
        <Panel title="Current Evidence (deterministic analysis)" className="wide">
          {data.currentEvidence.length === 0
            ? <EmptyState title="No current measurement" hint="Take a real measurement first — there is no current problem to search for." />
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Parameter</th><th>Value</th><th>Status (deterministic)</th><th>Source</th><th>Measured at</th></tr></thead>
                  <tbody>
                    {data.currentEvidence.map((e) => (
                      <tr key={e.parameter}>
                        <td>{e.displayName}</td>
                        <td>{e.value ?? '—'} {e.unit ?? ''}</td>
                        <td><span className={e.status === 'WITHIN_LIMIT' ? 'badge status-good' : e.status === 'NOT_MEASURED' ? 'badge' : 'badge status-critical'}>{e.status}</span></td>
                        <td>{e.source ?? '—'}</td>
                        <td>{e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Panel>
        <Panel title="AI Interpretation" className="wide">
          <p className="callout">{data.interpretation}</p>
          <ul className="stat-list">
            <li><b>{data.summary.casesFound}</b> value-based historical case(s)</li>
            <li><b>{data.summary.similar}</b> SIMILAR_CASE</li>
            <li><b>{data.summary.possible}</b> POSSIBLE_SIMILAR_CASE</li>
            <li><b>{data.summary.conflicts}</b> HISTORICAL_CONFLICT</li>
            <li><b>{data.contextualCounts.length}</b> WQ6 context-only count record(s)</li>
          </ul>
        </Panel>
      </section>
      <HistoricalCaseResult data={data} />
    </>
  )
}

function HistoricalCaseResult({ data }: { data: HistoricalCaseIntelResult }) {
  return (
    <>
      {data.historicalCases.length > 0 && (
        <section className="panel-grid">
          <Panel title={`Historical Cases (${data.historicalCases.length})`} className="wide">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th><th>Historical value</th><th>Status then</th><th>Similarity</th><th>Location match</th>
                    <th>Time context</th><th>Documented action</th><th>Provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.historicalCases.map((c) => (
                    <tr key={c.recordId}>
                      <td>{c.displayName}</td>
                      <td><b>{c.value}</b> {c.unit ?? ''}<span className="sub">Δ {c.valueDifference.absolute >= 0 ? '+' : ''}{c.valueDifference.absolute}{c.valueDifference.percentage !== null ? ` (${c.valueDifference.percentage >= 0 ? '+' : ''}${c.valueDifference.percentage}%)` : ''} vs current</span></td>
                      <td>{c.statusAgainstStandard}</td>
                      <td><span className={similarityBadge(c.similarity)}>{c.similarity}</span></td>
                      <td>{c.locationMatch}</td>
                      <td>{c.timeContext}</td>
                      <td>
                        {c.documentedAction
                          ? <>{c.documentedAction}<span className="sub">{c.actionAvailability}</span></>
                          : <span className="badge">{c.actionAvailability}</span>}
                      </td>
                      <td>
                        {c.organization} · {c.datasetName}{c.datasetYear ? ` (${c.datasetYear})` : ''}
                        {c.sourceUrl && <a className="sub" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceUrl}</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}
      {data.contextualCounts.length > 0 && (
        <section className="panel-grid">
          <Panel title={`WQ6 Context (${data.contextualCounts.length}) — NOT case evidence`} className="wide">
            <p className="helper">Affected-village counts are CONTEXT ONLY — never a concentration (mg/L, NTU), never a current sensor value, never case-matched.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Parameter</th><th>State</th><th>Affected village count (CONTEXT ONLY)</th><th>Dataset</th><th>Sample date</th></tr></thead>
                <tbody>
                  {data.contextualCounts.slice(0, 50).map((c, i) => (
                    <tr key={i}>
                      <td>{c.parameter}</td>
                      <td>{c.state ?? '—'}</td>
                      <td><span className="badge summary">{c.affectedVillageCount} — CONTEXT ONLY</span></td>
                      <td>{c.datasetName}</td>
                      <td>{c.sampleDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}
      <section className="panel-grid">
        <Panel title="Limitations" className="wide">
          <ul className="stat-list">{data.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Panel>
      </section>
    </>
  )
}

export default HistoricalCaseIntelPage
