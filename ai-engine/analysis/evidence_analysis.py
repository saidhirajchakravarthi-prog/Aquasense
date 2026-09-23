"""Evidence sufficiency assessment over the deterministic analysis.

Uses pandas only to tabulate what the TypeScript engine already measured.
It never upgrades evidence and never treats missing data as safe.
"""
from typing import Any, Dict

import pandas as pd


def assess_evidence(analysis: Dict[str, Any]) -> Dict[str, Any]:
    evidence = analysis.get("evidence", {}) or {}
    measurements = pd.DataFrame(analysis.get("measurements", []) or [])
    not_measured = pd.DataFrame(analysis.get("notMeasured", []) or [])

    graded = 0
    if not measurements.empty:
        graded = int((~measurements["status"].isin(["NO_STANDARD_AVAILABLE", "NOT_MEASURED"])).sum())

    ungraded = int((measurements["status"] == "NO_STANDARD_AVAILABLE").sum()) if not measurements.empty else 0
    sufficiency = evidence.get("sufficiency", "NO_DATA")

    verdict = {
        "NO_DATA": "INSUFFICIENT: no measurements exist.",
        "ACTION_EVIDENCE": "LIMITED: there is action evidence (a breach), but unmeasured parameters still constrain any conclusion.",
        "ADEQUATE_FOR_MEASURED_PARAMETERS": "PARTIAL: measured parameters are covered, but unmeasured parameters prevent a complete picture.",
        "INSUFFICIENT_EVIDENCE": "INSUFFICIENT: coverage is too thin to support a conclusion.",
    }.get(str(sufficiency), f"UNGRADED: {sufficiency}")

    return {
        "deterministicSufficiency": sufficiency,
        "verdict": verdict,
        "measuredCount": int(len(measurements)),
        "gradedAgainstStandardCount": graded,
        "noStandardCount": ungraded,
        "notMeasuredCount": int(len(not_measured)),
        "missingParameters": analysis.get("missingParameters", []) or [],
        "rule": "Missing parameters are NEVER treated as safe (deterministic engine rule, respected here).",
    }
