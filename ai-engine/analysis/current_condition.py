"""Current-condition summarization.

Consumes the deterministic WaterQualityAnalysis JSON. It NEVER invents a value:
every sentence is assembled from the measurement statuses the TypeScript
engine already computed.
"""
from typing import Any, Dict, List

STATUS_ORDER = ["ABOVE_PERMISSIBLE", "BELOW_LIMIT", "ABOVE_ACCEPTABLE", "WITHIN_LIMIT", "NO_STANDARD_AVAILABLE", "NOT_MEASURED"]


def summarize_current_condition(analysis: Dict[str, Any]) -> Dict[str, Any]:
    overall = analysis.get("overall", {})
    measurements: List[Dict[str, Any]] = analysis.get("measurements", []) or []
    not_measured: List[Dict[str, Any]] = analysis.get("notMeasured", []) or []

    by_status: Dict[str, List[str]] = {}
    for m in measurements:
        label = f"{m.get('displayName')} = {m.get('value')}{(' ' + m['unit']) if m.get('unit') else ''} ({m.get('status')})"
        by_status.setdefault(str(m.get("status")), []).append(label)

    lines: List[str] = []
    if overall.get("status") == "NO_DATA" or not measurements:
        lines.append("No real measurement exists for this water source yet; nothing can be interpreted.")
    else:
        for status in STATUS_ORDER:
            items = by_status.get(status)
            if items:
                lines.append(f"{status}: " + "; ".join(items) + ".")
        if not_measured:
            names = ", ".join(str(m.get("displayName")) for m in not_measured[:8])
            more = "" if len(not_measured) <= 8 else f" (+{len(not_measured) - 8} more)"
            lines.append(f"NOT MEASURED (never treated as safe): {names}{more}.")

    return {
        "deterministicOverall": overall.get("status"),
        "summaryLines": lines,
        "measuredCount": len(measurements),
        "notMeasuredCount": len(not_measured),
        "explanation": overall.get("explanation"),
        "caveat": overall.get("caveat"),
    }
