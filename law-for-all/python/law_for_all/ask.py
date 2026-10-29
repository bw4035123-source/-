"""질의응답 파이프라인: 근거 검색 → 원문 확보 → 공급자 선택 → 생성/조립 → 환각 가드"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone

from .cases import pick_cases
from .config import config
from .data import LAWS, article_key, get_law, parse_key
from .guard import find_unverified_mentions, guard_llm_output, parse_loose_json, sanitize_markers
from .llm import resolve_provider
from .prompts import schema_for, system_prompt, user_prompt
from .privacy import mask_notice, mask_pii
from .rule_engine import build_rule_answer
from .search import live_case_query, match_law_aliases, match_topics, normalize, query_terms, search_articles
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
    # 토픽이 정해졌으면 조문 검색 결과는 그 토픽의 법령(과 하위법령)만 더함 — 글자만 겹친 다른 법(예: 청탁금지 질문에 주택임대차 '상한') 제외
    topic_laws = {r.split(":")[0] for r in topic["refs"]} if topic else set()
    for h in search_articles(query, 6):
        if topic and h["law"]["id"] not in topic_laws and (h["law"].get("parentId") or "") not in topic_laws:
            continue
        push(article_key(h["law"]["id"], h["article"]["no"]))
        for d in h["article"].get("delegates") or []:
            push(article_key(d["lawId"], d["articleNo"]))
    limit = max(max_n, len(topic["refs"]) + 2 if topic else max_n)
    return topic, keys[:limit]


def related_laws_of(keys: list[str]) -> list[dict]:
    ids = list(dict.fromkeys(k.split(":")[0] for k in keys))
    by = {l["id"]: l for l in LAWS}
    return [{"id": i, "name": by[i]["name"]} for i in ids if i in by]


def _mock_article(key: str) -> dict | None:
    p = parse_key(key)
    law = get_law(p[0]) if p else None
    return next((a for a in law["articles"] if a["no"] == p[1]), None) if law else None


def ask(query: str, mode: str = "citizen", provider: str | None = None) -> dict:
    started = time.time()
    # 질문 속 개인정보(주민등록번호·전화번호 등)는 검색·AI로 넘기기 전에 가린다
    query, masked = mask_pii(query)
    notices: list[str] = [mask_notice(masked)] if masked else []
    svc = LawService(config.law_access)
    topic, local_keys = retrieve(query)
    # 사람이 검수한 사전이 토픽보다 구체적인 법령을 가리키면(예: '사전통지'→행정절차법) 실시간 검색으로
    if svc.mode == "live" and any(a.get("override") for a in match_law_aliases(query)):
        topic, local_keys = None, []
    # 내장 토픽에 없는 질문은 국가법령정보 Open API로 전체 법령에서 근거 조문을 찾는다
    live_keys = svc.search_live_keys(query) if not topic and svc.mode == "live" else []
    # 실시간 검색을 한 경우, 내장 데이터의 약한 검색 결과는 질문 단어 2개 이상이 조문 제목에 있거나, 조문 키워드('욕을 했'·'맞았')가 질문에 그대로 있는 것만 남긴다
    terms = query_terms(query)
    nq = normalize(query)

    def strong(k: str) -> bool:
        a = _mock_article(k) or {}
        return sum(1 for t in terms if t in a.get("title", "")) >= 2 or any(len(normalize(w)) >= 2 and normalize(w) in nq for w in a.get("keywords") or [])

    if not topic and svc.mode == "live":
        local_keys = [k for k in local_keys if strong(k)]
    # 생활 용어 사전으로 찾은 법령(사람이 검수)이 있으면 그 실시간 결과를 앞에, 없으면 키워드가 질문과 그대로 맞은 내장 조문을 앞에
    # (사전에 없는 질문에서 실시간 검색이 엉뚱한 법을 앞세우지 않게)
    keys = live_keys + [k for k in local_keys if k not in live_keys] if match_law_aliases(query) else local_keys + [k for k in live_keys if k not in local_keys]
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
            res = p.generate(system=system_prompt(mode), messages=[{"role": "user", "content": user_prompt(query, context)}], json_mode=True, temperature=0.1, max_tokens=1800, schema=schema_for(mode))
            used["model"] = res["model"] or p.model
            g = guard_llm_output(parse_loose_json(res["text"]), mode, context, [query])
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
    notices += svc.warnings

    result = {
        "query": query, "mode": mode,
        "provider": used, "summary": out["summary"],
        "citations": citations, "contacts": topic["contacts"] if topic else DEFAULT_CONTACTS,
        # 판례 검색어: 화면이 /api/cases 로 따로 불러옴(답변 속도 보호)
        "caseQuery": topic.get("caseQuery") if topic else (live_case_query(query) if live_keys else None),
        "relatedLaws": related_laws_of([c["key"] for c in citations]) + list({c["lawId"]: {"id": c["lawId"], "name": c["lawName"]} for c in citations if c["key"] in live_keys}.values()),
        "guard": {"removedCitations": removed, "unverifiedMentions": out["unverified"], "passed": not out["unverified"], **({"fallbackReason": fallback} if fallback else {})},
        "dataSource": "live" if any(c["source"] == "live" for c in citations) else "mock",
        "notices": list(dict.fromkeys(notices)),
        "elapsedMs": int((time.time() - started) * 1000), "generatedAt": now_iso(),
    }
    if topic:
        result["topic"] = {"id": topic["id"], "label": topic["label"]}
    if out.get("citizen"):
        # 이런 경우라면: 검수된 토픽 데이터에서 고름(LLM 답변이어도 같음). 근거 표식이 이번 근거 목록에 모두 있는 것만
        have = {c["key"] for c in citations}
        cases = [c for c in pick_cases(topic, query) if all(k in have for k in re.findall(r"\[\[([^\]]+)\]\]", c["detail"]))]
        result["citizen"] = {**out["citizen"], "cases": cases} if cases else out["citizen"]
    if out.get("officer"):
        result["officer"] = out["officer"]
    return result
