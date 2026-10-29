"""이런 경우라면 — Next.js 판 lib/answer/cases.ts 와 같은 규칙.
토픽에 검수된 상황별 안내 중 질문에 맞는 것(when 낱말이 질문에 있음)을 앞에, 최대 max_n개. 문장은 생성하지 않음."""
from __future__ import annotations

from .search import normalize


def pick_cases(topic: dict | None, query: str, max_n: int = 3) -> list[dict]:
    cases = ((topic or {}).get("citizen") or {}).get("cases") or []
    q = normalize(query)
    ranked = sorted(enumerate(cases), key=lambda x: (not any(normalize(w) in q for w in x[1]["when"]), x[0]))
    return [{"situation": c["situation"], "detail": c["detail"], **({"ref": c["ref"]} if c.get("ref") else {})} for _, c in ranked[:max_n]]
