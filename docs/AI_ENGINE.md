# AI assessment boundary

The current `/api/ai/analyze` endpoint is a transparent, deterministic assessment fallback. It produces the JSON shape expected by an AI client while no provider key is configured. In production, a secure server-side provider may replace this logic only after passing the same provenance, missing-data, and safety constraints.

The browser never receives an AI API key. Output is decision support, not a laboratory result, drinking-water certification, or government decision.
