"""인수인계서 초안 생성 · 암묵지 인터뷰 질문 · 답변 반영.

규칙엔진 결과(항상 생성)를 뼈대로 하고, LLM이 연결돼 있으면 항목을 다듬는다.
LLM 응답의 출처 ID는 실제 근거조각과 대조해 검증하며(환각 방지), 실패하면 규칙엔진 결과로 대체한다.
"""
from __future__ import annotations

import datetime as dt
import os
import re

from . import config
from .extract import bigram_sim, extract, fmt_date, keywords, sentences
from .ingest import KIND_LABEL, KIND_TRUST
from .llm import LLMError, chat_json
from .search import Index

MAX_ITEMS = {"overview": 8, "tips": 12, "resources": 10, "custom": 8, "issues": 10}


def render(tpl: str, **kw) -> str:
    for k, v in kw.items():
        tpl = tpl.replace("{{" + k + "}}", str(v))
    return tpl


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def trust_of(sources: list[str], chunk_kind: dict[str, str]) -> str:
    """근거의 성격으로 신뢰 신호등 결정: 공식 > 일반 > 메일 > 개인메모, 전임자 구술은 별도."""
    if not sources:
        return "none"
    if any(s.startswith("Q") for s in sources):
        return "oral"
    best = max((KIND_TRUST.get(chunk_kind.get(s, ""), -1) for s in sources), default=-1)
    return {3: "official", 2: "doc", 1: "mail", 0: "memo"}.get(best, "none")


def new_item(sid: str, n: int, text: str, sources: list[str], origin: str, chunk_kind: dict, **meta) -> dict:
    text = re.sub(r"^\s*(?:\d{1,2}|[가-하])\.\s+", "", text.strip())
    return {"id": f"{sid}-{n:03d}", "text": text, "sources": sources, "status": "ai", "origin": origin,
            "trust": trust_of(sources, chunk_kind), "meta": meta, "history": []}


# ───────────────────────── 규칙 기반 섹션 ─────────────────────────
_RECUR_ORDER = {"monthly": 0, "quarterly": 1, "yearly": 2, "once": 3}


def _dedupe_events(events: list[dict]) -> list[dict]:
    out: list[dict] = []
    for e in sorted(events, key=lambda e: (_RECUR_ORDER[e["recur"]], e["month"] or 0, e["day"] or 0)):
        dup = next((x for x in out if (x["month"], x["day"]) == (e["month"], e["day"])
                    and bigram_sim(x["title"], e["title"]) > 0.45), None)
        if dup:
            dup["sources"] = sorted(set(dup["sources"] + e["sources"]))
            if e["recur"] in ("yearly", "monthly") and dup["recur"] == "once":
                dup["recur"] = e["recur"]
        else:
            out.append(dict(e))
    return out


def rule_section(sec: dict, facts: dict, chunks: list[dict], chunk_kind: dict, index: Index) -> list[dict]:
    sid, kind, items = sec["id"], sec["kind"], []

    def add(text, sources, **meta):
        items.append(new_item(sid, len(items) + 1, text, sources, "rule", chunk_kind, **meta))

    if kind == "overview":
        for f in facts["rr"]:
            add(f["text"], f["sources"])
    elif kind == "calendar":
        for e in _dedupe_events(facts["events"]):
            add(f"[{fmt_date(e)}] {e['title']}", e["sources"], month=e["month"], day=e["day"], recur=e["recur"],
                deadline=e["deadline"], part=e["part"], year=e["year"])
    elif kind == "issues":
        for f in facts["issues"]:
            add(f["text"], f["sources"], status=f["status"], next="" if f["has_next"] else "전임자 확인 필요", due="",
                related=f.get("related", []))
    elif kind == "people":
        for p in facts["people"]:
            who = " ".join(x for x in [p["name"], p["title"]] if x)
            org = f"({p['org']})" if p["org"] else ""
            topics = ", ".join(p["topics"][:3])
            contact = ", ".join(p["emails"][:1] + p["tels"][:1])
            text = f"{who}{org}" + (f" – 관련: {topics}" if topics else "") + (f" / 연락: {contact}" if contact else "")
            if p.get("changed"):
                text += " ※ 번호가 바뀌었다는 메모 있음 – 최신 연락처 확인 필요"
            srcs = p["sources"] + ([p["changed"]["source"]] if p.get("changed") and p["changed"]["source"] not in p["sources"] else [])
            add(text, srcs, person=p["id"], name=p["name"])
    elif kind == "resources":
        for f in facts["resources"]:
            add(f["text"], f["sources"], systems=f["systems"], paths=f["paths"])
    elif kind == "tips":
        for f in sorted(facts["tips"], key=lambda f: f["kind"] != "memo"):
            add(f["text"], f["sources"])
    elif kind == "checks":
        for c in facts["conflicts"]:
            parts = []
            for v in c["variants"]:
                label = KIND_LABEL.get(v["kind"], v["kind"])
                if not parts or parts[-1][0] != v["date"]:
                    parts.append([v["date"], [label]])
                elif label not in parts[-1][1]:
                    parts[-1][1].append(label)
            desc = " vs ".join(f"{d}({'·'.join(ls)})" for d, ls in parts)
            srcs = sorted({s for v in c["variants"] for s in v["sources"]})
            add(f"[자료 간 불일치] ‘{c['topic']}’ 날짜가 서로 다름: {desc}", srcs, conflict=c["id"], type="conflict")
        for f in facts.get("overdue", []):
            add(f"[기한 지남] {f['text']} – 기한 {f['date']}이 인수인계 기준일보다 앞섭니다. 처리 여부를 확인하세요.",
                f["sources"], type="overdue")
        for p in facts["people"]:
            if p.get("changed"):
                add(f"[연락처 변경] {p['name']} {p['title']}: “{p['changed']['text'][:60]}” – 공식 자료의 번호({', '.join(p['tels']) or '없음'})와 다를 수 있음",
                    [p["changed"]["source"]] + p["sources"][:2], type="contact")
        for f in facts.get("uncertain", []):
            add(f"[불확실] ‘{f['word']}’ 같은 표현이 있음: {f['text']}", f["sources"], type="uncertain")
        for f in facts["issues"]:
            if not f["has_next"] and f["text"] not in {u["text"] for u in facts.get("uncertain", [])}:
                add(f"[결론 미정] {f['text']}", f["sources"], type="open")
        uncertain_texts = {u["text"] for u in facts.get("uncertain", [])}
        for f in facts["tips"]:
            if f["kind"] == "memo" and f["text"] not in uncertain_texts and re.search(r"\d|까지|반드시|꼭", f["text"]):
                add(f"[개인 메모에만 있음] {f['text']}", f["sources"], type="memo_only")
    elif kind == "custom":
        kws = sec.get("keywords") or list(keywords(sec.get("title", "") + " " + sec.get("guide", "")))
        seen: list[str] = []
        for cid, _ in index.search(" ".join(kws), k=10):
            chunk = next(c for c in chunks if c["id"] == cid)
            for s in sentences(chunk["text"]):
                if s.startswith(("제목", "보낸사람", "받는사람", "참석", "일시")):
                    continue
                if any(k in s for k in kws) and not any(bigram_sim(s, x) > 0.7 for x in seen):
                    seen.append(s)
                    add(s, [cid])
                if len(items) >= MAX_ITEMS["custom"] * 2:
                    break
    return items


# ───────────────────────── LLM 보강 ─────────────────────────
def _context(chunk_ids: list[str], chunk_map: dict, docs_by_id: dict, limit: int) -> str:
    out, used = [], 0
    for cid in chunk_ids:
        c = chunk_map.get(cid)
        if not c:
            continue
        head = f"[{cid} | {KIND_LABEL.get(c['kind'], '')} | {c['file']} · {c['where']}]"
        body = c["text"][:1200]
        if used + len(body) > limit:
            break
        out.append(f"{head}\n{body}")
        used += len(body) + len(head)
    return "\n\n".join(out)


def _valid_sources(raw, chunk_map) -> list[str]:
    if isinstance(raw, str):
        raw = re.findall(r"S\d{4}", raw)
    return [s for s in (raw or []) if isinstance(s, str) and s in chunk_map]


def llm_section(client, sec: dict, rule_items: list[dict], chunk_map: dict, docs_by_id: dict, chunk_kind: dict,
                index: Index, limit: int) -> list[dict]:
    kind = sec["kind"]
    cand = "\n".join(f"- ({', '.join(i['sources'][:3])}) {i['text']}" for i in rule_items[:30]) or "(없음)"
    query = " ".join([sec["title"], sec.get("guide", ""), " ".join(sec.get("keywords", []))] + [i["text"] for i in rule_items[:8]])
    ids = []
    for i in rule_items:
        ids += [s for s in i["sources"] if s not in ids]
    ids += [cid for cid, _ in index.search(query, k=8) if cid not in ids]
    ctx = _context(ids, chunk_map, docs_by_id, limit)
    system = config.prompt("system")
    if kind == "issues":
        user = render(config.prompt("issues"), 후보=cand, 근거=ctx)
    else:
        user = render(config.prompt("section"), 제목=sec["title"], 설명=sec.get("guide", ""), 후보=cand, 근거=ctx,
                      최대=MAX_ITEMS.get(kind, 10))
    data = chat_json(client, system, user, max_tokens=2500)
    if isinstance(data, dict):
        data = next((v for v in data.values() if isinstance(v, list)), [])
    items = []
    for d in data if isinstance(data, list) else []:
        if not isinstance(d, dict) or not str(d.get("text", "")).strip():
            continue
        srcs = _valid_sources(d.get("sources"), chunk_map)
        text = str(d["text"]).strip()
        meta = {}
        if kind == "issues":
            title = str(d.get("title", "")).strip()
            text = f"{title}: {text}" if title and title not in text else text
            meta = {"status": str(d.get("status", "진행중")), "next": str(d.get("next", "")), "due": str(d.get("due", ""))}
        it = new_item(sec["id"], len(items) + 1, text, srcs, "llm", chunk_kind, **meta)
        if not srcs:
            it["status"] = "unsupported"  # 근거 없는 문장은 기본 제외, 전임자가 확인해야 살아남음
        items.append(it)
    if not items:
        raise LLMError("유효한 항목이 없음")
    return items


# ───────────────────────── 질문(암묵지 인터뷰) ─────────────────────────
GENERIC_QUESTIONS = [
    ("이 업무에서 1년 중 가장 바쁜 시기는 언제이고, 미리 준비해 두면 좋은 일은 무엇인가요?", "calendar"),
    ("후임자가 가장 실수하기 쉬운 부분(반려·감점·민원 사례)은 무엇인가요?", "tips"),
    ("문서에는 없지만 꼭 알아야 할 관례나 비공식 절차(결재 요령, 보고 방식 등)가 있나요?", "tips"),
    ("인수인계 직후 1~2주 안에 후임자가 반드시 처리해야 할 일은 무엇인가요?", "issues"),
]


def rule_questions(sections: dict, facts: dict) -> list[dict]:
    qs = []

    def add(q, why, section, sources, kind, subject=""):
        qs.append({"q": q, "why": why, "section": section, "sources": sources, "type": kind, "origin": "rule", "subject": subject})

    for c in facts["conflicts"]:
        dates = sorted({v["date"] for v in c["variants"]})
        srcs = sorted({s for v in c["variants"] for s in v["sources"]})
        add(f"‘{c['topic']}’ 날짜가 자료마다 다릅니다({', '.join(dates)}). 실제 날짜와 그 이유는 무엇인가요?",
            "자료 간 날짜 불일치", "calendar", srcs, "conflict", f"‘{c['topic']}’ 날짜")
    for f in facts.get("overdue", []):
        short = f["text"][:60] + ("…" if len(f["text"]) > 60 else "")
        add(f"‘{short}’ – 기한({f['date']})이 지났습니다. 처리됐나요? 아직이면 후임자가 무엇을 해야 하나요?",
            "인수인계 기준일 기준으로 기한이 지난 일", "issues", f["sources"], "overdue", short)
    for p in facts["people"]:
        if p.get("changed"):
            add(f"{p['name']} {p['title']}의 연락처가 바뀌었다는 메모가 있습니다. 지금 연락할 수 있는 번호(업무용)는 무엇인가요?",
                "연락처 변경 메모(개인 휴대전화는 자동으로 가려짐)", "people", [p["changed"]["source"]], "person", f"{p['name']} {p['title']} 연락처")
    for f in facts.get("uncertain", [])[:4]:
        short = f["text"][:60] + ("…" if len(f["text"]) > 60 else "")
        add(f"‘{short}’ – ‘{f['word']}’라고 적혀 있습니다. 확정된 내용은 무엇인가요?",
            "불확실한 표현", "calendar" if re.search(r"\d+\s*월|\d+/\d+", f["text"]) else "issues", f["sources"], "uncertain", short)
    for f in facts["issues"]:
        if f["status"] in ("대기", "보류") or not f["has_next"]:
            short = f["text"][:60] + ("…" if len(f["text"]) > 60 else "")
            add(f"‘{short}’ 건은 지금 어디까지 진행됐고, 후임자가 다음에 할 일은 무엇인가요?",
                "결론이 자료에 없는 협의", "issues", f["sources"], "open", short)
    for p in facts["people"][:6]:
        if not p["contexts"] and p["mails"] <= 1:
            add(f"{p['name']} {p['title']}({p['org'] or '소속 미상'})과는 주로 어떤 일로, 어떤 방법으로 연락하나요?",
                "역할이 드러나지 않는 협의 상대", "people", p["sources"][:2], "person", f"{p['name']} {p['title']}")
    for q, sec in GENERIC_QUESTIONS:
        add(q, "문서에 잘 남지 않는 노하우", sec, [], "tacit")
    return qs


def llm_questions(client, sections: list[dict], facts: dict, rule_qs: list[dict], chunk_map: dict, n: int = 8) -> list[dict]:
    summary = []
    for sec in sections:
        summary.append(f"## {sec['title']}")
        summary += [f"- {i['text'][:120]}" for i in sec["items"][:8] if i["status"] != "deleted"]
    gaps = "\n".join(f"- {q['q']} ({', '.join(q['sources'][:2])})" for q in rule_qs if q["type"] != "tacit") or "(없음)"
    user = render(config.prompt("questions"), 초안="\n".join(summary)[:6000], 빈틈=gaps, 최대=n)
    data = chat_json(client, config.prompt("system"), user, max_tokens=1800)
    out = []
    for d in data if isinstance(data, list) else []:
        if isinstance(d, dict) and str(d.get("q", "")).strip():
            sec = d.get("section") if d.get("section") in {"overview", "calendar", "issues", "people", "resources", "tips", "checks"} else "tips"
            out.append({"q": str(d["q"]).strip(), "why": str(d.get("why", "")), "section": sec,
                        "sources": _valid_sources(d.get("sources"), chunk_map), "type": "llm", "origin": "llm"})
    return out


# ───────────────────────── 전체 초안 ─────────────────────────
def build_draft(project: dict, client, progress=lambda msg, frac: None) -> dict:
    chunks, docs = project["chunks"], project["docs"]
    chunk_map = {c["id"]: c for c in chunks}
    chunk_kind = {c["id"]: c["kind"] for c in chunks}
    docs_by_id = {d["id"]: d for d in docs}
    settings = config.load_settings()
    limit = int(settings["llm"].get("max_context_chars", 9000))
    template = config.load_template()
    secs_cfg = [s for s in template["sections"] if s.get("enabled", True)]

    progress("규칙엔진으로 일정·사람·현안 추출 중", 0.05)
    base = None
    if project.get("base_date"):
        try:
            base = dt.date.fromisoformat(project["base_date"])
        except ValueError:
            base = None
    root_name = os.path.basename(str(project.get("source_path") or "").rstrip("/\\"))
    facts = extract(chunks, docs, predecessor=project.get("from_name", ""), base_date=base, root_name=root_name)
    index = Index([(c["id"], f"{c['file']} {c['text']}") for c in chunks])
    warnings, sections = [], []
    use_llm = client.available
    steps = len(secs_cfg) + 2
    for k, sc in enumerate(secs_cfg):
        progress(f"‘{sc['title']}’ 작성 중", 0.1 + 0.75 * k / steps)
        items = rule_section(sc, facts, chunks, chunk_kind, index)
        mode = "rule"
        if use_llm and sc["kind"] in ("overview", "issues", "resources", "tips", "custom") and (items or sc["kind"] == "custom"):
            try:
                items = llm_section(client, sc, items, chunk_map, docs_by_id, chunk_kind, index, limit)
                mode = "llm"
            except (LLMError, ValueError) as e:
                warnings.append(f"‘{sc['title']}’: LLM 실패로 규칙엔진 결과 사용 ({e})")
        if sc["kind"] == "custom":
            items = items[:MAX_ITEMS["custom"]]
        sections.append({"id": sc["id"], "kind": sc["kind"], "title": sc["title"], "guide": sc.get("guide", ""),
                         "mode": mode, "items": items})

    progress("암묵지 인터뷰 질문 만드는 중", 0.88)
    qs = rule_questions({s["id"]: s for s in sections}, facts)
    if use_llm:
        try:
            extra = llm_questions(client, sections, facts, qs, chunk_map)
            for q in extra:
                if not any(bigram_sim(q["q"], x["q"]) > 0.55 for x in qs):
                    qs.insert(len([x for x in qs if x["type"] != "tacit"]), q)
        except (LLMError, ValueError) as e:
            warnings.append(f"인터뷰 질문: LLM 실패로 규칙 질문만 사용 ({e})")
    for i, q in enumerate(qs, 1):
        q.update(id=f"Q{i:03d}", answer="", status="open", asked_by="system", created=now())

    doc_cards = []
    if use_llm:
        progress("문서 요약 카드 만드는 중", 0.93)
    for d in docs:
        card = {"doc_id": d["id"], "file": d["file"], "kind": d.get("kind"), "summary": d.get("preview", "")}
        if use_llm and d.get("n_chunks"):
            body = "\n".join(c["text"] for c in chunks if c["doc_id"] == d["id"])[:2500]
            try:
                r = chat_json(client, config.prompt("system"), render(config.prompt("doc_summary"), 파일=d["file"], 내용=body),
                              max_tokens=400)
                if isinstance(r, dict) and r.get("summary"):
                    card["summary"], card["by"] = str(r["summary"]), "llm"
            except (LLMError, ValueError):
                pass
        doc_cards.append(card)

    progress("완료", 1.0)
    return {
        "sections": sections, "facts": facts, "questions": qs, "doc_cards": doc_cards, "warnings": warnings,
        "generated_at": now(), "generated_by": client.label, "mode": "llm" if use_llm else "rule",
    }


# ───────────────────────── 검수·답변 ─────────────────────────
def find_item(draft: dict, item_id: str):
    for sec in draft["sections"]:
        for it in sec["items"]:
            if it["id"] == item_id:
                return sec, it
    return None, None


def update_item(draft: dict, item_id: str, text=None, status=None, who="전임자") -> dict:
    sec, it = find_item(draft, item_id)
    if not it:
        raise KeyError(item_id)
    entry = {"at": now(), "by": who}
    if text is not None and text.strip() != it["text"]:
        entry["before"] = it["text"]
        it["text"] = text.strip()
        it["status"] = "edited"
    if status:
        entry["status"] = status
        it["status"] = status
    it["history"].append(entry)
    return it


def add_item(draft: dict, section_id: str, text: str, sources=None, origin="manual", status="verified", **meta) -> dict:
    sec = next(s for s in draft["sections"] if s["id"] == section_id)
    n = max([int(i["id"].rsplit("-", 1)[-1]) for i in sec["items"]] + [0]) + 1
    kinds = {}
    it = new_item(section_id, n, text, sources or [], origin, kinds, **meta)
    it["status"] = status
    if origin == "manual":
        it["trust"] = "oral"
    it["history"].append({"at": now(), "by": "전임자", "status": "추가"})
    sec["items"].append(it)
    return it


def answer_question(draft: dict, qid: str, answer: str, who: str = "전임자") -> dict:
    q = next(x for x in draft["questions"] if x["id"] == qid)
    q["answer"], q["status"], q["answered_at"], q["answered_by"] = answer.strip(), "answered", now(), who
    sec_ids = {s["id"]: s for s in draft["sections"]}
    target = q.get("section") if q.get("section") in sec_ids else None
    if target is None:  # 양식에서 해당 항목을 끈 경우 노하우 → 마지막 항목 순으로 대체
        target = "tips" if "tips" in sec_ids else draft["sections"][-1]["id"]
    subject = q.get("subject")
    text = f"[전임자 확인] {subject}: {answer.strip()}" if subject else answer.strip()
    it = add_item(draft, target, text, sources=[qid] + q.get("sources", [])[:3], origin="interview", status="verified")
    it["trust"] = "oral"
    q["item_id"] = it["id"]
    # 충돌 질문에 답하면 '확인 필요' 항목을 해결 처리
    if q.get("type") == "conflict":
        for sec in draft["sections"]:
            for x in sec["items"]:
                if x["meta"].get("type") == "conflict" and set(x["sources"]) & set(q["sources"]):
                    x["meta"]["resolved"] = answer.strip()
                    x["status"] = "verified"
    return q
