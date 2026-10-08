"""후임자 질의응답: 자료 + 전임자 구술(인터뷰 답변)에서만 답하고, 근거를 반드시 표시한다."""
from __future__ import annotations

import re

from . import config
from .draft import render
from .extract import keywords, sentences
from .ingest import KIND_LABEL
from .llm import LLMError
from .search import Index, tokens

NOT_FOUND = "자료에서 찾을 수 없습니다."


def _corpus(project: dict) -> list[tuple[str, str]]:
    docs = [(c["id"], f"{c['file']}\n{c['text']}") for c in project["chunks"]]
    for q in (project.get("draft") or {}).get("questions", []):
        if q.get("answer"):
            docs.append((q["id"], f"전임자 구술: {q['q']}\n{q['answer']}"))
    return docs


def _text_of(project: dict, sid: str) -> tuple[str, str]:
    if sid.startswith("Q"):
        q = next(x for x in project["draft"]["questions"] if x["id"] == sid)
        return f"[{sid} | 전임자 구술 | 인터뷰 답변]", f"질문: {q['q']}\n답변: {q['answer']}"
    c = next(x for x in project["chunks"] if x["id"] == sid)
    return f"[{sid} | {KIND_LABEL.get(c['kind'], '')} | {c['file']} · {c['where']}]", c["text"]


RE_WHEN = re.compile(r"(이번|다음|다가오는|당장|곧)\s*(달|주|일정|기한|마감)|D-?day|마감\s*(이|임박)|기한이?\s*(있는|다가)")


def ask_schedule(project: dict, question: str) -> dict | None:
    """'이번 달 기한이 있는 일은?' 같은 시기 질문은 업무 달력에서 기준일 기준으로 답한다."""
    if not RE_WHEN.search(question) or not project.get("draft"):
        return None
    import datetime as dt

    from .plan import make_plan

    base = dt.date.fromisoformat(project.get("base_date") or dt.date.today().isoformat())
    days = 7 if "주" in question else 31
    tl = [t for t in make_plan(project["draft"], project["docs"], base, horizon=days)["timeline"]]
    if "기한" in question or "마감" in question:
        tl = [t for t in tl if t["deadline"]] or tl
    if not tl:
        return {"answer": f"기준일({base}) 이후 {days}일 안에 잡힌 일정이 자료에 없습니다.", "sources": [], "found": True, "mode": "calendar"}
    lines = []
    for t in tl[:8]:
        title = re.sub(r"^\[[^]]*\]\s*", "", t["title"])
        approx = " (대략)" if t["approx"] else ""
        lines.append(f"• D-{t['dday']} {t['date']}{approx} – {title} [{t['sources'][0]}]")
    return {"answer": f"기준일({base}) 이후 {days}일 안의 일정입니다.\n" + "\n".join(lines),
            "sources": list(dict.fromkeys(t["sources"][0] for t in tl[:8])), "found": True, "mode": "calendar"}


RE_MONTH_Q = re.compile(r"(?<!\d)(1[0-2]|[1-9])\s*월(?:에|엔|달|\s|$).*?(할\s*일|일정|뭐|무엇|업무|해야|있)")
RE_CONTACT_Q = re.compile(r"연락처|전화|번호|메일|이메일|연락")
RE_WHO_Q = re.compile(r"누구|어느\s*분|담당자")  # '어디로 연락?'은 사람이 아니라 창구·번호를 묻는 것이라 일반 검색으로


def _live(items):
    return [i for i in items if i["status"] not in ("deleted", "unsupported")]


def ask_month(project: dict, question: str) -> dict | None:
    """'11월에 할 일 알려줘' → 업무 달력에서 그 달 일정(+매월 반복 업무)."""
    m = RE_MONTH_Q.search(question)
    if not m or not project.get("draft"):
        return None
    month = int(m.group(1))
    cal = next((s for s in project["draft"]["sections"] if s["kind"] == "calendar"), None)
    if not cal:
        return None
    items = _live(cal["items"])
    hits = sorted((i for i in items if i["meta"].get("month") == month and i["meta"].get("recur") not in ("monthly", "quarterly")),
                  key=lambda i: i["meta"].get("day") or 15)
    routine = [i for i in items if i["meta"].get("recur") in ("monthly", "quarterly")]
    if not hits and not routine:
        return {"answer": f"{month}월에 잡힌 일정이 자료에 없습니다.", "sources": [], "found": False, "mode": "calendar"}
    lines = [f"• {'[기한] ' if i['meta'].get('deadline') else ''}{i['text']} [{i['sources'][0]}]" for i in hits]
    if routine:
        lines.append("매월·분기 반복 업무:")
        lines += [f"• {i['text']} [{i['sources'][0]}]" for i in routine]
    srcs = list(dict.fromkeys(i["sources"][0] for i in hits + routine))
    return {"answer": f"{month}월에 할 일입니다.\n" + "\n".join(lines), "sources": srcs, "found": True, "mode": "calendar"}


def ask_people(project: dict, question: str) -> dict | None:
    """'정민재 연락처' → 연락망 카드, '냉난방기 공사 누구랑 협의해?' → 관련 업무가 맞는 사람."""
    d = project.get("draft")
    if not d:
        return None
    people = d.get("facts", {}).get("people", [])
    named = [p for p in people if p["name"] in question]
    if named and (RE_CONTACT_Q.search(question) or RE_WHO_Q.search(question) or len(question) <= len(named[0]["name"]) + 6):
        chosen = named[:2]
    elif RE_WHO_Q.search(question):
        qk = {k for k in keywords(question) if not k.startswith(("누구", "누군", "담당", "협의", "연락", "문의", "어느"))}
        scored = []
        for p in people:
            # 본인의 관련 업무·소속에 있으면 강하게, 같은 문장에 함께 나온 정도면 약하게
            own = " ".join(p["topics"]) + " " + (p.get("org") or "")
            ctx = " ".join(c["text"] for c in p["contexts"])
            sc = sum(2 if k[:2] in own else 0.5 if k[:2] in ctx else 0 for k in qk)
            if sc:
                scored.append((sc, p))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 1:
            return None
        chosen = [p for sc, p in scored[:2] if sc >= scored[0][0] * 0.6]
    else:
        return None
    lines, srcs = [], []
    for p in chosen:
        who = " ".join(x for x in (p["name"], p["title"]) if x) + (f"({p['org']})" if p["org"] else "")
        contact = ", ".join(p["tels"] + p["emails"]) or "자료에 연락처 없음"
        lines.append(f"• {who} – {contact}" + (f" / 관련: {', '.join(p['topics'][:3])}" if p["topics"] else "") + f" [{p['sources'][0]}]")
        if p.get("changed"):
            lines.append(f"  ※ 번호가 바뀌었다는 메모가 있습니다: “{p['changed']['text'][:50]}” [{p['changed']['source']}] – 최신 번호를 확인하세요.")
            srcs.append(p["changed"]["source"])
        srcs.append(p["sources"][0])
    return {"answer": "연락망에서 찾았습니다.\n" + "\n".join(lines), "sources": list(dict.fromkeys(srcs)), "found": True, "mode": "people"}


def ask(project: dict, question: str, client) -> dict:
    for special in (ask_schedule, ask_month, ask_people):
        res = special(project, question)
        if res:
            return res
    corpus = _corpus(project)
    hits = Index(corpus).search(question, k=6, min_score=1.0)
    if not hits:
        return {"answer": NOT_FOUND, "sources": [], "found": False, "mode": "none"}
    if client.available:
        ctx, used = [], 0
        for sid, _ in hits:
            head, body = _text_of(project, sid)
            body = body[:1200]
            if used + len(body) > 7000:
                break
            ctx.append(f"{head}\n{body}")
            used += len(body)
        user = render(config.prompt("qa"), 근거="\n\n".join(ctx), 질문=question)
        try:
            out = client.chat([{"role": "system", "content": config.prompt("system").split("6.")[0]},
                               {"role": "user", "content": user}], max_tokens=900)
            valid = {sid for sid, _ in hits}
            cited = [s for s in dict.fromkeys(re.findall(r"[SQ]\d{3,4}", out)) if s in valid]
            found = NOT_FOUND not in out
            # 근거 표시가 하나도 없으면 신뢰할 수 없으므로 자료 발췌로 대체
            if found and not cited:
                raise LLMError("근거 인용 없음")
            return {"answer": out.strip(), "sources": cited, "found": found, "mode": "llm"}
        except LLMError:
            pass
    # 오프라인(추출형) 답변: 질문어와 가장 많이 겹치는 문장을 근거와 함께 제시
    qk = keywords(question) - {"어디", "언제", "누구", "어떻게", "무엇", "방법", "알려줘"}
    need = 2 if len(qk) >= 3 else 1

    def overlap(sent: str) -> int:
        sk = keywords(sent)
        return sum(1 for q in qk if any(q == w or (len(q) >= 2 and (w.startswith(q) or q.startswith(w)) and min(len(q), len(w)) >= 2) for w in sk))

    picks = []
    for sid, score in hits[:4]:
        _, body = _text_of(project, sid)
        sents = [x for x in sentences(body) if len(x) >= 12 and not x.startswith(("제목", "보낸사람", "받는사람", "참조", "날짜"))] or [body[:200]]
        for s in sorted(sents, key=lambda s: -overlap(s))[:2]:
            if overlap(s) >= need and not any(s == p[1] for p in picks):
                picks.append((sid, s))
    if not picks:
        return {"answer": NOT_FOUND, "sources": [], "found": False, "mode": "rule"}
    lines = [f"• {s} [{sid}]" for sid, s in picks[:5]]
    return {"answer": "자료에서 찾은 관련 내용입니다.\n" + "\n".join(lines),
            "sources": list(dict.fromkeys(sid for sid, _ in picks[:5])), "found": True, "mode": "rule"}
