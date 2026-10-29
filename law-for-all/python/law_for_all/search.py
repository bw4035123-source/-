"""경량 한국어 검색 엔진 — 문자 2-gram 겹침 + 생활 표현 트리거(Next.js 판 search.ts 와 동일 알고리즘)"""
from __future__ import annotations

import re
import unicodedata

from .data import LAW_ALIASES, LAWS, TOPICS

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


def trigger_score(nq: str, trigger: str) -> float:
    """트리거 일치 점수(0 = 불일치): "A+B"는 모든 말이 들어 있을 때만(순서 무관). nq 는 normalize 된 질문"""
    parts = [normalize(p) for p in trigger.split("+")]
    ln = sum(len(p) for p in parts)
    return 2 + ln * 0.5 if ln >= 2 and all(len(p) >= 1 and p in nq for p in parts) else 0.0


def match_law_aliases(query: str) -> list[dict]:
    """생활 용어 → 법령 사전에서 질문에 해당하는 항목(실시간 검색 보조)"""
    nq = normalize(query)

    def hit(w: str) -> bool:
        # 두 글자 낱말(예: '산재')은 질문에서도 낱말 첫머리일 때만('화산재'≠'산재')
        if "+" not in w and len(normalize(w)) == 2:
            return _word_start_has(query, w)
        return trigger_score(nq, w) > 0

    return [a for a in LAW_ALIASES if any(hit(w) for w in a["when"])]


# 판례 검색에 쓰기엔 너무 넓은 말(이 말만으로 찾으면 관계없는 판례가 섞임)
GENERIC_CASE = {"공무원", "기준", "경우", "가능", "방법", "사유", "절차", "관련", "문제", "내용", "금액", "정도", "기간", "신청", "처리", "여부", "규정", "법적", "법률"}
# 생활 용어 → 판결문에 쓰이는 말(판례 제목은 '최저시급'이 아니라 '최저임금'으로 적힘)
CASE_TERM = {"최저시급": "최저임금"}


def live_case_query(query: str) -> str | None:
    """내장 토픽이 없는 질문(실시간 검색 답변)의 판례 검색어 — 생활 용어 사전에서 걸린 말을 우선, 없으면 넓은 말을 뺀 질문 낱말 두 개"""
    nq = normalize(query)
    for a in LAW_ALIASES:
        for w in a["when"]:
            hit = _word_start_has(query, w) if "+" not in w and len(normalize(w)) == 2 else trigger_score(nq, w) > 0
            if hit:
                return CASE_TERM.get(w) or w.replace("+", " ")
    # 동사 꼬리가 남은 말(당했어·됐는 등)도 뺀다
    terms = [t for t in query_terms(query, 6) if t not in GENERIC_CASE and not re.search(r"(했어|됐어|했는|됐는|있어|없어|당했)$", t)]
    return " ".join(terms[:2]) if terms else None


def _word_start_has(text: str, term: str) -> bool:
    """글 안에 말이 낱말 첫머리로 들어 있는지(맨 앞이거나 띄어쓰기·문장부호·가운뎃점 뒤)"""
    i = text.find(term)
    while i >= 0:
        if i == 0 or text[i - 1].isspace() or text[i - 1] in "ㆍ·" or unicodedata.category(text[i - 1]).startswith("P"):
            return True
        i = text.find(term, i + 1)
    return False


def law_name_has(name: str, term: str) -> bool:
    """법령명에 검색어가 '낱말로' 들어 있는지 — 두 글자 말은 이름 첫머리나 띄어쓰기·가운뎃점 뒤에서만('사기'≠'군사기밀')"""
    return term in name if len(term) >= 3 else _word_start_has(name, term)


def law_name_looks_like(name: str, terms: list[str]) -> bool:
    """실시간 검색 법령을 근거로 써도 될 만큼 이름이 질문과 닮았는지(Next.js 판 lawNameLooksLike 와 같음) —
    질문 낱말 2개 이상이 이름에 있거나, 낱말 하나가 이름의 40% 이상이거나 4글자 이상('학교폭력'),
    또는 짧은 법령 이름의 핵심어가 질문 낱말에 들어 있을 때('건축법' ← '건축허가')"""
    hits = [t for t in terms if len(t) >= 2 and law_name_has(name, t)]
    n = normalize(name)
    core = n[:-1] if re.fullmatch(r"[가-힣]+법", n) else ""
    return len(hits) >= 2 or any(len(t) >= 4 or len(t) / (len(n) or 1) >= 0.4 for t in hits) or (len(core) >= 2 and any(core in t for t in terms))


def match_topics(query: str) -> list[dict]:
    """[{topic, score}] 점수 내림차순"""
    nq = normalize(query)
    qg = bigrams(query)
    hits = []
    for topic in TOPICS:
        score = 0.0
        # 정규화하면 같은 표현(예: '처리 기한'·'처리기한')은 한 번만 계산.
        # "전세+사기"처럼 +로 이은 트리거는 모든 말이 들어 있을 때만(순서 무관) — 혼자서는 너무 넓은 말('사기'·'경매')을 문맥으로 좁힘
        for key in dict.fromkeys("+".join(normalize(p) for p in t.split("+")) for t in topic["triggers"]):
            score += trigger_score(nq, key) * topic.get("weight", 1)
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

def strong_local_hit(title: str, keywords: list[str], query: str) -> bool:
    """실시간 검색과 함께 쓸 내장 조문인지: 질문 단어 2개 이상이 조문 제목에 있거나, 세 글자 이상 조문 키워드가 질문에 그대로 있을 때.
    두 글자 키워드('갱신'·'반환'·'고소')는 다른 법에도 흔해, 제목 단어나 다른 키워드가 하나 더 맞을 때만 인정 — lib/law-api/search.ts 와 같음"""
    nq = normalize(query)
    t = sum(1 for x in query_terms(query) if x in title)
    # 키워드는 낱말 첫머리에서 시작할 때만('피해구제 신청'≠'구제신청')
    kw = [w for w in (normalize(w) for w in keywords) if len(w) >= 2 and w in nq and _word_start_has(query, w[:2])]
    return t >= 2 or any(len(w) >= 3 for w in kw) or (bool(kw) and (t >= 1 or len(kw) >= 2))


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
