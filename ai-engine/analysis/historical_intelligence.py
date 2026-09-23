"""Historical case intelligence interpretation.

Consumes the backend HistoricalCaseIntelligence JSON. The backend has already
enforced the hard rules (value-based records only; WQ6 counts context-only;
documented actions only when actually present). This module ranks and explains
the result — it never upgrades similarity or invents an action.
"""
from typing import Any, Dict, List

SIMILARITY_RANK = {"SIMILAR_CASE": 0, "POSSIBLE_SIMILAR_CASE": 1, "HISTORICAL_CONFLICT": 2}


def interpret_historical_cases(cases: Dict[str, Any]) -> Dict[str, Any]:
    found: List[Dict[str, Any]] = cases.get("historicalCases", []) or []
    summary = cases.get("summary", {}) or {}
    ranked = sorted(found, key=lambda c: SIMILARITY_RANK.get(str(c.get("similarity")), 99))

    classification = "NO_RELEVANT_CASE"
    if summary.get("similar", 0) > 0:
        classification = "SIMILAR_CASE"
    elif found:
        classification = "POSSIBLE_SIMILAR_CASE" if summary.get("possible", 0) > 0 else "HISTORICAL_CONFLICT"

    return {
        "classification": classification,
        "summary": summary,
        "interpretation": cases.get("interpretation"),
        "rankedCases": [
            {
                "parameter": c.get("parameter"),
                "historicalValue": c.get("value"),
                "unit": c.get("unit"),
                "historicalStatus": c.get("statusAgainstStandard"),
                "similarity": c.get("similarity"),
                "locationMatch": c.get("locationMatch"),
                "location": c.get("location"),
                "timeContext": c.get("timeContext"),
                "actionAvailability": c.get("actionAvailability"),
                "documentedAction": c.get("documentedAction"),
                "provenance": {"organization": c.get("organization"), "dataset": c.get("datasetName"), "year": c.get("datasetYear"), "sourceUrl": c.get("sourceUrl")},
            }
            for c in ranked
        ],
        "contextualCounts": cases.get("contextualCounts", []) or [],
        "limitations": cases.get("limitations", []) or [],
    }
