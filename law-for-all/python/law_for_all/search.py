"""경량 한국어 검색 엔진 — 문자 2-gram 겹침 + 생활 표현 트리거(Next.js 판 search.ts 와 동일 알고리즘)"""
from __future__ import annotations

import re

from .data import LAWS, TOPICS

_NON_WORD = re.compile(r"[^\w%]|_", re.UNICODE)


def normalize(s: str) -> str:
    """소문자화 + 공백·문장부호 제거(비율 표현을 위해 % 유지)"""
    return _NON_WORD.sub("", s.lower())


def bigrams(s: str) -> set[str]:
    n = normalize(s)
    out: set[str] = set()
    if len(n) == 1:
        out.add(n)
    for i in range(len(n) - 1):
        out.add(n[i:i + 2])
    return out


def _overlap(q: set[str], target: set[str]) -> float:
    if not q or not target:
        return 0.0
    return sum(1 for g in q if g in target) / len(q)


def match_topics(query: str) -> list[dict]:
    """[{topic, score}] 점수 내림차순"""
    nq = normalize(query)
    qg = bigrams(query)
    hits = []
    for topic in TOPICS:
        score = 0.0
        # 정규화하면 같은 표현(예: '처리 기한'·'처리기한')은 한 번만 계산
        for nt in dict.fromkeys(normalize(t) for t in topic["triggers"]):
            if len(nt) >= 2 and nt in nq:
                score += 2 + len(nt) * 0.5
        score += _overlap(qg, bigrams(topic["label"] + " ".join(topic["triggers"]))) * 2
        if score >= 1.2:
            hits.append({"topic": topic, "score": score})
    hits.sort(key=lambda h: -h["score"])
    return hits


_INDEX = [
    {
        "law": law,
        "article": art,
        "titleGrams": bigrams(f"{law['name']} {law.get('shortName') or ''} {art['title']}"),
        "keyGrams": bigrams(" ".join(art.get("keywords") or [])),
        "textGrams": bigrams(art["text"]),
        "keywords": [normalize(k) for k in art.get("keywords") or []],
    }
    for law in LAWS
    for art in law["articles"]
]


def search_articles(query: str, limit: int = 8) -> list[dict]:
    """[{law, article, score}]"""
    nq = normalize(query)
    qg = bigrams(query)
    if not nq:
        return []
    hits = []
    for e in _INDEX:
        score = _overlap(qg, e["titleGrams"]) * 3 + _overlap(qg, e["keyGrams"]) * 3 + _overlap(qg, e["textGrams"]) * 1.5
        for k in e["keywords"]:
            if len(k) >= 2 and k in nq:
                score += 2
        if normalize(e["law"]["name"]) in nq:
            score += 1.5
        if score >= 1.0:
            hits.append({"law": e["law"], "article": e["article"], "score": score})
    hits.sort(key=lambda h: -h["score"])
    return hits[:limit]


def search_law_names(query: str) -> list[dict]:
    nq = normalize(query)
    if not nq:
        return list(LAWS)
    qg = bigrams(query)
    scored = []
    for law in LAWS:
        hay = f"{law['name']} {law.get('shortName') or ''} " + " ".join(a["title"] + " " + " ".join(a.get("keywords") or []) for a in law["articles"])
        s = _overlap(qg, bigrams(hay))
        if nq in normalize(law["name"]) or nq in normalize(law.get("shortName") or ""):
            s += 2
        if s >= 0.5:
            scored.append((s, law))
    scored.sort(key=lambda x: -x[0])
    return [l for _, l in scored]
