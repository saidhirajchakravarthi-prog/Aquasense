import { useEffect, useState } from "react"
import { fetchEvidenceComparison } from "../services/apiService"
import type { EvidenceComparisonResult, Comparison, HistoricalEvidence, CurrentEvidence } from "../types"
import { Panel, EmptyState, ErrorState, Loading } from "./ui"

interface EvidenceComparisonProps {
  waterSourceId?: string | null
}

export function EvidenceComparison({ waterSourceId }: EvidenceComparisonProps) {
  const [data, setData] = useState<EvidenceComparisonResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!waterSourceId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchEvidenceComparison(waterSourceId)
      .then(result => {
        if (!cancelled) setData(result)
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [waterSourceId])

  if (!waterSourceId) {
    return (
      <section className="eq">
        <header className="eq-head">
          <div>
            <h2>Evidence Comparison</h2>
            <p>Compare current prototype evidence against historical government records</p>
          </div>
        </header>
        <EmptyState
          title="No water source selected"
          hint="Select a water source from the Dashboard to compare evidence."
        />
      </section>
    )
  }

  if (loading) return <Loading label="Comparing evidence..." />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="No evidence data available" />

  return (
    <section className="eq">
      <header className="eq-head">
        <div>
          <h2>Evidence Comparison</h2>
          <p>Current prototype evidence vs historical government records</p>
        </div>
        <div className="eq-meta">
          <small>Source: {data.waterSource.name}</small>
          <small>Generated: {new Date(data.generatedAt).toLocaleString()}</small>
        </div>
      </header>

      {data.limitations.length > 0 && (
        <div className="eq-limitations">
          <h4>Important Limitations</h4>
          <ul>
            {data.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <Panel title="Current Evidence (ESP32 + Manual)">
        {data.currentEvidence.length === 0 ? (
          <EmptyState title="No current measurements" hint="No ESP32 or manual readings available." />
        ) : (
          <div className="eq-evidence-grid">
            {data.currentEvidence.map((ev, i) => (
              <EvidenceCard key={i} evidence={ev} />
            ))}
          </div>
        )}
      </Panel>
      <Panel title={`Agreements (${data.agreements.length})`}>
        {data.agreements.length === 0 ? (
          <EmptyState title="No agreements found" />
        ) : (
          <div className="eq-comparison-list">
            {data.agreements.map((comp, i) => (
              <ComparisonCard key={i} comparison={comp} status="agreement" />
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`Conflicts (${data.conflicts.length})`}>
        {data.conflicts.length === 0 ? (
          <EmptyState title="No conflicts found" />
        ) : (
          <div className="eq-comparison-list">
            {data.conflicts.map((comp, i) => (
              <ComparisonCard key={i} comparison={comp} status="conflict" />
            ))}
          </div>
        )}
      </Panel>

      {data.noComparableEvidence.length > 0 && (
        <Panel title={`No Comparable Evidence (${data.noComparableEvidence.length})`}>
          <div className="eq-evidence-list">
            {data.noComparableEvidence.map((ev, i) => (
              <HistoricalEvidenceCard key={i} evidence={ev} />
            ))}
          </div>
        </Panel>
      )}

      {data.contextualGovernmentEvidence.length > 0 && (
        <Panel title={`Contextual Government Evidence (${data.contextualGovernmentEvidence.length})`}>
          <p className="eq-note">These records provide context but cannot be directly compared.</p>
          <div className="eq-evidence-list">
            {data.contextualGovernmentEvidence.map((ev, i) => (
              <HistoricalEvidenceCard key={i} evidence={ev} />
            ))}
          </div>
        </Panel>
      )}
    </section>
  )
}
function EvidenceCard({ evidence }: { evidence: CurrentEvidence }) {
  return (
    <div className="evidence-card current">
      <div className="evidence-header">
        <span className="evidence-param">{evidence.parameter.toUpperCase()}</span>
        <span className="evidence-source">{evidence.source}</span>
      </div>
      <div className="evidence-value">
        <b>{evidence.value !== null ? evidence.value : "—"}</b>
        <span>{evidence.unit}</span>
      </div>
      <div className="evidence-meta">
        <small>{evidence.waterSourceName}</small>
        <small>{new Date(evidence.timestamp).toLocaleString()}</small>
      </div>
    </div>
  )
}

function ComparisonCard({ comparison, status }: { comparison: Comparison; status: "agreement" | "conflict" }) {
  const statusClass = status === "agreement" ? "status-good" : "status-critical"
  return (
    <div className={`comparison-card ${status}`}>
      <div className="comparison-header">
        <span className="evidence-param">{comparison.parameter.toUpperCase()}</span>
        <span className={`badge ${statusClass}`}>{comparison.evidenceStatus}</span>
      </div>
      <div className="comparison-values">
        <div className="comparison-side">
          <small>Current</small>
          <b>{comparison.current?.value ?? "—"} {comparison.current?.unit}</b>
          <small>{comparison.current?.location}</small>
        </div>
        <div className="comparison-arrow">↔</div>
        <div className="comparison-side">
          <small>Historical</small>
          <b>{comparison.historical?.value ?? "—"} {comparison.historical?.unit}</b>
          <small>{comparison.historical?.location}</small>
        </div>
      </div>
      {comparison.difference && (
        <div className="comparison-diff">
          <small>Difference: {comparison.difference.absolute.toFixed(2)} ({comparison.difference.percentage?.toFixed(1)}%)</small>
        </div>
      )}
      <div className="comparison-interpretation">
        <p>{comparison.interpretation}</p>
        <small>Geographic match: {comparison.geographicMatchLevel}</small>
      </div>
    </div>
  )
}

function HistoricalEvidenceCard({ evidence }: { evidence: HistoricalEvidence }) {
  return (
    <div className="evidence-card historical">
      <div className="evidence-header">
        <span className="evidence-param">{evidence.parameter.toUpperCase()}</span>
        <span className="evidence-source">{evidence.sourceOrganization}</span>
      </div>
      <div className="evidence-value">
        <b>{evidence.value !== null ? evidence.value : "—"}</b>
        <span>{evidence.unit ?? ""}</span>
      </div>
      <div className="evidence-meta">
        <small>{evidence.datasetName}</small>
        <small>{evidence.sampleDate ?? "No date"}</small>
        <small>{evidence.villageName ?? evidence.waterSourceName ?? "Unknown location"}</small>
      </div>
      {evidence.isContaminationSummary && (
        <div className="evidence-note">
          <small>Contamination summary: {evidence.affectedVillageCount} affected villages (context only)</small>
        </div>
      )}
    </div>
  )
}

export default EvidenceComparison
