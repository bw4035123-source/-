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


# ───────────── 실시간(국가법령정보 Open API) 검색용 질의어 추출
_STOP = {"필요", "가능", "문제", "상황", "사람", "정도", "이유", "때문", "되나", "하나", "어디", "누가", "뭐가", "무슨", "있나", "없나", "어떻게", "어떤", "무엇", "뭔가요", "궁금", "궁금해요", "알려", "알려주세요", "있나요", "되나요", "하나요", "인가요", "경우", "관련", "대해", "대한", "기준", "방법", "절차", "내용", "얼마", "언제", "까지", "그리고", "하는", "하면", "해야", "있는", "없는", "됩니다", "합니다", "주세요", "싶어요", "문의"}
_SUFFIX = re.compile(r"(으로부터|에서는|에게서|으로는|이라도|에서|에게|으로|이나|이랑|까지|부터|보다|처럼|마다|은|는|이|가|을|를|에|의|로|와|과|도|만|요|나|랑)$")

# 생활어 → 법령 용어(법령명·본문 검색이 잘 되는 말)
_SYNONYM = {"술": "주류", "팔": "판매", "파는": "판매", "팔아": "판매", "강아지": "동물", "반려견": "동물", "고양이": "동물", "월급": "임금", "집주인": "임대인", "세입자": "임차인", "알바": "근로자", "담배": "담배", "차": "자동차"}
_VERB = re.compile(r"(받나요|받으면|받는|받나|받아|받|했는데요|했는데|했어요|되나요|하나요|됩니다|합니다|하려면|되려면|으려면|려면|하면|되면|되나|하나|되는|하는|되어|해서|해요|돼요|되|하|해|으면|면)$")
# 끝 글자가 조사처럼 보여도 명사의 일부인 말
_KEEP = re.compile(r"(허가|평가|국가|대가|단가|원가|시가|휴가|증가|추가|참가|전문가|주가|지가|차이|나이|아이|거리|자리|자료|도로|경로|진로|근로|노무|임대료|과태료|수수료|보험료)$")


def query_terms(query: str, max_n: int = 4) -> list[str]:
    """질문 → 법령명·조문 검색어(2글자 이상, 조사 제거, 중복 제거, 긴 말 우선)"""
    out: list[str] = []
    for raw in re.split(r"[^\w]+|_", query):
        w = raw.strip()
        for _ in range(2):
            if len(w) > 2 and _SUFFIX.search(w) and not _KEEP.search(w):
                w = _SUFFIX.sub("", w)
        if len(w) >= 2 and _VERB.search(w) and not _KEEP.search(w):
            w = _VERB.sub("", w)
        syn = _SYNONYM.get(raw) or _SYNONYM.get(w)
        if syn:
            if syn not in out:
                out.append(syn)
            if len(w) < 2:
                continue
        if len(w) < 2 or w in _STOP or w.isdigit():
            continue
        if w not in out:
            out.append(w)
    return sorted(out, key=len, reverse=True)[:max_n]


def bigram_overlap(name: str, terms: list[str]) -> float:
    """법령명과 검색어들의 2-gram 겹침 비율(0~1)"""
    return _overlap(bigrams("".join(terms)), bigrams(name))


def score_article_by_terms(article: dict, terms: list[str]) -> int:
    title, text = normalize(article["title"]), normalize(article["text"])
    return sum((3 if normalize(t) in title else 0) + (1 if normalize(t) in text else 0) for t in terms)
