import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTreatmentRecommendation } from './treatmentRecommendation.js'
import { classifyParameter, type WQStatus } from './waterQualityEngine.js'

const standard = (maxValue: number, minValue: number | null = null) => ({
  kind: 'OFFICIAL_REFERENCE',
  referenceSource: 'BIS IS 10500:2012',
  maxValue,
  minValue,
})

function issue(parameter: string, value: number, status: WQStatus, max = 1, min: number | null = null) {
  return {
    parameter,
    displayName: parameter,
    value,
    unit: 'mg/L',
    status,
    explanation: `Measured ${value} is outside the configured limit.`,
    standard: status === 'NO_STANDARD_AVAILABLE' ? null : standard(max, min),
  }
}

test('current turbidity case keeps the verified treatment sequence', () => {
  const turbidity = classifyParameter(98, { minValue: null, maxValue: 5, warningValue: null, criticalValue: 5 })
  const ph = classifyParameter(7.1, { minValue: 6.5, maxValue: 8.5, warningValue: null, criticalValue: null })
  const tds = classifyParameter(380, { minValue: null, maxValue: 500, warningValue: null, criticalValue: 2000 })
  assert.equal(turbidity.status, 'ABOVE_PERMISSIBLE')
  assert.equal(ph.status, 'WITHIN_LIMIT')
  assert.equal(tds.status, 'WITHIN_LIMIT')
  const result = buildTreatmentRecommendation([issue('turbidity', 98, turbidity.status, 5)], ['fluoride', 'arsenic'])
  assert.deepEqual(result.sequence, ['Clarification', 'Sedimentation', 'Filtration'])
  assert.equal(result.executionStatus, 'NOT_STARTED')
})

test('all supported treatment faults produce structured categories', () => {
  const cases = [
    ['ph', 'BELOW_LIMIT', 'pH correction / neutralization under validated treatment design'],
    ['ph', 'ABOVE_PERMISSIBLE', 'pH reduction / neutralization under validated treatment design'],
    ['tds', 'ABOVE_PERMISSIBLE', 'Membrane treatment such as reverse osmosis where appropriate'],
    ['hardness', 'ABOVE_PERMISSIBLE', 'Water softening'],
    ['fluoride', 'ABOVE_PERMISSIBLE', 'Validated adsorption or ion exchange, such as activated alumina'],
    ['arsenic', 'ABOVE_PERMISSIBLE', 'Validated arsenic adsorption, ion exchange, or precipitation'],
    ['nitrate', 'ABOVE_PERMISSIBLE', 'Nitrate-specific ion exchange or membrane treatment where appropriate'],
    ['iron', 'ABOVE_PERMISSIBLE', 'Oxidation or aeration'],
    ['e_coli', 'ABOVE_PERMISSIBLE', 'Validated disinfection such as chlorine or UV'],
    ['total_coliform', 'ABOVE_PERMISSIBLE', 'Validated disinfection such as chlorine or UV'],
    ['residual_chlorine', 'ABOVE_PERMISSIBLE', 'Review disinfection process'],
    ['chloride', 'ABOVE_PERMISSIBLE', 'Chloride-specific treatment under validated design'],
    ['sulphate', 'ABOVE_PERMISSIBLE', 'Sulphate-specific treatment under validated design'],
    ['alkalinity', 'ABOVE_PERMISSIBLE', 'Alkalinity adjustment under validated design'],
  ] as const
  for (const [parameter, status, method] of cases) {
    const result = buildTreatmentRecommendation([issue(parameter, 2, status)], [])
    assert.equal(result.applicable, true, parameter)
    assert.equal(result.stages.some((stage) => stage.method === method), true, parameter)
    assert.equal(result.stages.every((stage) => stage.requiredEvidence.length > 0 && stage.postTreatmentVerification.length > 0), true, parameter)
  }
})

test('conductivity without a registered standard does not recommend standalone membrane treatment', () => {
  const result = buildTreatmentRecommendation([issue('conductivity', 900, 'NO_STANDARD_AVAILABLE')], [])
  assert.equal(result.applicable, false)
  assert.deepEqual(result.sequence, [])
  assert.match(result.engineeringReview[0], /NO_STANDARD_AVAILABLE/)
})

test('multiple faults retain every fault and produce an ordered structured sequence', () => {
  const result = buildTreatmentRecommendation([
    issue('turbidity', 98, 'ABOVE_PERMISSIBLE', 5),
    issue('tds', 2500, 'ABOVE_PERMISSIBLE', 500),
    issue('iron', 1, 'ABOVE_PERMISSIBLE', 0.3),
  ], [])
  assert.equal(result.primaryIssues.length, 3)
  assert.equal(result.stages.filter((stage) => stage.parameter === 'turbidity').length, 3)
  assert.equal(result.stages.some((stage) => stage.parameter === 'tds'), true)
  assert.equal(result.stages.some((stage) => stage.parameter === 'iron'), true)
  assert.equal(result.executionStatus, 'NOT_STARTED')
})

test('missing evidence is not treated as zero or safe', () => {
  const result = buildTreatmentRecommendation([], ['e_coli', 'fluoride'])
  assert.equal(result.applicable, false)
  assert.deepEqual(result.sequence, [])
  assert.deepEqual(result.additionalTests, ['e_coli', 'fluoride'])
  assert.equal(result.executionStatus, 'NOT_STARTED')
})
