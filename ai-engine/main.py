"""AquaSense Python AI engine.

Role: INTELLIGENT INTERPRETATION layer on top of the TypeScript deterministic
water-quality safety engine. It never replaces the deterministic engine and
never invents a measured value: every input is a JSON payload produced by the
AquaSense backend (analysis, decision, verification, historical cases).

Endpoints:
  GET  /health      -> liveness + honest capability report
  POST /analyze     -> current condition, problems, evidence sufficiency,
                       missing evidence, reasoning support, confidence support
  POST /verify      -> before/after treatment interpretation
  POST /historical  -> historical case intelligence interpretation

Run:  uvicorn main:app --host 0.0.0.0 --port 8000
Configure in the backend with AI_ENGINE_URL=http://127.0.0.1:8000
"""
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Dict, List, Optional, Union

from analysis.current_condition import summarize_current_condition
from analysis.problem_detection import rank_problems
from analysis.evidence_analysis import assess_evidence
from analysis.recommendation import support_recommendation
from analysis.verification import interpret_verification
from analysis.historical_intelligence import interpret_historical_cases

app = FastAPI(title="AquaSense Python AI Engine", version="1.0.0")

JsonObject = Dict[str, Any]
JsonBlob = Union[JsonObject, List[Any]]


class AnalyzePayload(BaseModel):
    """Accept dict or list for analysis/cases so a list-shaped backend payload is not HTTP 422."""

    model_config = ConfigDict(extra="allow")
    analysis: Optional[JsonBlob] = Field(None, description="Deterministic WaterQualityAnalysis JSON from the TypeScript engine")
    decision: Optional[JsonBlob] = Field(None, description="Deterministic WaterQualityDecision JSON (optional)")
    cases: Optional[JsonBlob] = Field(None, description="HistoricalCaseIntelligence / government cases JSON from the backend")


def _as_object(value: Any) -> JsonObject:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return {"measurements": value}
    return {}


def _as_cases(payload: AnalyzePayload) -> Optional[JsonObject]:
    raw = payload.cases
    if isinstance(raw, list):
        return {"historicalCases": raw, "summary": {}}
    if isinstance(raw, dict):
        return raw
    extra = payload.model_dump()
    if extra.get("historicalCases") is not None:
        return extra
    return None


def _as_decision(value: Any) -> Optional[JsonObject]:
    return value if isinstance(value, dict) else None


class VerifyPayload(BaseModel):
    verification: Dict[str, Any] = Field(..., description="TreatmentVerification JSON from the backend")


class HistoricalPayload(BaseModel):
    cases: Dict[str, Any] = Field(..., description="HistoricalCaseIntelligence JSON from the backend")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "engine": "python-interpreter",
        "role": "interpretation layer only — the TypeScript deterministic engine remains the safety authority",
        "ml": "none (no validated ML use case yet — scikit-learn deliberately unused)",
        "inventsValues": False,
    }


@app.post("/analyze")
def analyze(payload: AnalyzePayload) -> Dict[str, Any]:
    cases = _as_cases(payload)
    if cases is not None:
        return {
            "engine": "python-interpreter",
            "source": "PYTHON_AI",
            "historicalInterpretation": interpret_historical_cases(cases),
            "caveat": "Interpretation only. Historical government evidence is context and never becomes current evidence.",
        }
    analysis = _as_object(payload.analysis)
    current_condition = summarize_current_condition(analysis)
    evidence_sufficiency = assess_evidence(analysis)
    detected_problems = rank_problems(analysis)
    recommendation_support = support_recommendation(analysis, _as_decision(payload.decision))
    return {
        "engine": "python-interpreter",
        "source": "PYTHON_AI",
        "summary": current_condition.get("explanation") or "Current evidence was interpreted from the deterministic analysis.",
        "currentCondition": current_condition,
        "detectedProblems": detected_problems,
        "evidenceSufficiency": evidence_sufficiency,
        "recommendedActionSupport": recommendation_support,
        "limitations": [
            "Python AI interprets only the current deterministic analysis and never invents missing values.",
            "Missing parameters are not treated as safe.",
            "Post-treatment safety requires new measurements and verification.",
        ],
        "caveat": "Interpretation only. Deterministic statuses and the decision engine remain authoritative; no value was invented.",
    }


@app.post("/verify")
def verify(payload: VerifyPayload) -> Dict[str, Any]:
    return {
        "engine": "python-interpreter",
        "verificationInterpretation": interpret_verification(payload.verification),
        "caveat": "Interpretation only. The verification status is computed by the backend from real before/after measurements.",
    }


@app.post("/historical")
def historical(payload: HistoricalPayload) -> Dict[str, Any]:
    return {
        "engine": "python-interpreter",
        "historicalInterpretation": interpret_historical_cases(payload.cases),
        "caveat": "Interpretation only. Historical government evidence is context and never becomes current evidence.",
    }
