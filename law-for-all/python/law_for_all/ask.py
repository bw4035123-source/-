"""질의응답 파이프라인: 근거 검색 → 원문 확보 → 공급자 선택 → 생성/조립 → 환각 가드"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from .config import config
from .data import LAWS, article_key
from .guard import find_unverified_mentions, guard_llm_output, parse_loose_json, sanitize_markers
from .llm import resolve_provider
from .prompts import system_prompt, user_prompt
from .rule_engine import build_rule_answer
from .search import match_topics, search_articles
from .service import LawService

DEFAULT_CONTACTS = [
    {"name": "정부민원안내콜센터", "phone": "110", "desc": "소관 기관 안내"},
    {"name": "대한법률구조공단", "phone": "132", "url": "https://www.klac.or.kr", "desc": "무료 법률상담"},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def retrieve(query: str, max_n: int = 8):
    hits = match_topics(query)
    topic = hits[0]["topic"] if hits else None
    keys: list[str] = []

    def push(k):
        if k not in keys:
            keys.append(k)

    if topic:
        for r in topic["refs"]:
            push(r)
        for s in topic["citizen"]["steps"]:
            if s.get("ref"):
                push(s["ref"])
    for h in search_articles(query, 6):
        push(article_key(h["law"]["id"], h["article"]["no"]))
        for d in h["article"].get("delegates") or []:
            push(article_key(d["lawId"], d["articleNo"]))
    limit = max(max_n, len(topic["refs"]) + 2 if topic else max_n)
    return topic, keys[:limit]


def related_laws_of(keys: list[str]) -> list[dict]:
    ids = list(dict.fromkeys(k.split(":")[0] for k in keys))
    by = {l["id"]: l for l in LAWS}
    return [{"id": i, "name": by[i]["name"]} for i in ids if i in by]


def ask(query: str, mode: str = "citizen", provider: str | None = None) -> dict:
    started = time.time()
    notices: list[str] = []
    svc = LawService(config.law_api_oc)
    topic, keys = retrieve(query)
    context = svc.get_citations(keys)
    allowed = {c["key"] for c in context}

    p, notice = resolve_provider(config.llm, provider)
    if notice:
        notices.append(notice)
    used = {"id": p.id, "label": p.label, "model": p.model, "kind": p.kind}
    citation_keys = [c["key"] for c in context]
    removed: list[str] = []
    fallback = None
    out: dict = {}

    def rule():
        r = build_rule_answer(query, topic, context)
        s, rem, _ = sanitize_markers(r["summary"], allowed)
        out.update(summary=s, citizen=r["citizen"], officer=r["officer"], removed=rem, unverified=find_unverified_mentions("\n".join([s, *r["officer"]["keyPoints"]]), context))

    if p.kind == "rule":
        rule()
    elif not context:
        fallback = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다."
        rule()
    else:
        try:
            res = p.generate(system=system_prompt(mode), messages=[{"role": "user", "content": user_prompt(query, context)}], json_mode=True, temperature=0.1, max_tokens=1800)
            used["model"] = res["model"] or p.model
            g = guard_llm_output(parse_loose_json(res["text"]), mode, context)
            out.update(summary=g["summary"], citizen=g["citizen"], officer=g["officer"], removed=g["removed"], unverified=g["unverified"])
            citation_keys = g["citationKeys"] + [k for k in citation_keys if k not in g["citationKeys"]]
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 규칙엔진으로 안전 대체
            fallback = f"{p.label} 응답을 검증하지 못해 규칙기반 엔진으로 대체했습니다({e})."
            used = {"id": "mock", "label": "규칙기반 엔진(LLM 없음)", "model": "law-rule-engine-v1", "kind": "rule"}
            rule()
    removed = out["removed"]
    if fallback:
        notices.append(fallback)
    if removed:
        notices.append(f"근거 목록에 없는 인용 {len(removed)}건을 자동 제거했습니다.")

    by_key = {c["key"]: c for c in context}
    citations = [by_key[k] for k in citation_keys if k in by_key]
    # 판례 검색어: 토픽별로 사건명과 잘 맞는 검색어(실측으로 선정) — 없으면 질문 그대로
    cases = svc.search_cases(topic.get("caseQuery") or query if topic else query) if mode == "officer" else []
    notices += svc.warnings

    result = {
        "query": query, "mode": mode,
        "provider": used, "summary": out["summary"],
        "citations": citations, "contacts": topic["contacts"] if topic else DEFAULT_CONTACTS, "cases": cases,
        "relatedLaws": related_laws_of([c["key"] for c in citations]),
        "guard": {"removedCitations": removed, "unverifiedMentions": out["unverified"], "passed": not out["unverified"], **({"fallbackReason": fallback} if fallback else {})},
        "dataSource": "live" if any(c["source"] == "live" for c in citations) else "mock",
        "notices": list(dict.fromkeys(notices)),
        "elapsedMs": int((time.time() - started) * 1000), "generatedAt": now_iso(),
    }
    if topic:
        result["topic"] = {"id": topic["id"], "label": topic["label"]}
    if out.get("citizen"):
        result["citizen"] = out["citizen"]
    if out.get("officer"):
        result["officer"] = out["officer"]
    return result
