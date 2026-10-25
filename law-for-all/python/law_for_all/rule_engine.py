"""규칙기반 답변 조립 — 토픽 사전(검수 문장) 또는 검색된 조문 원문만 사용(생성형 문장 없음)"""
from __future__ import annotations

import re

from .data import article_label
from .search import normalize, query_terms, score_article_by_terms


def first_sentence(text: str, max_len: int = 90) -> str:
    line = re.sub(r"^[①-⑳]\s*", "", text.split("\n")[0])
    s = re.split(r"(?<=다\.)\s", line)[0]
    return s[:max_len] + "…" if len(s) > max_len else s


def _byeolpyo(c: dict) -> str:
    """조문에 붙은 별표 요지의 첫 줄(없으면 빈 문자열)"""
    return next((l for l in c["text"].split("\n") if l.startswith("[별표")), "")


def _pinpoint(query: str, topic: dict, citations: list[dict]) -> str:
    """질문이 토픽 안의 특정 조문을 제목으로 가리키는데(예: '외부강의 사례금' → 청탁금지법 제10조) 토픽 요약이 그 조문을 다루지 않으면 앞에 붙일 문장"""
    terms = [t for t in query_terms(query) if len(t) >= 3 and normalize(t) not in normalize(topic["label"])]
    # 흔한 말 하나('보증금'·'과태료')로는 붙이지 않음: 질문 낱말 두 개 이상이 제목에 있거나 제목 자체가 그 말일 때만(토픽 조문 안에서)
    def in_title(c):
        return [t for t in terms if normalize(t) in normalize(c["title"]) and normalize(t) not in normalize(c["lawName"])]

    hits = [c for c in citations if c["key"] in topic["refs"] and (len(in_title(c)) >= 2 or any(normalize(t) == normalize(c["title"]) for t in in_title(c)))]
    # 금액·기준이 든 별표 요지가 있는 조문(시행령)을 우선 — "상한은?" 같은 질문에 실제 금액으로 답함
    hit = sorted(hits, key=lambda c: -(score_article_by_terms(c, terms) + (10 if _byeolpyo(c) else 0)))[0] if hits else None
    if not hit or f"[[{hit['key']}]]" in topic["citizen"]["summary"]:
        return ""
    table = _byeolpyo(hit)
    return f"「{hit['lawName']}」 {article_label(hit['articleNo'])}({hit['title']}): {first_sentence(hit['text'], 220)}{' ' + table if table else ''} [[{hit['key']}]] "


def build_rule_answer(query: str, topic: dict | None, citations: list[dict]) -> dict:
    if topic:
        c, o = topic["citizen"], topic["officer"]
        citizen = {"easyTerms": c["easyTerms"], "steps": c["steps"]}
        if c.get("tip"):
            citizen["tip"] = c["tip"]
        return {"summary": _pinpoint(query, topic, citations) + c["summary"], "citizen": citizen, "officer": {k: o[k] for k in ("background", "keyPoints", "adminNotes", "checklist")}}

    if not citations:
        return {
            "summary": f"'{query}'와(과) 직접 관련된 조문을 찾지 못했어요. {'' if re.search('[가-힣]', query) else '법이음은 한국어 질문으로 근거를 찾아요. '}더 구체적인 상황(예: \"전세 보증금\", \"육아휴직 급여\", \"민원 처리 기한\")으로 다시 검색해 보세요.",
            "citizen": {"easyTerms": [], "steps": [
                {"title": "검색어 바꿔 보기", "detail": "상황을 나타내는 핵심 단어(누가·무엇을·어떻게)를 넣어 다시 검색해 보세요."},
                {"title": "정부민원안내콜센터 문의", "detail": "어느 기관 소관인지 모를 때는 110으로 전화하면 담당 기관을 안내받을 수 있어요."},
                {"title": "무료 법률상담", "detail": "대한법률구조공단(132)에서 무료 법률상담을 받을 수 있어요."},
            ]},
            "officer": {
                "background": "관련 조문이 검색되지 않음(내장 법령 데이터, 연동 시 국가법령정보 Open API 전체 현행 법령 기준).",
                "keyPoints": [], "adminNotes": ["소관 법령이 불분명한 경우 법제처 법령해석 및 소관 부처 질의 검토"], "checklist": ["검색어 재설정", "소관 부처 확인"],
            },
        }

    top = citations[:3]
    lst = ", ".join(f"「{c['lawName']}」 {article_label(c['articleNo'])}({c['title']}) [[{c['key']}]]" for c in top)
    return {
        "summary": f"질문과 관련된 조문으로 {lst}이(가) 확인돼요. 핵심 내용은 다음과 같아요: {first_sentence(top[0]['text'])} [[{top[0]['key']}]]",
        "citizen": {"easyTerms": [], "steps": [
            {"title": "근거 조문 원문 확인", "detail": "오른쪽 근거 조문 카드를 눌러 원문 전체를 확인하세요.", "ref": top[0]["key"]},
            {"title": "담당 기관 상담", "detail": "정부민원안내콜센터(110)에 문의하면 소관 기관을 안내받을 수 있어요."},
            {"title": "전문가 도움 받기", "detail": "분쟁이 생겼다면 대한법률구조공단(132)의 무료 법률상담을 이용하세요."},
        ]},
        "officer": {
            "background": "검색된 관련 근거: " + ", ".join(f"「{c['lawName']}」 {article_label(c['articleNo'])}" for c in top) + ".",
            "keyPoints": [f"「{c['lawName']}」 {article_label(c['articleNo'])}({c['title']}): {first_sentence(c['text'])} [[{c['key']}]]" for c in top],
            "adminNotes": ["규칙기반 검색 결과이므로 하위법령·행정규칙 및 최신 개정 여부를 원문에서 확인할 것"],
            "checklist": ["현행 조문 확인", "하위법령 위임사항 확인", "관련 판례·해석례 확인"],
        },
    }
