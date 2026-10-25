"""이어서 묻기 — Next.js 판 lib/answer/followup.ts 와 동일 규칙
검색 결과를 본 뒤 같은 사안을 더 묻는 질문에 답한다. 이전 질문의 사안(토픽·근거 조문)을 유지한 채 새 질문으로 근거를 다시 찾고,
질문 유형(기한·신고·처벌·준비·예외)에 맞는 조문 문장을 원문에서 골라 답한다(LLM 연결 시 생성 + 같은 인용 검증)."""
from __future__ import annotations

import re
import time

from .ask import DEFAULT_CONTACTS, now_iso, retrieve
from .config import config
from .data import article_label
from .guard import MARKER, find_unverified_mentions, guard_llm_output, parse_loose_json, sanitize_markers
from .llm import resolve_provider
from .prompts import schema_for, system_prompt, user_prompt
from .search import match_law_aliases, query_terms, score_article_by_terms
from .service import LawService

# 질문 유형: ask 는 질문에서, find 는 조문 문장에서, title 은 조문 제목에서 찾는 표현. 제목이 맞는 조문이 근거에 있으면 우선
FOLLOWUP_INTENTS = [
    {"id": "deadline", "ask": re.compile(r"기한|언제까지|며칠|기간|시효|마감|언제"), "find": re.compile(r"\d+\s*(?:일|개월|년|시간)\s*(?:이내|안에|전|이상|이하|이 지난)|기간|기한"), "title": re.compile(r"기간|기한|청산|시효"), "max": 2},
    {"id": "where", "ask": re.compile(r"어디|신고|진정|상담|문의|도움|기관|연락|불복|이의"), "find": re.compile(r"신고|진정|청구|신청|구제|고발|고소"), "title": re.compile(r"신고|진정|구제|신청|청구|조정"), "max": 2},
    {"id": "penalty", "ask": re.compile(r"처벌|벌금|과태료|징역|제재|불이익|징계|처분"), "find": re.compile(r"징역|벌금|과태료|처한다|부과|징계"), "title": re.compile(r"벌칙|과태료|벌금|징계|처분|취소"), "max": 2},
    {"id": "prepare", "ask": re.compile(r"증거|자료|준비|서류|입증|방법|절차"), "find": re.compile(r"서류|증명|신청|제출|절차"), "title": re.compile(r"신청|절차|서류|제출|조정"), "max": 1},
    {"id": "exception", "ask": re.compile(r"예외|제외|안 되는|않는 경우|다만"), "find": re.compile(r"다만|제외|예외|아니하다|아니한다"), "title": None, "max": 2},
]

FOLLOWUP_SUGGESTIONS = {
    "citizen": ["기한이 있나요?", "어디에 신고·상담하나요?", "무엇을 준비해야 하나요?", "어기면 처벌받나요?", "예외가 있나요?"],
    "officer": ["기한·기간 기준은?", "위반 시 제재는?", "필요 서류와 절차는?", "관련 신고·구제 경로는?", "예외 규정은?"],
}


def detect_intent(question: str) -> str | None:
    return next((it["id"] for it in FOLLOWUP_INTENTS if it["ask"].search(question)), None)


def _sentences(text: str) -> list[str]:
    out = []
    for line in text.split("\n"):
        out += re.split(r"(?<=다\.)\s+", re.sub(r"^[①-⑳]\s*", "", line))
    return [s.strip() for s in out if s.strip()]


def _balanced(s: str) -> bool:
    return s.count("(") == s.count(")")


def _pick_sentence(text: str, find, max_len: int = 140, prefer: list[str] | None = None) -> str:
    """조문에서 질문 유형에 맞는 문장 — 사안(이전 질문)의 말이 든 문장, 괄호가 짝이 맞는 문장을 우선(없으면 첫 문장)"""
    ss = _sentences(text)
    hits = sorted([x for x in ss if find.search(x)] if find else [], key=lambda x: not any(t in x for t in prefer or []))
    s = next((x for x in hits if _balanced(x)), None) or (hits[0] if hits else None) or (ss[0] if ss else "")
    return s[:max_len] + "…" if len(s) > max_len else s


def build_followup_rule_answer(question: str, mode: str, intent_id: str | None, topic: dict | None, context: list[dict], case_keys: list[str] | None = None, prev_query: str = "") -> str:
    """이어서 묻기 규칙기반 답변 — 토픽 사전·조문 원문 문장만 사용"""
    intent = next((it for it in FOLLOWUP_INTENTS if it["id"] == intent_id), None)
    terms = query_terms(question)
    # 사안의 핵심어: 이전 질문의 말 중 토픽 요약에도 나오는 말(예: '보증금') — 이 말이 든 조문 문장을 우선
    case_terms = [t for t in query_terms(prev_query) if t in topic["citizen"]["summary"]] if topic else []

    def rank(items: list[dict]) -> list:
        titled = [c for c in items if intent["title"].search(c["title"])] if intent and intent["title"] else []
        scored = [(score_article_by_terms(c, terms) + (4 if intent and intent["find"].search(c["text"]) else 0), i, c) for i, c in enumerate(titled or items)]
        return sorted((x for x in scored if x[0] > 0), key=lambda x: (-x[0], x[1]))[: intent["max"] if intent else 2]

    # 이전 질문(사안)의 근거에서 먼저 찾고, 없을 때만 새 질문으로 더 찾은 근거까지 본다
    ranked = rank([c for c in context if c["key"] in (case_keys or [])]) or rank(context)
    keys = {c["key"] for c in context}
    lines: list[str] = []
    if intent_id == "where":
        contacts = topic["contacts"] if topic else DEFAULT_CONTACTS
        lines.append("도움받을 수 있는 곳: " + " · ".join(f"{c['name']}(☎{c['phone']})" if c.get("phone") else c["name"] for c in contacts[:3]))
    if intent_id == "prepare" and topic:
        ref = next((s["ref"] for s in topic["citizen"]["steps"] if s.get("ref") and s["ref"] in keys), None)
        lines.append("해야 할 일: " + " → ".join(s["title"] for s in topic["citizen"]["steps"]) + (f" [[{ref}]]" if ref else ""))
    for _, _, c in ranked:
        lines.append(f"「{c['lawName']}」 {article_label(c['articleNo'])}({c['title']}): {_pick_sentence(c['text'], intent['find'] if intent else None, 140, case_terms)} [[{c['key']}]]")
    if not ranked and not lines:
        return "이어서 물으신 내용과 직접 맞는 조문을 근거 목록에서 찾지 못했어요. 상황을 조금 더 구체적으로 적어 주시거나, 정부민원안내콜센터(☎110)·대한법률구조공단(☎132)에 문의해 보세요."
    if ranked:
        lead = f"추가 검토 「{question}」 관련 근거는 다음과 같음." if mode == "officer" else f"‘{question}’에 대해 근거 조문에서 확인한 내용이에요."
    else:
        lead = f"추가 검토 「{question}」 관련 안내." if mode == "officer" else f"‘{question}’에 대한 안내예요."
    return "\n".join([lead, *(f"· {l}" for l in lines)])


def followup(question: str, prev_query: str, mode: str = "citizen", provider: str | None = None) -> dict:
    started = time.time()
    notices: list[str] = []
    svc = LawService(config.law_access)

    # 이전 질문의 사안을 유지: 토픽·근거는 이전 질문에서, 새 질문으로 근거를 더 찾는다
    # 이전 질문이 사전의 구체적 법령을 가리켰으면(ask 와 같은 규칙) 토픽 대신 실시간 근거를 유지
    if svc.mode == "live" and any(a.get("override") for a in match_law_aliases(prev_query)):
        topic, prev_keys, cur_keys = None, [], []
    else:
        topic, prev_keys = retrieve(prev_query)
        _, cur_keys = retrieve(f"{question} {topic['label'] if topic else prev_query}")
    local = prev_keys + [k for k in cur_keys if k not in prev_keys]
    live_keys = svc.search_live_keys(f"{prev_query} {question}") if not topic and svc.mode == "live" else []
    context = svc.get_citations(live_keys + [k for k in local if k not in live_keys])
    intent = detect_intent(question)

    p, notice = resolve_provider(config.llm, provider)
    if notice:
        notices.append(notice)
    used = {"id": p.id, "label": p.label, "model": p.model, "kind": p.kind}
    out = {"answer": "", "removed": []}
    fallback = None

    def rule():
        text, rem, _ = sanitize_markers(build_followup_rule_answer(question, mode, intent, topic, context, live_keys + prev_keys, prev_query), {c["key"] for c in context})
        out.update(answer=text, removed=rem)

    if p.kind == "rule":
        rule()
    elif not context:
        fallback = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다."
        rule()
    else:
        try:
            res = p.generate(system=system_prompt(mode), messages=[{"role": "user", "content": user_prompt(f"이전 질문: {prev_query}\n이어서 묻는 질문: {question}", context)}], json_mode=True, temperature=0.1, max_tokens=1200, schema=schema_for(mode))
            used["model"] = res["model"] or p.model
            g = guard_llm_output(parse_loose_json(res["text"]), mode, context)
            out.update(answer=g["summary"], removed=g["removed"])
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 규칙엔진으로 안전 대체
            fallback = f"{p.label} 응답을 검증하지 못해 규칙기반 엔진으로 대체했습니다({e})."
            used = {"id": "mock", "label": "규칙기반 엔진(LLM 없음)", "model": "law-rule-engine-v1", "kind": "rule"}
            rule()
    if fallback:
        notices.append(fallback)
    if out["removed"]:
        notices.append(f"근거 목록에 없는 인용 {len(out['removed'])}건을 자동 제거했습니다.")
    notices += svc.warnings

    by_key = {c["key"]: c for c in context}
    citations = [by_key[k] for k in dict.fromkeys(MARKER.findall(out["answer"])) if k in by_key]
    unverified = find_unverified_mentions(out["answer"], context)
    result = {
        "question": question, "prevQuery": prev_query, "mode": mode,
        "intent": intent, "provider": used, "answer": out["answer"], "citations": citations,
        "guard": {"removedCitations": out["removed"], "unverifiedMentions": unverified, "passed": not unverified, **({"fallbackReason": fallback} if fallback else {})},
        "suggestions": [s for s in FOLLOWUP_SUGGESTIONS[mode] if detect_intent(s) != intent][:3],
        "dataSource": "live" if any(c["source"] == "live" for c in citations) else "mock",
        "notices": list(dict.fromkeys(notices)),
        "elapsedMs": int((time.time() - started) * 1000), "generatedAt": now_iso(),
    }
    if topic:
        result["topic"] = {"id": topic["id"], "label": topic["label"]}
    return result
