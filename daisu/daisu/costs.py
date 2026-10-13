"""외부(위탁)교육 정산: 여비규정·교육훈련 내규에서 읽은 기준으로 여비를 산정하고, 결과보고 기한과 지원 한도를 점검한다."""
from __future__ import annotations

import datetime as dt

from .regs import travel_group


def _d(s):
    return dt.date.fromisoformat(s) if s else None


def external(res: dict) -> dict:
    regs = res.get("regs") or {}
    base = _d(res["base"])
    tr = regs.get("travel")
    training = regs.get("training", {})
    report_days = (training.get("report_days") or {}).get("value")
    limit = (training.get("support_limit") or {}).get("value")
    people = {p["id"]: p for p in res["people"]}
    rows = []
    for r in res["records"]:
        if r["kind"] != "external" or not r.get("pid"):
            continue
        p = people[r["pid"]]
        start, end = _d(r.get("start")) or _d(r.get("date")), _d(r.get("date"))
        days = (end - start).days + 1 if start and end else 1
        nights = days - 1 if r.get("stay") else 0
        row = {"rid": r["rid"], "pid": p["id"], "name": p["name"], "dept": p["dept"], "grade": p.get("grade") or r.get("grade", ""),
               "title": r["title"], "inst": r.get("inst", ""), "start": r.get("start"), "end": r.get("date"), "days": days, "nights": nights,
               "hours": r["hours"], "cost": r.get("cost", 0), "place": r.get("place", ""), "stay_provided": r.get("stay_provided", False),
               "file": r["file"], "where": r["where"], "notes": []}
        if tr:
            g = travel_group(regs, row["grade"], p.get("title", ""))
            ratio = tr.get("daily_ratio", 1.0)
            daily = int(g["daily"] * ratio) * days
            meal = g["meal"] * days
            lodging = 0 if (row["stay_provided"] and tr.get("no_lodging_if_provided")) else (g["lodging"] or 0) * nights
            row.update(group=g["label"], daily=daily, meal=meal, lodging=lodging, travel=daily + meal + lodging)
            if ratio != 1.0:
                row["notes"].append(f"교육기간 일비 {ratio:g}배 적용")
            if row["stay_provided"] and nights:
                row["notes"].append("교육기관 숙박 제공 – 숙박비 미지급" if tr.get("no_lodging_if_provided") else "숙박 제공(규정 확인)")
            row["notes"].append("교통비는 실비(증빙) 별도")
        else:
            row.update(group="", daily=0, meal=0, lodging=0, travel=None)
            row["notes"].append("여비규정을 넣으면 여비를 산정합니다")
        if report_days is not None and end:
            due = end + dt.timedelta(days=report_days)
            rep = _d(r.get("report"))
            row["report_due"] = due.isoformat()
            row["report"] = r.get("report")
            if rep:
                row["report_state"] = "기한 내 제출" if rep <= due else f"{(rep - due).days}일 지연 제출"
            else:
                row["report_state"] = "미제출(기한 지남)" if base > due else "제출 대기"
        rows.append(row)
    by_person: dict[str, int] = {}
    for x in rows:
        by_person[x["pid"]] = by_person.get(x["pid"], 0) + (x["cost"] or 0)
    over = [{"pid": pid, "name": people[pid]["name"], "dept": people[pid]["dept"], "cost": c, "limit": limit}
            for pid, c in by_person.items() if limit and c > limit]
    return {"rows": rows, "total_cost": sum(x["cost"] or 0 for x in rows), "total_travel": sum(x["travel"] or 0 for x in rows),
            "hours": sum(x["hours"] or 0 for x in rows), "late": [x for x in rows if "지연" in x.get("report_state", "")],
            "missing": [x for x in rows if x.get("report_state", "").startswith("미제출")], "over_limit": over,
            "report_days": report_days, "limit": limit, "has_travel_rule": bool(tr)}


def settle_excel(ex: dict) -> bytes:
    import io

    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "외부교육 정산"
    ws.append(["외부(위탁)교육 교육비·여비 정산 내역 (여비규정·교육훈련 내규 기준 자동 산정)"])
    ws["A1"].font = Font(bold=True, size=13)
    head = ["성명", "소속", "직급", "여비 구분", "교육명", "교육기관", "시작", "종료", "일수", "숙박(박)", "교육비", "일비", "식비", "숙박비",
            "여비 계(교통비 제외)", "결과보고 기한", "결과보고", "비고", "근거 자료"]
    ws.append(head)
    for x in ex["rows"]:
        ws.append([x["name"], x["dept"], x["grade"], x.get("group", ""), x["title"], x["inst"], x["start"], x["end"], x["days"], x["nights"],
                   x["cost"], x.get("daily"), x.get("meal"), x.get("lodging"), x.get("travel"), x.get("report_due", ""), x.get("report_state", ""),
                   " / ".join(x["notes"]), f"{x['file']} {x['where']}"])
    ws.append([])
    ws.append(["합계", "", "", "", f"{len(ex['rows'])}건", "", "", "", "", "", ex["total_cost"], "", "", "", ex["total_travel"]])
    for col, w in zip("ABCDEFGHIJKLMNOPQRS", (8, 11, 6, 14, 26, 16, 11, 11, 5, 7, 10, 9, 9, 9, 13, 12, 16, 34, 40)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
