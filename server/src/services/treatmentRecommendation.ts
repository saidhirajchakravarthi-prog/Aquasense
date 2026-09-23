import type { WQStatus } from './waterQualityEngine.js'

export type TreatmentProcessCategory =
  | 'PRETREATMENT'
  | 'PRIMARY_TREATMENT'
  | 'POLISHING'
  | 'DISINFECTION'
  | 'POST_TREATMENT_VERIFICATION'

export interface TreatmentIssue {
  parameter: string
  displayName: string
  value: number | null
  unit: string | null
  status: WQStatus
  explanation: string
  standard: { kind: string; referenceSource: string } | null
}

export interface TreatmentStage {
  parameter: string
  fault: string
  processCategory: TreatmentProcessCategory
  sequenceOrder: number
  method: string
  rationale: string
  requiredEvidence: string[]
  postTreatmentVerification: string
  limitations: string[]
}

export interface TreatmentRecommendation {
  applicable: boolean
  evidenceSufficiency: 'SUFFICIENT_FOR_TARGETED_TREATMENT' | 'LIMITED' | 'INSUFFICIENT'
  primaryIssues: Array<{ parameter: string; displayName: string; value: number | null; unit: string | null; status: string; standard: string; why: string }>
  processRecommendations: Array<{ parameter: string; displayName: string; stages: string[]; rationale: string }>
  stages: TreatmentStage[]
  sequence: string[]
  additionalTests: string[]
  engineeringReview: string[]
  executionStatus: 'NOT_STARTED'
  executionNote: string
}

type RuleStage = Omit<TreatmentStage, 'parameter' | 'fault' | 'sequenceOrder'>
type TreatmentRule = {
  stages: RuleStage[]
  rationale: string
}

const VALIDATED_DESIGN = 'Requires chemistry confirmation and validated treatment design.'
const POST_VERIFICATION = 'Post-treatment verification with a new real measurement is required.'
const NO_EXECUTION = 'This is process guidance only; no operating setpoints are specified.'

/**
 * Process categories intentionally contain no dosage, concentration, flow,
 * pressure, contact-time, pump, or media-replacement instructions.
 */
const RULES: Record<string, TreatmentRule> = {
  turbidity: {
    stages: [
      { method: 'Clarification', processCategory: 'PRETREATMENT', rationale: 'High suspended solids support clarification before downstream treatment.', requiredEvidence: ['Current turbidity measurement', 'Registered turbidity standard'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Sedimentation', processCategory: 'PRETREATMENT', rationale: 'Settling is a solids-removal process category for elevated turbidity.', requiredEvidence: ['Current turbidity measurement', 'Source solids characterization'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Filtration', processCategory: 'POLISHING', rationale: 'Filtration can remove remaining suspended particles after clarification and settling.', requiredEvidence: ['Current turbidity measurement', 'Filter design validation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'High suspended solids support a clarification and solids-removal process. Validate the design for the actual source chemistry and flow.',
  },
  ph_low: {
    stages: [
      { method: 'pH correction / neutralization under validated treatment design', processCategory: 'PRIMARY_TREATMENT', rationale: 'Low pH requires controlled correction under a validated chemistry-specific design.', requiredEvidence: ['Confirmed pH measurement', 'Registered pH standard', 'Chemistry confirmation'], postTreatmentVerification: 'Post-treatment pH verification with a new real measurement.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Low pH can require neutralization, but the corrective chemistry and operating design must be validated for the source.',
  },
  ph_high: {
    stages: [
      { method: 'pH reduction / neutralization under validated treatment design', processCategory: 'PRIMARY_TREATMENT', rationale: 'High pH requires controlled reduction under a validated chemistry-specific design.', requiredEvidence: ['Confirmed pH measurement', 'Registered pH standard', 'Chemistry confirmation'], postTreatmentVerification: 'Post-treatment pH verification with a new real measurement.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'High pH can require neutralization, but the corrective chemistry and operating design must be validated for the source.',
  },
  hardness: {
    stages: [
      { method: 'Water softening', processCategory: 'PRIMARY_TREATMENT', rationale: 'Elevated hardness requires a chemistry-specific softening process.', requiredEvidence: ['Hardness measurement', 'Hardness standard', 'Source chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Ion exchange where validated', processCategory: 'PRIMARY_TREATMENT', rationale: 'Ion exchange is a possible hardness-treatment category only after design validation.', requiredEvidence: ['Hardness measurement', 'Ion-exchange design validation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Hardness requires chemistry-specific softening; ion exchange is a process category, not a universal prescription.',
  },
  tds: {
    stages: [
      { method: 'Pre-filtration', processCategory: 'PRETREATMENT', rationale: 'Pretreatment may be required before dissolved-load treatment.', requiredEvidence: ['TDS measurement', 'Suspended-solids assessment'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Membrane treatment such as reverse osmosis where appropriate', processCategory: 'PRIMARY_TREATMENT', rationale: 'Elevated dissolved solids may require a validated membrane process selected from confirmed chemistry and operating constraints.', requiredEvidence: ['TDS measurement', 'Salinity/chemistry confirmation', 'Validated membrane design'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Elevated dissolved solids require dissolved-load treatment selected from confirmed chemistry and operating constraints.',
  },
  fluoride: {
    stages: [
      { method: 'Validated adsorption or ion exchange, such as activated alumina', processCategory: 'PRIMARY_TREATMENT', rationale: 'Fluoride removal requires contaminant-specific validated media or ion exchange.', requiredEvidence: ['Fluoride laboratory measurement', 'Fluoride standard', 'Validated media/design selection'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Fluoride removal requires validated contaminant-specific media and confirmation testing.',
  },
  arsenic: {
    stages: [
      { method: 'Validated arsenic adsorption, ion exchange, or precipitation', processCategory: 'PRIMARY_TREATMENT', rationale: 'Arsenic treatment must use validated contaminant-specific chemistry and media.', requiredEvidence: ['Arsenic laboratory measurement', 'Arsenic standard', 'Speciation/chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Filtration', processCategory: 'POLISHING', rationale: 'Filtration may remove treatment-generated or precipitated solids when validated.', requiredEvidence: ['Validated treatment design', 'Solids/filtration assessment'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Arsenic treatment must use validated contaminant-specific chemistry and media.',
  },
  nitrate: {
    stages: [
      { method: 'Source protection', processCategory: 'PRETREATMENT', rationale: 'Source protection is part of nitrate control and reduces continued loading.', requiredEvidence: ['Nitrate laboratory measurement', 'Source investigation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Nitrate-specific ion exchange or membrane treatment where appropriate', processCategory: 'PRIMARY_TREATMENT', rationale: 'Nitrate requires a validated nitrate-specific removal process.', requiredEvidence: ['Nitrate laboratory measurement', 'Chemistry confirmation', 'Validated treatment design'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Nitrate control combines source protection with a validated nitrate-removal process.',
  },
  iron: {
    stages: [
      { method: 'Oxidation or aeration', processCategory: 'PRIMARY_TREATMENT', rationale: 'Iron removal commonly uses oxidation or aeration subject to source chemistry.', requiredEvidence: ['Iron measurement', 'Source chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Filtration', processCategory: 'POLISHING', rationale: 'Filtration can remove oxidized iron solids when validated.', requiredEvidence: ['Validated oxidation/aeration design', 'Solids/filtration assessment'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Iron removal commonly uses oxidation or aeration followed by solids filtration, subject to source chemistry.',
  },
  e_coli: {
    stages: [
      { method: 'Filtration as pretreatment where required', processCategory: 'PRETREATMENT', rationale: 'Pretreatment can reduce particulate load before disinfection where required by the design.', requiredEvidence: ['E. coli laboratory measurement', 'Turbidity/solids assessment'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Validated disinfection such as chlorine or UV', processCategory: 'DISINFECTION', rationale: 'Microbial contamination requires validated disinfection design.', requiredEvidence: ['E. coli laboratory measurement', 'Validated disinfection design'], postTreatmentVerification: 'Post-treatment microbiological verification with a new real sample.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Microbial contamination requires validated disinfection design and microbiological confirmation.',
  },
  total_coliform: {
    stages: [
      { method: 'Filtration as pretreatment where required', processCategory: 'PRETREATMENT', rationale: 'Pretreatment can reduce particulate load before disinfection where required by the design.', requiredEvidence: ['Total coliform laboratory measurement', 'Turbidity/solids assessment'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Validated disinfection such as chlorine or UV', processCategory: 'DISINFECTION', rationale: 'Microbial indicators require validated disinfection design.', requiredEvidence: ['Total coliform laboratory measurement', 'Validated disinfection design'], postTreatmentVerification: 'Post-treatment microbiological verification with a new real sample.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Microbial indicators require validated disinfection design and microbiological confirmation.',
  },
  residual_chlorine: {
    stages: [
      { method: 'Review disinfection process', processCategory: 'DISINFECTION', rationale: 'An out-of-range residual indicates that the disinfection process needs engineering review.', requiredEvidence: ['Residual chlorine measurement', 'Registered residual chlorine standard'], postTreatmentVerification: 'Post-treatment residual chlorine verification with a new real measurement.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
      { method: 'Adjust only under validated operating design', processCategory: 'DISINFECTION', rationale: 'Any adjustment must follow an approved design; no dosage or contact time is inferred here.', requiredEvidence: ['Validated operating design'], postTreatmentVerification: 'Post-treatment residual chlorine verification with a new real measurement.', limitations: [VALIDATED_DESIGN, NO_EXECUTION] },
    ],
    rationale: 'Residual chlorine issues require review of the disinfection process; no dosage or contact time is inferred here.',
  },
  chloride: {
    stages: [
      { method: 'Chloride-specific treatment under validated design', processCategory: 'PRIMARY_TREATMENT', rationale: 'Elevated chloride requires engineering review and a validated contaminant-specific process; no universal method is selected here.', requiredEvidence: ['Chloride measurement', 'Registered chloride standard', 'Chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, 'Requires engineering review.', NO_EXECUTION] },
    ],
    rationale: 'Chloride treatment is not universal; requires chemistry confirmation and validated treatment design.',
  },
  sulphate: {
    stages: [
      { method: 'Sulphate-specific treatment under validated design', processCategory: 'PRIMARY_TREATMENT', rationale: 'Elevated sulphate requires engineering review and a validated contaminant-specific process; no universal method is selected here.', requiredEvidence: ['Sulphate measurement', 'Registered sulphate standard', 'Chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, 'Requires engineering review.', NO_EXECUTION] },
    ],
    rationale: 'Sulphate treatment is not universal; requires chemistry confirmation and validated treatment design.',
  },
  alkalinity: {
    stages: [
      { method: 'Alkalinity adjustment under validated design', processCategory: 'PRIMARY_TREATMENT', rationale: 'Elevated alkalinity requires chemistry confirmation and engineering review rather than an assumed chemical treatment.', requiredEvidence: ['Alkalinity measurement', 'Registered alkalinity standard', 'Chemistry confirmation'], postTreatmentVerification: POST_VERIFICATION, limitations: [VALIDATED_DESIGN, 'Requires engineering review.', NO_EXECUTION] },
    ],
    rationale: 'Alkalinity treatment is source-specific and requires chemistry confirmation and validated treatment design.',
  },
}

const SUPPORTED_WITHOUT_STANDARD = new Set(['conductivity'])
const HARD_STATUSES = new Set<WQStatus>(['ABOVE_PERMISSIBLE', 'BELOW_LIMIT'])

function ruleKey(problem: TreatmentIssue): string {
  if (problem.parameter === 'ph')
    return problem.status === 'BELOW_LIMIT' ? 'ph_low' : 'ph_high'
  return problem.parameter
}

export function buildTreatmentRecommendation(
  problems: TreatmentIssue[],
  missingParameters: string[],
): TreatmentRecommendation {
  const actionable = problems.filter((problem) => RULES[ruleKey(problem)] && problem.standard !== null)
  const reviewOnly = problems.filter((problem) => SUPPORTED_WITHOUT_STANDARD.has(problem.parameter) && problem.standard === null)
  const stages = actionable.flatMap((problem) => RULES[ruleKey(problem)].stages.map((stage, index) => ({
    ...stage,
    parameter: problem.parameter,
    fault: `${problem.displayName} ${problem.status}`,
    sequenceOrder: index + 1,
  }))).sort((a, b) => {
    const categoryOrder: Record<TreatmentProcessCategory, number> = {
      PRETREATMENT: 1, PRIMARY_TREATMENT: 2, POLISHING: 3, DISINFECTION: 4, POST_TREATMENT_VERIFICATION: 5,
    }
    return categoryOrder[a.processCategory] - categoryOrder[b.processCategory] || a.sequenceOrder - b.sequenceOrder
  })
  const sequence = [...new Set(stages.map((stage) => stage.method))]
  const hardIssue = actionable.some((problem) => HARD_STATUSES.has(problem.status))
  const evidenceSufficiency = actionable.length === 0
    ? 'INSUFFICIENT'
    : missingParameters.length > 0 || problems.some((problem) => problem.status === 'ABOVE_ACCEPTABLE')
      ? 'LIMITED'
      : hardIssue
        ? 'SUFFICIENT_FOR_TARGETED_TREATMENT'
        : 'LIMITED'

  return {
    applicable: actionable.length > 0,
    evidenceSufficiency,
    primaryIssues: actionable.map((problem) => ({
      parameter: problem.parameter,
      displayName: problem.displayName,
      value: problem.value,
      unit: problem.unit,
      status: problem.status,
      standard: problem.standard ? `${problem.standard.kind} — ${problem.standard.referenceSource}` : 'NO_STANDARD_AVAILABLE',
      why: problem.explanation,
    })),
    processRecommendations: actionable.map((problem) => ({
      parameter: problem.parameter,
      displayName: problem.displayName,
      stages: RULES[ruleKey(problem)].stages.map((stage) => stage.method),
      rationale: RULES[ruleKey(problem)].rationale,
    })),
    stages,
    sequence,
    additionalTests: missingParameters,
    engineeringReview: [
      ...reviewOnly.map((problem) => `${problem.displayName}: NO_STANDARD_AVAILABLE — requires supporting chemistry evidence and validated treatment design; no standalone treatment is recommended.`),
      ...problems.filter((problem) => !RULES[ruleKey(problem)] && !SUPPORTED_WITHOUT_STANDARD.has(problem.parameter)).map((problem) => `${problem.displayName}: no centralized treatment rule is registered; REQUIRES ENGINEERING REVIEW.`),
    ],
    executionStatus: 'NOT_STARTED',
    executionNote: 'Recommendation only. No pump, relay, purification, or treatment command was started by this analysis.',
  }
}
