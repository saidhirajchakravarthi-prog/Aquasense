"""Recommendation support.

The deterministic decision engine remains authoritative. This module only
explains WHY the deterministic decision makes sense and which missing tests
matter most — it never changes the decision.
"""
from typing import Any, Dict, Optional

PRIORITY = ["e_coli", "total_coliform", "fluoride", "arsenic", "nitrate", "iron"]


def support_recommendation(analysis: Dict[str, Any], decision: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    deterministic_decision = (decision or {}).get("decision") or (
        "INSUFFICIENT_EVIDENCE" if (analysis.get("overall", {}) or {}).get("status") == "NO_DATA" else None
    )
    missing = analysis.get("missingParameters", []) or []
    priority_missing = [p for p in PRIORITY if p in missing]
    treatment = (decision or {}).get("treatmentRecommendation") or {}
    treatment_sequence = treatment.get("sequence") or []
    return {
        "deterministicDecision": deterministic_decision,
        "authoritative": True,
        "supportNotes": [
            f"Deterministic decision '{deterministic_decision}' is based only on measured values against registered standards."
            if deterministic_decision else "No deterministic decision was supplied.",
            f"Priority unmeasured tests: {', '.join(priority_missing)}." if priority_missing
            else "No high-priority microbiological/chemical test is missing from the expected checklist.",
            "Unmeasured parameters were never treated as safe by the deterministic engine, and this interpretation keeps that rule.",
            f"Deterministic treatment sequence: {' -> '.join(treatment_sequence)}."
            if treatment_sequence else "No deterministic treatment sequence is applicable to the supplied evidence.",
            f"Treatment execution status remains {treatment.get('executionStatus', 'NOT_STARTED')}; this service cannot start treatment.",
        ],
        "recommendedAction": (decision or {}).get("recommendedAction"),
        "treatmentRecommendation": {
            "sequence": treatment_sequence,
            "evidenceSufficiency": treatment.get("evidenceSufficiency"),
            "executionStatus": treatment.get("executionStatus", "NOT_STARTED"),
            "limitations": [
                "Treatment stages are process categories, not an engineered plant design.",
                "Chemistry confirmation and validated treatment design are required where stated.",
            ],
        },
        "reasoningTrace": (decision or {}).get("reasoning", []) or [],
    }
