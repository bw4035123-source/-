"""후임자 '첫 30일 플랜': 인수인계 기준일부터 다가오는 기한·현안·인사할 사람·읽을 자료."""
from __future__ import annotations

import calendar
import datetime as dt

PART_DAY = {"초": 5, "중순": 15, "말": 25, "": 15}


def _next_date(meta: dict, base: dt.date) -> dt.date | None:
    m, d, recur, year = meta.get("month"), meta.get("day"), meta.get("recur"), meta.get("year")
    if recur == "monthly":
        day = d or PART_DAY.get(meta.get("part", ""), 15)
        y, mo = base.year, base.month
        for _ in range(2):
            last = calendar.monthrange(y, mo)[1]
            cand = dt.date(y, mo, min(day, last))
            if cand >= base:
                return cand
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
        return None
    if not m:
        return None
    day = d or PART_DAY.get(meta.get("part", ""), 15)
    if year and recur == "once":
        try:
            c = dt.date(year, m, min(day, calendar.monthrange(year, m)[1]))
        except ValueError:
            return None
        return c if c >= base else None
    for y in (base.year, base.year + 1):
        c = dt.date(y, m, min(day, calendar.monthrange(y, m)[1]))
        if c >= base:
            return c
    return None


def make_plan(draft: dict, docs: list[dict], base: dt.date, horizon: int = 60) -> dict:
    secs = {s["kind"]: s for s in draft["sections"]}
    live = lambda items: [i for i in items if i["status"] not in ("deleted", "unsupported")]
    timeline, routines = [], []
    for it in live(secs.get("calendar", {}).get("items", [])):
        meta = it["meta"]
        if meta.get("recur") == "monthly":
            routines.append({"title": it["text"], "sources": it["sources"]})
        when = _next_date(meta, base) if meta else None
        if when and (when - base).days <= horizon:
            timeline.append({"date": when.isoformat(), "dday": (when - base).days, "title": it["text"],
                             "deadline": bool(meta.get("deadline")), "approx": not meta.get("day"),
                             "sources": it["sources"], "item": it["id"]})
    timeline.sort(key=lambda x: x["date"])
    week1 = []
    for it in live(secs.get("issues", {}).get("items", []))[:6]:
        st = it["meta"].get("status", "")
        hint = it["meta"].get("next") or st or ""
        week1.append({"type": "현안", "title": it["text"], "hint": "" if hint[:15] in it["text"] else hint, "sources": it["sources"]})
    for it in live(secs.get("people", {}).get("items", []))[:5]:
        week1.append({"type": "인사", "title": it["text"], "hint": "인사·연락 채널 확인", "sources": it["sources"]})
    for q in draft.get("questions", []):
        if q.get("asked_by") == "successor" and q["status"] == "open":
            week1.append({"type": "질문", "title": q["q"], "hint": "전임자 답변 대기", "sources": []})
    reading = [{"file": d["file"], "kind": d.get("kind_label", "")} for d in docs
               if d.get("kind") in ("official", "data") and d.get("n_chunks")][:8]
    return {"base": base.isoformat(), "timeline": timeline, "routines": routines, "week1": week1, "reading": reading}
