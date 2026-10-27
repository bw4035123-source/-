"""판례·법령해석례 관련도 정리 — Next.js 판 lib/law-api/case-rank.ts 와 같은 규칙
본문 검색(search=2)은 긴 판결문이 낱말 하나만 언급해도 걸리므로, 목록의 제목만으로 다시 거른다.
해석례 제목 앞 질의기관 표기('민원인 - ')는 떼고 보고, 질문 낱말이 제목에 있거나 2글자 묶음이 절반 이상 겹치는 것만, 같은 제목은 한 번만."""
from __future__ import annotations

import re

from .search import GENERIC_CASE, bigrams, normalize, query_terms

_ORG_PREFIX = re.compile(r"^[^「」\-]{1,40}?\s+-\s*")


def case_core_title(c: dict) -> str:
    return _ORG_PREFIX.sub("", c["title"], count=1) if c["kind"] == "법령해석례" else c["title"]


def case_query_tokens(query: str) -> list[str]:
    raw = [w for w in re.split(r"[^\w]+", query) if len(w) >= 2]
    return list(dict.fromkeys(t for t in (normalize(w) for w in [*query_terms(query, 6), *raw]) if len(t) >= 2))


def case_head_word(query: str) -> str | None:
    """여러 낱말 검색어의 중심어(첫 낱말) — 제목에 이 말이 없으면 곁가지 낱말('겸직 허가'의 '허가')만 같은 엉뚱한 건으로 본다. 첫 낱말이 넓은 말('공무원')이면 따지지 않음"""
    raw = [w for w in re.split(r"[^\w]+", query) if len(w) >= 2]
    head = normalize(raw[0]) if len(raw) >= 2 else ""
    return head if len(head) >= 2 and head not in GENERIC_CASE else None


def case_score(query: str, c: dict) -> float:
    title = normalize(case_core_title(c))
    head = case_head_word(query)
    if head and head not in title:
        return 0.0
    hits = sum(1 for t in case_query_tokens(query) if t in title)
    qg = bigrams(query)
    over = (len(qg & bigrams(case_core_title(c))) / len(qg)) if qg else 0.0
    return hits * 2 + over if hits else (over if over >= 0.5 else 0.0)


def rank_cases(query: str, items: list[dict], max_n: int) -> list[dict]:
    scored = sorted(((case_score(query, c), i, c) for i, c in enumerate(items)), key=lambda x: (-x[0], x[1]))
    seen, out = set(), []
    for s, _, c in scored:
        if s <= 0:
            continue
        k = f"{c['kind']}:{normalize(case_core_title(c))}"
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out[:max_n]
