"""Problem detection/ranking on top of the deterministic statuses.

Ranks the problems the TypeScript engine already found. Severity comes ONLY
from deterministic statuses; no new breach is ever invented.
"""
from typing import Any, Dict, List

SEVERITY_WEIGHT = {"ABOVE_PERMISSIBLE": 3, "BELOW_LIMIT": 2, "ABOVE_ACCEPTABLE": 1}


def rank_problems(analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
    problems: List[Dict[str, Any]] = []
    for m in analysis.get("measurements", []) or []:
        status = str(m.get("status"))
        if status in SEVERITY_WEIGHT:
            problems.append({
                "parameter": m.get("parameter"),
                "displayName": m.get("displayName"),
                "value": m.get("value"),
                "unit": m.get("unit"),
                "status": status,
                "severityRank": SEVERITY_WEIGHT[status],
                "deterministicExplanation": m.get("explanation"),
                "provenance": m.get("provenance"),
            })
    problems.sort(key=lambda p: -p["severityRank"])
    for i, p in enumerate(problems, start=1):
        p["rank"] = i
    return problems
