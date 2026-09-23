/**
 * Government Historical AI Analysis page.
 *
 * Read-only: loads real CGWB government_records from PostgreSQL (via the
 * Express API), classifies every measurement with the existing deterministic
 * engine, and forwards the structured evidence to the Python AI for
 * interpretation. NEVER claims historical government data is "current".
 */
import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  fetchPythonAIStatus,
  fetchGovernmentAnalysis,
  fetchGovernmentLocations,
  type PythonAIStatus,
  type GovHistoricalAnalysis,
  type GovLocationOptions,
} from '../../services/apiService'
import { Loading, ErrorState, EmptyState } from '../../components/ui'

const DEFAULTS = {
  dataset: 'CGWB Ground Water Quality Data - 2022',
  year: '2022',
  state: 'Jharkhand',
  district: 'Bokaro',
  location: 'Baramasia',
}

const concernStatuses = ['ABOVE_ACCEPTABLE', 'ABOVE_PERMISSIBLE', 'BELOW_LIMIT']

export default function AIHistoricalAnalysisPage(): JSX.Element {
  const [sp] = useSearchParams()
  const [analysis, setAnalysis] = useState<GovHistoricalAnalysis | null>(null)
  const [aiStatus, setAiStatus] = useState<PythonAIStatus | null>(null)
  const [, setLocations] = useState<GovLocationOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dataset = sp.get('dataset') ?? DEFAULTS.dataset
  const year = sp.get('year') ?? DEFAULTS.year
  const state = sp.get('state') ?? DEFAULTS.state
  const district = sp.get('district') ?? DEFAULTS.district
  const location = sp.get('location') ?? DEFAULTS.location
  const parameter = sp.get('parameter') ?? ''
  const mode = (sp.get('mode') ?? 'location') as 'single' | 'location'

  function loadAnalysis(ds: string, yr: string, st: string, dt: string, loc: string, param: string, md: 'single' | 'location') {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchPythonAIStatus().then(setAiStatus).catch(() => setAiStatus({ status: 'NOT_AVAILABLE', source: 'PYTHON_AI_RULE_FALLBACK', available: false })),
      fetchGovernmentLocations(ds, yr).then(setLocations).catch(() => setLocations(null)),
      fetchGovernmentAnalysis({ dataset: ds, year: yr, state: st, district: dt, location: loc, parameter: param, mode: md })
        .then((a) => { setAnalysis(a); setError(null) })
        .catch((e) => { setError(e instanceof Error ? e.message : 'Failed to load government analysis.'); setAnalysis(null) }),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => { loadAnalysis(dataset, year, state, district, location, parameter, mode) }, [dataset, year, state, district, location, parameter, mode])

  const aiAvailable = aiStatus?.available ?? false
  const aiSource = aiStatus?.source ?? 'PYTHON_AI'

  const concernParams = useMemo(() => analysis?.measurements.filter((m) => concernStatuses.includes(m.deterministicStatus)) ?? [], [analysis])
  const withinLimitParams = useMemo(() => analysis?.measurements.filter((m) => m.deterministicStatus === 'WITHIN_LIMIT') ?? [], [analysis])
  const missingParams = analysis?.parametersNotReported ?? []

  const overallAssessment = useMemo(() => {
    if (!analysis || analysis.measurements.length === 0)
      return 'No laboratory measurement records were found for this location in the selected dataset. The available government evidence is incomplete.'
    if (concernParams.length > 0)
      return `Historical measurements indicate concern for ${concernParams.map((m) => m.displayName).join(', ')} because their recorded values exceed the applicable limits.`
    if (analysis.parametersWithoutStandard > 0)
      return `Available historical measurements for this location are within the applicable standards, but ${analysis.parametersWithoutStandard} parameter(s) lack a registered standard and are not graded.`
    return 'Available historical CGWB measurements for this location are within the applicable standards.'
  }, [analysis, concernParams])

  if (loading && !analysis) return <Loading label="Loading government historical analysis..." />
  if (error) return <ErrorState message={error} onRetry={() => loadAnalysis(dataset, year, state, district, location, parameter, mode)} />

  return (
    <div className="gov-ai-page">
      {/* Banner */}
      <header className="gov-ai-banner">
        <div>
          <p className="eyebrow">Government Historical Intelligence</p>
          <h1>AI HISTORICAL GOVERNMENT ANALYSIS</h1>
        </div>
        <div className="gov-ai-badges">
          <span className="banner-tag">HISTORICAL</span>
          <span className="banner-tag">GOVERNMENT</span>
          <span className="banner-tag warning">NOT CURRENT</span>
          <span className={`ai-status ${aiAvailable ? 'online' : 'offline'}`}>
            PYTHON AI{' \u25CF '} {aiAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'} ({aiSource})
          </span>
        </div>
      </header>

      {/* Selected location */}
      <section className="panel">
        <h3>Selected Location</h3>
        <div className="gov-loc-grid">
          <div className="gov-loc-item"><span>Dataset</span><b>{analysis?.dataset ?? dataset}</b></div>
          <div className="gov-loc-item"><span>Year</span><b>{analysis?.datasetYear ?? year}</b></div>
          <div className="gov-loc-item"><span>State</span><b>{analysis?.state ?? state}</b></div>
          <div className="gov-loc-item"><span>District</span><b>{analysis?.district ?? district}</b></div>
          <div className="gov-loc-item"><span>Location</span><b>{analysis?.location ?? location}</b></div>
        </div>
        <p className="helper">
          Source: {analysis?.source ?? 'POSTGRESQL'} — {analysis?.dataset ?? 'CGWB'} \u00b7 {analysis?.observedYear ?? year}
          {analysis && ` \u00b7 ${analysis.parametersMeasured} parameter(s) measured`}
        </p>
      </section>

      {/* Overall assessment */}
      <section className="panel overall-assessment">
        <h3>Overall Historical Assessment</h3>
        <blockquote>{overallAssessment}</blockquote>
        {analysis && analysis.measurements.length > 0 && (
          <div className="gov-summary-grid">
            <div><b>{analysis.parametersMeasured}</b> measured</div>
            <div className="ok"><b>{analysis.parametersWithinLimit}</b> within limit</div>
            {analysis.parametersAboveAcceptable > 0 && <div className="warn"><b>{analysis.parametersAboveAcceptable}</b> above acceptable</div>}
            {analysis.parametersAbovePermissible > 0 && <div className="error"><b>{analysis.parametersAbovePermissible}</b> above permissible</div>}
            {analysis.parametersBelowLimit > 0 && <div className="warn"><b>{analysis.parametersBelowLimit}</b> below limit</div>}
            {analysis.parametersWithoutStandard > 0 && <div className="na"><b>{analysis.parametersWithoutStandard}</b> no standard</div>}
          </div>
        )}
      </section>

      {/* Parameter analysis */}
      <section className="panel">
        <h3>Parameter Analysis</h3>
        {!analysis?.measurements?.length ? (
          <EmptyState title="No measurements found" hint="No laboratory measurement records exist for this location in the selected dataset." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Parameter</th><th>Value</th><th>Unit</th><th>BIS Standard</th><th>Status</th><th>Interpretation</th></tr>
              </thead>
              <tbody>
                {analysis.measurements.map((m) => {
                  const isConcern = concernStatuses.includes(m.deterministicStatus)
                  return (
                    <tr key={m.parameter + m.sourceSerial} className={isConcern ? 'concern-row' : ''}>
                      <td><b>{m.displayName}</b><span className="sub">{m.parameter}</span></td>
                      <td><b>{m.value}</b></td>
                      <td>{m.unit || '\u2014'}</td>
                      <td>{m.standard ? `${m.standard.minValue ?? '\u2014'} \u2013 ${m.standard.maxValue ?? '\u2014'} ${m.standard.unit ?? ''}`.trim() : 'No standard registered'}</td>
                      <td><span className={`badge ${isConcern ? 'status-critical' : 'status-good'}`}>{m.deterministicStatus.replace(/_/g, ' ')}</span></td>
                      <td className="sub"><em>{m.standard ? `Measured ${m.value} ${m.unit} against ${m.standard.referenceSource}` : 'No standard to compare against.'}</em></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>


      {/* Parameters of concern */}
      {concernParams.length > 0 && (
        <section className="panel concern-section">
          <h3>Parameters of Concern</h3>
          <div className="concern-grid">
            {concernParams.map((m) => (
              <div key={m.parameter + m.sourceSerial} className="concern-card">
                <h4>{m.displayName} <span className="badge status-critical">{m.deterministicStatus.replace(/_/g, ' ')}</span></h4>
                <p><b>Value:</b> {m.value} {m.unit ?? ''}</p>
                <p><b>Standard:</b> {m.standard ? `${m.standard.minValue ?? '\u2014'} \u2013 ${m.standard.maxValue ?? '\u2014'}` : 'No standard'} ({m.standard?.referenceSource ?? ''})</p>
                <p><b>Why it matters:</b> {m.deterministicStatus.replace(/_/g, ' ')} means the measured value departs from the BIS drinking-water guideline.</p>
                <p className="helper">Recommended current test: confirm this parameter with a fresh field or lab test.</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Within limit */}
      {withinLimitParams.length > 0 && concernParams.length === 0 && (
        <section className="panel">
          <h3>Parameters Within Limit</h3>
          <ul className="stat-list">
            {withinLimitParams.map((m) => (
              <li key={m.parameter + m.sourceSerial}><b>{m.displayName}</b> \u2014 {m.value} {m.unit ?? ''} \u00b7 <span className="badge status-good">WITHIN LIMIT</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* Missing / not reported */}
      {missingParams.length > 0 && (
        <section className="panel">
          <h3>Missing / Not Reported</h3>
          <ul className="stat-list">
            {missingParams.map((p) => (
              <li key={p}><b>{p.replace(/_/g, ' ')}</b> \u2014 <span className="badge neutral">NOT REPORTED IN CGWB SOURCE</span></li>
            ))}
          </ul>
          <p className="helper">These parameters were not found in the CGWB source for this location. NOT substituted (e.g. EC does not stand in for turbidity).</p>
        </section>
      )}


      {/* Pattern / statistical insights */}
      {analysis && analysis.measurements.length > 0 && (
        <section className="panel">
          <h3>Pattern / Statistical Insights</h3>
          <div className="gov-summary-grid">
            <div><b>{analysis.parametersMeasured}</b> measurements</div>
            <div><b>{analysis.parametersWithinLimit}</b> within limit</div>
            {analysis.parametersAboveAcceptable > 0 && <div className="warn">{analysis.parametersAboveAcceptable} above acceptable</div>}
            {analysis.parametersAbovePermissible > 0 && <div className="error">{analysis.parametersAbovePermissible} above permissible</div>}
            {analysis.parametersBelowLimit > 0 && <div className="warn">{analysis.parametersBelowLimit} below limit</div>}
            <div><b>{analysis.parametersNotReported.length}</b> not reported</div>
          </div>
          <p className="helper">
            Statistics are computed from real CGWB records for this location/year. Each parameter has a single observation per location here. This is evidence-based historical analysis, not a trained ML prediction.
          </p>
        </section>
      )}

      {/* Recommended current tests */}
      <section className="panel recommended-tests">
        <h3>Recommended Current Tests</h3>
        <p className="helper">Based on historical evidence gaps and concern parameters, the following current tests are recommended.</p>
        <ul className="stat-list">
          {concernParams.length > 0 && concernParams.map((m) => (
            <li key={m.parameter + '-rec'}>Recommended current test: <b>{m.displayName}</b> \u2014 {m.value} {m.unit ?? ''} was above acceptable historically; confirm with a fresh test.</li>
          ))}
          {missingParams.map((p) => (
            <li key={p + '-rec'}>Recommended current test: <b>{p.replace(/_/g, ' ')}</b> \u2014 not reported in CGWB source; measure now if a standard exists.</li>
          ))}
          {concernParams.length === 0 && missingParams.length === 0
            ? <li>No additional current tests are specifically recommended beyond routine monitoring.</li>
            : null}
        </ul>
        <p className="helper">Recommended current tests only. These do NOT confirm current contamination.</p>
      </section>

      {/* Python AI reasoning */}
      <section className="panel ai-reasoning">
        <h3>Python AI Reasoning</h3>
        {analysis?.pythonAIInterpretation ? (
          <blockquote>{analysis.pythonAIInterpretation}</blockquote>
        ) : (
          <p className="helper">Python AI interpretation was not available for this analysis.</p>
        )}
        {analysis?.pythonAIResponse != null && typeof analysis.pythonAIResponse === 'object' && (
          <details className="evidence-detail">
            <summary>Raw Python AI response (expand)</summary>
            <pre>{JSON.stringify(analysis.pythonAIResponse, null, 2)}</pre>
          </details>
        )}
      </section>

      {/* Limitations */}
      <section className="panel">
        <h3>Limitations</h3>
        <ul className="stat-list">
          <li>Government data is historical \u2014 it cannot establish today's water condition.</li>
          <li>WQ6 affected-village counts are context-only, not concentrations \u2014 never part of this analysis.</li>
          <li>CGWB provides year only; sample dates and block/village geo-columns may be absent.</li>
          <li>This is evidence-based historical AI analysis, not a trained ML prediction.</li>
          <li>Current-water PURIFY/RETEST decisions remain under the Current Water AI / deterministic decision engine.</li>
        </ul>
      </section>
    </div>
  )
}

