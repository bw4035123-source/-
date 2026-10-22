"""상황 분석 — 관련 법령 추천 + 변호사·검사·판사 3관점(Next.js 판 analyze-core.ts / analyze.ts 와 동일)"""
from __future__ import annotations

import json
import time

from .ask import now_iso
from .config import config
from .data import PERSPECTIVES, article_key, article_label, get_law, get_topic, parse_key
from .facts import extract_facts
from .guard import find_unverified_mentions, guard_analysis_output, parse_loose_json
from .llm import resolve_provider
from .prompts import ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, analysis_prompt
from .search import match_topics, normalize, search_articles
from .service import LawService

MAX_ISSUES = 3
DEFAULT_CONTACTS = [
    {"name": "대한법률구조공단", "phone": "132", "url": "https://www.klac.or.kr", "desc": "무료 법률상담·소송 지원"},
    {"name": "정부민원안내콜센터", "phone": "110", "desc": "소관 기관 안내"},
]


def is_penal(title: str) -> bool:
    return title in ("벌칙", "사기", "경범죄의 종류")


def spot_issues(text: str) -> list[dict]:
    hits = match_topics(text)
    if not hits:
        return []
    top = hits[0]["score"]
    # 생활 표현 하나라도 정확히 일치(점수 3 이상)하면 별도 쟁점으로 인정
    return [h for h in hits if h["score"] >= min(3, top)][:MAX_ISSUES]


def collect_keys(text: str, issues: list[dict]) -> list[str]:
    keys: list[str] = []

    def push(k):
        if k not in keys and get_law(k.split(":")[0]):
            keys.append(k)

    for i in issues:
        t = i["topic"]
        for r in t["refs"]:
            push(r)
        for r in PERSPECTIVES.get(t["id"], {}).get("extraRefs") or []:
            push(r)
        for s in t["citizen"]["steps"]:
            if s.get("ref"):
                push(s["ref"])
    min_score = 3 if issues else 1
    for h in search_articles(text, 6):
        if h["score"] < min_score:
            continue
        push(article_key(h["law"]["id"], h["article"]["no"]))
        for d in h["article"].get("delegates") or []:
            push(article_key(d["lawId"], d["articleNo"]))
    return keys[:14]


def _matched_terms(text: str, terms: list[str]) -> list[str]:
    n = normalize(text)
    seen, out = set(), []
    for t in terms:
        nt = normalize(t)
        # "A+B" 조합 트리거는 토픽 판별용이라 검색어로 쓰지 않음
        if "+" in t or len(nt) < 2 or nt not in n or nt in seen:
            continue
        seen.add(nt)
        out.append(t)
    return out[:3]


def rank_recommendations(text: str, issues: list[dict], keys: list[str]) -> list[dict]:
    search_score = {article_key(h["law"]["id"], h["article"]["no"]): h["score"] for h in search_articles(text, 14)}
    recs = []
    for key in keys:
        law_id, no = parse_key(key)
        law = get_law(law_id)
        art = next(a for a in law["articles"] if a["no"] == no)
        score = search_score.get(key, 0) * 0.6
        issue = None
        for ii, i in enumerate(issues):
            t = i["topic"]
            w = 1 - ii * 0.2
            if key in t["refs"]:
                score += (4 - min(t["refs"].index(key), 3) * 0.6) * w
                issue = issue or t["label"]
            elif key in (PERSPECTIVES.get(t["id"], {}).get("extraRefs") or []):
                score += 2 * w
                issue = issue or t["label"]
            elif any(s.get("ref") == key for s in t["citizen"]["steps"]):
                score += 1.2 * w
                issue = issue or t["label"]
        if law["kind"] != "법률":
            score *= 0.9
        own = next((i for i in issues if i["topic"]["label"] == issue), None)
        terms = _matched_terms(text, art.get("keywords") or [])
        if not terms and own:
            terms = _matched_terms(text, own["topic"]["triggers"])
        role = "위법성·처벌 검토 근거" if is_penal(art["title"]) else ("핵심 권리·의무 근거" if law["kind"] == "법률" else f"상위법 위임에 따른 세부 기준({law['kind']})")
        parts = []
        if terms:
            parts.append("‘" + "’, ‘".join(terms) + "’ 표현과 관련")
        parts.append(f"쟁점 「{issue}」의 {role}" if issue else role)
        rec = {"key": key, "score": round(score * 100) / 100, "reason": " · ".join(parts)}
        if issue:
            rec["issue"] = issue
        recs.append(rec)
    recs.sort(key=lambda r: -r["score"])
    top = recs[0]["score"] if recs and recs[0]["score"] else 1
    for r in recs:
        r["relevance"] = "high" if r["score"] >= top * 0.65 else "medium" if r["score"] >= top * 0.35 else "low"
    return recs


def evaluate_requirement(text: str, req: dict) -> dict:
    n = normalize(text)

    def has(w):
        nw = normalize(w)
        return len(nw) >= 2 and nw in n

    neg = next((w for w in req.get("neg") or [] if has(w)), None)
    if neg:
        return {"status": "unmet", "basis": f"‘{neg}’라는 서술 — 요건이 충족되지 않을 수 있음"}
    fact = next((w for w in req.get("facts") or [] if has(w)), None)
    if fact:
        return {"status": "met", "basis": f"‘{fact}’ 서술로 사실관계 확인"}
    return {"status": "unclear", "basis": "서술에서 확인되지 않음 — 추가 사실 확인 필요"}


def _from_knowledge(text: str, p: dict) -> dict:
    reqs = []
    for r in p["judge"]["requirements"]:
        item = {"label": r["label"], **({"ref": r["ref"]} if r.get("ref") else {}), **evaluate_requirement(text, r)}
        reqs.append(item)
    j = p["judge"]
    return {"lawyer": p["lawyer"], "prosecutor": p["prosecutor"], "judge": {"stance": j["stance"], "issues": j["issues"], "requirements": reqs, "outlook": j["outlook"]}}


def _generic(citations: list[dict]) -> dict:
    top = citations[:3]
    cite = lambda c: f"「{c['lawName']}」 {article_label(c['articleNo'])}({c['title']}) [[{c['key']}]]"  # noqa: E731
    penal = [c for c in citations if is_penal(c["title"])]
    return {
        "lawyer": {
            "stance": "검색된 관련 조문을 근거로 질문자에게 유리한 주장 가능성을 검토합니다.",
            "arguments": [f"{cite(c)}의 적용을 주장할 수 있는지 검토" for c in top],
            "evidence": ["사건 경위를 시간 순으로 정리한 메모", "계약서·통지문 등 문서", "문자·녹음 등 대화 기록"],
            "strategy": ["근거 조문 원문 확인 후 전문가 상담(대한법률구조공단 132)"],
        },
        "prosecutor": {
            "stance": "검색된 근거 중 처벌 조항의 구성요건 해당 여부를 검토합니다." if penal else "검색된 근거에서 형벌 조항은 확인되지 않습니다.",
            "violations": [f"{cite(c)}의 구성요건 해당 여부" for c in penal], "sanctions": [], "proofPoints": [],
        },
        "judge": {
            "stance": "관련 조문의 요건과 사실관계를 대조해 판단해야 합니다.",
            "issues": [f"{article_label(c['articleNo'])}({c['title']})의 요건 충족 여부" for c in top],
            "requirements": [{"label": f"{c['lawName']} {article_label(c['articleNo'])}({c['title']}) 요건", "ref": c["key"], "status": "unclear", "basis": "규칙기반 요건 사전이 없는 조문 — 원문 대조 필요"} for c in top],
            "outlook": "요건별 사실관계가 더 구체적으로 확인되어야 판단할 수 있습니다.",
        },
    }


def build_rule_analyses(text: str, issues: list[dict], citations: list[dict]) -> list[dict]:
    out = [{"issue": {"id": i["topic"]["id"], "label": i["topic"]["label"]}, "perspectives": _from_knowledge(text, PERSPECTIVES[i["topic"]["id"]])} for i in issues if i["topic"]["id"] in PERSPECTIVES]
    if not out and citations:
        out.append({"issue": {"id": "general", "label": "관련 조문 검토"}, "perspectives": _generic(citations)})
    return out


def analyze(situation: str, provider: str | None = None) -> dict:
    started = time.time()
    notices: list[str] = []
    svc = LawService(config.law_access)
    facts = extract_facts(situation)
    issues = spot_issues(situation)
    keys = collect_keys(situation, issues)
    recs = rank_recommendations(situation, issues, keys)
    citations = svc.get_citations([r["key"] for r in recs])

    p, notice = resolve_provider(config.llm, provider)
    if notice:
        notices.append(notice)
    used = {"id": p.id, "label": p.label, "model": p.model, "kind": p.kind}
    analyses = build_rule_analyses(situation, issues, citations)
    removed: list[str] = []
    unverified = find_unverified_mentions(json.dumps(analyses, ensure_ascii=False).replace("\\n", " "), citations)
    fallback = None

    if p.kind == "llm":
        if not citations:
            fallback = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다."
        else:
            try:
                res = p.generate(system=ANALYSIS_SYSTEM, messages=[{"role": "user", "content": analysis_prompt(situation, citations)}], json_mode=True, temperature=0.1, max_tokens=2500, schema=ANALYSIS_SCHEMA)
                g = guard_analysis_output(parse_loose_json(res["text"]), citations)
                used["model"] = res["model"] or p.model
                label = f"종합 분석({'·'.join(i['topic']['label'] for i in issues)})" if issues else "종합 분석"
                analyses = [{"issue": {"id": "ai", "label": label}, "perspectives": g["perspectives"]}]
                removed, unverified = g["removed"], g["unverified"]
            except Exception as e:  # noqa: BLE001
                fallback = f"{p.label} 응답을 검증하지 못해 규칙기반 분석으로 대체했습니다({e})."
                used = {"id": "mock", "label": "규칙기반 엔진(LLM 없음)", "model": "law-rule-engine-v1", "kind": "rule"}
    if fallback:
        notices.append(fallback)
    if removed:
        notices.append(f"근거 목록에 없는 인용 {len(removed)}건을 자동 제거했습니다.")
    if not issues:
        notices.append("상황에서 뚜렷한 생활 법률 쟁점을 찾지 못해 조문 검색 결과로 분석했습니다. 당사자·행위·금액·시점을 더 구체적으로 적으면 정확도가 올라갑니다.")
    notices += svc.warnings

    contacts: list[dict] = []
    for i in issues:
        for c in (get_topic(i["topic"]["id"]) or {}).get("contacts") or []:
            if not any(x["name"] == c["name"] for x in contacts):
                contacts.append(c)
    cited = {c["key"] for c in citations}
    return {
        "situation": situation, "facts": facts,
        "issues": [{"id": i["topic"]["id"], "label": i["topic"]["label"], "score": round(i["score"] * 10) / 10} for i in issues],
        "recommendations": [r for r in recs if r["key"] in cited], "analyses": analyses, "citations": citations,
        "contacts": contacts[:5] if contacts else DEFAULT_CONTACTS,
        "caseQuery": issues[0]["topic"].get("caseQuery") if issues else None, "provider": used,
        "guard": {"removedCitations": removed, "unverifiedMentions": unverified, "passed": not unverified, **({"fallbackReason": fallback} if fallback else {})},
        "dataSource": "live" if any(c["source"] == "live" for c in citations) else "mock",
        "notices": list(dict.fromkeys(notices)), "elapsedMs": int((time.time() - started) * 1000), "generatedAt": now_iso(),
    }
