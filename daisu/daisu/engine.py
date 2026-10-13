"""이수 판정 엔진: 명단 × 규칙표 × 이수기록 → 직원별·교육별 상태(이수/부족/미이수/휴직/대상 아님)와 확인 필요 목록.

판정은 모두 규칙과 계산으로 한다(AI가 추측하지 않음). 각 판정에는 근거 기록(파일·행)이 붙는다.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os

from . import config, sessions
from .readers import read
from .sources import (doc_kinds, classify, parse_cert, parse_records, parse_roster, parse_shift, parse_sign,
                      parse_survey)
from .util import dept_core, edit1, norm_name, same_dept

_CACHE: dict = {}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def parse_file(path: str, rel: str, sha: str, year: int) -> dict:
    """파일 하나를 해석(같은 파일·같은 연도는 다시 읽지 않음)."""
    key = (path, sha, year)
    if key in _CACHE:
        return _CACHE[key]
    doc = read(path)
    out = {"kinds": doc_kinds(doc), "note": doc.note, "people": [], "records": [], "signs": [], "shifts": [], "survey": [],
           "texts": []}
    for t in doc.tables:
        k = classify(t)
        if k == "roster":
            out["people"] += parse_roster(t, rel)
        elif k == "records":
            out["records"] += parse_records(t, rel)
        elif k == "sign":
            info, recs = parse_sign(t, rel, year)
            out["signs"].append(dict(info, file=rel, where=t.where, n=len(recs), attended=sum(r["done"] for r in recs)))
            out["records"] += recs
        elif k == "shift":
            out["shifts"].append(parse_shift(t, rel, year))
        elif k == "survey":
            out["survey"] += parse_survey(t, rel)
    if "cert" in out["kinds"]:
        out["records"] += parse_cert(doc, rel)
    if "guide" in out["kinds"]:
        out["texts"] = [{"text": t, "file": rel, "where": w} for t, w in doc.texts]
    _CACHE[key] = out
    return out


# ───────────── 규칙 → 판정 열(column)
def columns(rules: dict, year: int) -> list[dict]:
    cols = []
    for r in rules["courses"]:
        base = {"rule": r["id"], "name": r["name"], "group": r.get("group", ""), "law": r.get("law", ""),
                "mandatory": r.get("mandatory", True), "cycle": r.get("cycle", "year"), "report": r.get("report", ""),
                "note": r.get("note", "")}
        if r.get("cycle") == "half":
            cols.append(dict(base, key=f"{r['id']}@H1", label=f"{r['name']}(상반기)", start=f"{year}-01-01", end=f"{year}-06-30",
                             due=f"{year}-06-30"))
            cols.append(dict(base, key=f"{r['id']}@H2", label=f"{r['name']}(하반기)", start=f"{year}-07-01", end=f"{year}-12-31",
                             due=f"{year}-12-31"))
        elif r.get("cycle") == "hire":
            cols.append(dict(base, key=r["id"], label=r["name"], start=f"{year}-01-01", end=f"{year}-12-31", due=None,
                             due_days=r.get("due_days", 0)))
        else:
            cols.append(dict(base, key=r["id"], label=r["name"], start=f"{year}-01-01", end=f"{year}-12-31",
                             due=f"{year}-{r.get('due', '12-31')}"))
    return cols


def match_rules(title: str, context: str, rules: dict, course_map: dict) -> list[str] | None:
    """과정명 → 해당 규칙 id 목록. []는 '의무교육 아님', None은 '분류 못함'."""
    if title in course_map:
        return list(course_map[title])

    def hit(text):
        ids = []
        for r in rules["courses"]:
            if any(k in text for k in r.get("keywords", [])) and not any(k in text for k in r.get("exclude_keywords", [])):
                ids.append(r["id"])
        return ids

    ids = hit(title) or hit(context or "")
    if ids:
        return ids
    if any(k in title for k in rules.get("not_mandatory_keywords", [])):
        return []
    return None


def compute(project: dict) -> dict:
    rules = config.rules()
    base = dt.date.fromisoformat(project.get("base_date") or dt.date.today().isoformat())
    year = int(project.get("year") or base.year)  # 1~2월에 지난해 실적을 정리할 때는 판정 연도를 따로 지정
    ov = project.get("overrides") or {}
    person_map, course_map = ov.get("person", {}), ov.get("course", {})

    files, people, records, signs, shifts, survey, texts = [], [], [], [], [], [], []
    for f in project.get("files", []):
        parsed = parse_file(f["path"], f["rel"], f["sha"], year)
        files.append({"rel": f["rel"], "size": f.get("size", 0), "kinds": parsed["kinds"], "note": parsed["note"],
                      "n_people": len(parsed["people"]), "n_records": len(parsed["records"])})
        people += parsed["people"]
        records += [dict(r) for r in parsed["records"]]
        signs += parsed["signs"]
        shifts += parsed["shifts"]
        survey += parsed["survey"]
        texts += parsed["texts"]

    # 명단: 사번이 겹치면 뒤 자료가 앞 자료를 덮음(최신 명단 우선)
    by_id = {}
    for p in people:
        by_id[p["id"]] = p
    people = list(by_id.values())
    by_name: dict[str, list] = {}
    for p in people:
        by_name.setdefault(p["name"], []).append(p)
    records += sessions.records(project, by_id)  # 키오스크 전자 출석도 이수 기록

    issues = []
    cols = columns(rules, year)
    colmap = {c["key"]: c for c in cols}
    rule_by_id = {r["id"]: r for r in rules["courses"]}

    # ── 기록 ↔ 사람 매칭
    for i, r in enumerate(records):
        r["key"] = f"{r['file']}#{r['where']}"
        r["rid"] = f"R{i + 1:04d}"
        if r["key"] in person_map:
            pid = person_map[r["key"]]
            r["pid"] = pid if pid in by_id else None
            r["match"] = "manual" if r["pid"] else "ignored"
            continue
        pid, how = None, ""
        if r.get("emp_id") and r["emp_id"] in by_id and by_id[r["emp_id"]]["name"] == norm_name(r["name"]):
            pid, how = r["emp_id"], "사번"
        else:
            cands = by_name.get(r["name"], [])
            if len(cands) == 1:
                pid, how = cands[0]["id"], "이름"
            elif len(cands) > 1:
                same = [p for p in cands if same_dept(r.get("dept"), p["dept"])]
                if len(same) == 1:
                    pid, how = same[0]["id"], "이름+소속"
        r["pid"], r["match"] = pid, how
        if pid:
            continue
        cands = by_name.get(r["name"], [])
        if len(cands) > 1:
            issues.append({"type": "ambiguous", "key": r["key"], "rid": r["rid"],
                           "text": f"‘{r['name']}’ 동명이인 {len(cands)}명 – 기록에 소속이 {'없어' if not r.get('dept') else '맞지 않아'} 누구인지 알 수 없음",
                           "record": _brief(r), "candidates": [_who(p) for p in cands]})
        else:
            sugg = [p for p in people if edit1(p["name"], r["name"])]
            sugg.sort(key=lambda p: not same_dept(r.get("dept"), p["dept"]))
            issues.append({"type": "unknown", "key": r["key"], "rid": r["rid"],
                           "text": f"‘{r['name']}’({r.get('dept') or '소속 없음'})이(가) 직원 명단에 없음"
                                   + (f" – ‘{sugg[0]['name']}’의 오타일 수 있음" if sugg else " – 퇴사자·외부인·오타 확인"),
                           "record": _brief(r), "candidates": [_who(p) for p in sugg[:3]]})

    # ── 기록 ↔ 교육(규칙) 분류
    unclassified: dict[str, list] = {}
    for r in records:
        ids = r["preset_rules"] if r.get("preset_rules") is not None else match_rules(r["title"], r.get("context", ""), rules, course_map)
        r["rules"] = ids or []
        r["classified"] = ids is not None
        if ids is None:
            unclassified.setdefault(r["title"], []).append(r["rid"])
    for title, rids in unclassified.items():
        issues.append({"type": "course", "key": title, "title": title,
                       "text": f"‘{title}’ 과정({len(rids)}건)이 어느 법정교육인지 알 수 없음 – 분류하거나 ‘의무교육 아님’으로 표시",
                       "count": len(rids)})

    # ── 직원별·열별 판정
    rec_by_pid: dict[str, list] = {}
    for r in records:
        if r.get("pid") and r["done"] and r["rules"]:
            rec_by_pid.setdefault(r["pid"], []).append(r)
    cells: dict[str, dict] = {}
    for p in people:
        row = {}
        hired = dt.date.fromisoformat(p["hired"])
        left = dt.date.fromisoformat(p["left"]) if p.get("left") else None
        lv = [dt.date.fromisoformat(x) for x in p["leave"]] if p.get("leave") else None
        for c in cols:
            rule = rule_by_id[c["rule"]]
            start, end = dt.date.fromisoformat(c["start"]), dt.date.fromisoformat(c["end"])
            tgt = rule.get("target") or {}
            due = dt.date.fromisoformat(c["due"]) if c["due"] else hired + dt.timedelta(days=c.get("due_days", 0))
            cell = {"s": "na", "h": 0.0, "need": 0, "recs": [], "due": due.isoformat(), "why": ""}
            row[c["key"]] = cell
            if left and left <= base:
                cell.update(s="left", why=f"퇴사({p['left']})")
                continue
            if hired > end or (c["cycle"] != "hire" and hired > due):
                cell["why"] = "기간 이후 입사"
                continue
            if tgt.get("flag") and not p["flags"].get(tgt["flag"]):
                cell["why"] = f"{tgt['flag']} 아님"
                continue
            if tgt.get("exclude_flag") and p["flags"].get(tgt["exclude_flag"]):
                cell["why"] = f"{tgt['exclude_flag']}는 별도 과정"
                continue
            if tgt.get("hired_this_year") and hired.year != year:
                cell["why"] = "올해 입사자 아님"
                continue
            hours = rule.get("hours", 1)
            need = hours.get(p["job"], max(hours.values())) if isinstance(hours, dict) else hours
            got, used = 0.0, []
            lo = hired - dt.timedelta(days=30) if c["cycle"] == "hire" else start
            for r in rec_by_pid.get(p["id"], []):
                if c["rule"] not in r["rules"]:
                    continue
                d = dt.date.fromisoformat(r["date"]) if r.get("date") else None
                if d and not (lo <= d <= end):
                    continue
                if not d and c["cycle"] == "half" and not (start <= base <= end):
                    continue
                share = r["hours"] / max(1, len([x for x in r["rules"] if rule_by_id[x].get("group") == rule.get("group")]))
                got += share
                used.append(r["rid"])
            cell.update(h=round(got, 2), need=need, recs=used)
            if got >= need - 1e-6:
                cell["s"] = "done"
            elif lv and (lv[0] <= base <= lv[1] or (lv[0] <= start and lv[1] >= end)):
                cell.update(s="leave", why=f"휴직 {lv[0].month}/{lv[0].day}~{lv[1].month}/{lv[1].day}")
            else:
                cell["s"] = "partial" if got > 0 else "none"
            cell["dday"] = (due - base).days
            cell["overdue"] = cell["s"] in ("partial", "none") and due < base
        cells[p["id"]] = row

    # ── 열별 요약
    summary = []
    for c in cols:
        cs = [cells[p["id"]][c["key"]] for p in people]
        n = {k: sum(1 for x in cs if x["s"] == k) for k in ("done", "partial", "none", "leave")}
        target = n["done"] + n["partial"] + n["none"]
        dues = [x["due"] for x in cs if x["s"] in ("partial", "none")]
        summary.append(dict(c, target=target, done=n["done"], partial=n["partial"], none=n["none"], leave=n["leave"],
                            overdue=sum(1 for x in cs if x.get("overdue")),
                            rate=round(100 * n["done"] / target, 1) if target else None,
                            next_due=min(dues) if dues else c["due"],
                            dday=(dt.date.fromisoformat(min(dues) if dues else c["due"]) - base).days if (dues or c["due"]) else None))

    # 명단에 없는 자료(명단 파일 미투입)
    if not people:
        issues.insert(0, {"type": "roster", "key": "roster", "text": "직원 명단(사번·성명·소속·입사일 등이 있는 엑셀)을 찾지 못했습니다. 명단 파일을 함께 넣어 주세요."})
    for f in files:
        if f["note"]:
            issues.append({"type": "file", "key": f["rel"], "text": f"{f['rel']}: {f['note']}"})

    depts = sorted({p["dept"] for p in people}, key=lambda d: [p["dept"] for p in people].index(d))
    return {"base": base.isoformat(), "year": year, "files": files, "people": people, "columns": cols, "cells": cells,
            "records": records, "issues": issues, "summary": summary, "depts": depts, "signs": signs, "shifts": shifts,
            "survey": survey, "texts": texts, "rules": rules}


def _who(p: dict) -> dict:
    return {"id": p["id"], "name": p["name"], "dept": p["dept"], "title": p["title"], "team": p.get("team", "")}


def _brief(r: dict) -> dict:
    return {k: r.get(k) for k in ("rid", "title", "date", "hours", "name", "dept", "file", "where", "kind")}


def person_label(p: dict) -> str:
    return f"{p['name']}({dept_core(p['dept'])}{('·' + p['team'] + '조') if p.get('team') else ''})"


def file_entry(path: str, rel: str) -> dict:
    return {"rel": rel, "path": path, "sha": sha256(path), "size": os.path.getsize(path)}
