"""Before/after treatment verification interpretation.

Consumes the backend TreatmentVerification JSON (real before/after PostgreSQL
measurements, statuses already computed). Uses numpy only for arithmetic on
the PROVIDED numbers — no value is ever invented.
"""
from typing import Any, Dict, List

import numpy as np

STATUS_LABELS = {
    "IMPROVEMENT_VERIFIED": "Improvement verified against registered standards for the compared parameters only.",
    "PARTIAL_IMPROVEMENT": "Mixed result: some parameters improved while others worsened.",
    "NO_IMPROVEMENT": "No measurable improvement was produced by the treatment.",
    "INSUFFICIENT_EVIDENCE": "Not enough real before/after evidence to verify anything.",
}


def interpret_verification(verification: Dict[str, Any]) -> Dict[str, Any]:
    status = str(verification.get("status"))
    comparisons: List[Dict[str, Any]] = verification.get("comparisons", []) or []
    deltas = [
        c["change"]["absolute"]
        for c in comparisons
        if c.get("change") and isinstance(c["change"].get("absolute"), (int, float))
    ]
    stats = {}
    if deltas:
        arr = np.array(deltas, dtype=float)
        stats = {
            "meanAbsoluteChange": float(np.mean(np.abs(arr))),
            "maxImprovement": float(np.min(arr)),
            "maxWorsening": float(np.max(arr)),
            "comparedCount": int(len(arr)),
        }
    pump = verification.get("treatmentAction")
    return {
        "deterministicStatus": status,
        "meaning": STATUS_LABELS.get(status, status),
        "explanation": verification.get("explanation"),
        "changeStatistics": stats,
        "pumpCommandNote": (
            f"Latest command context: {pump.get('command')} ({pump.get('status')}) — a queued command is NOT proof of purification."
            if pump else "No pump command on record; the verification is measurement-based only."
        ),
        "comparedParameters": [
            {
                "parameter": c.get("parameter"),
                "direction": c.get("direction"),
                "evidenceStatus": c.get("evidenceStatus"),
                "before": None if not c.get("before") else {"value": c["before"].get("value"), "unit": c["before"].get("unit"), "timestamp": c["before"].get("timestamp"), "source": c["before"].get("source")},
                "after": None if not c.get("after") else {"value": c["after"].get("value"), "unit": c["after"].get("unit"), "timestamp": c["after"].get("timestamp"), "source": c["after"].get("source")},
            }
            for c in comparisons
        ],
        "limitations": verification.get("limitations", []) or [],
    }
