"""교육훈련 실적 집계와 경영평가 지표 계산.

편람에서 읽은 지표(지표명·산식)를 보고 계산 방법을 고른다. 계산 근거(분자·분모)를 숫자로 남기고,
필요한 자료가 없으면 '자료 필요'로 표시한다(추측해서 채우지 않음).
"""
from __future__ import annotations

from . import fees as fees_mod

CATS = ["법정", "필수", "직무", "외부"]
DEFAULT_KPIS = [
    {"name": "1인당 교육훈련시간", "formula": "총 교육훈련시간 ÷ 평균 인원", "weight": None, "src": None},
    {"name": "법정의무교육 이수율", "formula": "법정의무교육 이수 인원 ÷ 대상 인원 × 100", "weight": None, "src": None},
]


def active_people(res):
    return [p for p in res["people"] if not (p.get("left") and p["left"] <= res["base"])]


def hours(res: dict) -> dict:
    """직원별·분야별 교육시간(같은 과정·같은 날 중복 기록은 한 번만)."""
    y0, y1 = f"{res['year']}-01-01", f"{res['year']}-12-31"
    act = {p["id"] for p in active_people(res)}
    per = {pid: {c: 0.0 for c in CATS} for pid in act}
    courses = {c: set() for c in CATS}
    seen = set()
    for r in res["records"]:
        pid = r.get("pid")
        if pid not in per or not r["done"] or (r.get("date") and not y0 <= r["date"] <= y1):
            continue
        key = (pid, r["title"], r.get("date"))
        if key in seen:
            continue
        seen.add(key)
        cat = r.get("category") or "직무"
        per[pid][cat] += float(r["hours"] or 0)
        courses[cat].add(r["title"])
    return {"per": per, "courses": {k: sorted(v) for k, v in courses.items()}}


def completion(res: dict, category: str) -> dict:
    """연인원 기준 이수율: 교육별 이수 인원의 합 ÷ 교육별 대상 인원의 합(휴직·퇴사 제외).
    기한이 아직 남은 교육(예: 진행 중인 하반기)은 따로 세어 함께 보여 준다."""
    cols = [c for c in res["summary"] if c.get("category") == category]
    target = sum(c["target"] for c in cols)
    done = sum(c["done"] for c in cols)
    closed = [c for c in cols if c.get("due") and c["due"] < res["base"]]
    return {"target": target, "done": done, "rate": round(100 * done / target, 1) if target else None, "courses": len(cols),
            "closed_target": sum(c["target"] for c in closed), "closed_done": sum(c["done"] for c in closed)}


def satisfaction(res: dict, project: dict) -> dict:
    vals = [v for r in res["survey"] for v in r["scores"].values()]
    for s in project.get("sessions", []):
        vals += [v for r in s.get("survey", []) for v in r["scores"].values()]
    n = len(res["survey"]) + sum(len(s.get("survey", [])) for s in project.get("sessions", []))
    return {"n": n, "avg": round(sum(vals) / len(vals), 2) if vals else None}


def spend(res: dict, project: dict, ext: dict, fee_cfg: dict) -> dict:
    lect = sum(fees_mod.compute(s["instructor"], s["hours"], fee_cfg)["total"] for s in project.get("sessions", []) if s["instructor"].get("name"))
    total = lect + ext["total_cost"] + (ext["total_travel"] or 0)
    return {"lecture": lect, "external": ext["total_cost"], "travel": ext["total_travel"] or 0, "total": total}


def compute(res: dict, project: dict, ext: dict, fee_cfg: dict) -> dict:
    hrs = hours(res)
    act = active_people(res)
    n = max(1, len(act))
    tot = {c: round(sum(v[c] for v in hrs["per"].values()), 1) for c in CATS}
    total_h = round(sum(tot.values()), 1)
    regs = res.get("regs") or {}
    target_h = (regs.get("training", {}).get("annual_hours") or {}).get("value")
    gov_h = (regs.get("gov", {}).get("rec_hours") or {}).get("value")
    sp = spend(res, project, ext, fee_cfg)
    budget = (regs.get("budget") or {}).get("total")
    sat = satisfaction(res, project)
    legal, req = completion(res, "법정"), completion(res, "필수")
    below = [p for p in act if target_h and sum(hrs["per"][p["id"]].values()) < target_h]

    out = []
    for k in regs.get("kpis") or DEFAULT_KPIS:
        name, f = k["name"], k.get("formula", "")
        txt = name + " " + f
        item = {"name": name, "formula": f, "weight": k.get("weight"), "src": k.get("src"), "value": None, "unit": "", "basis": "", "ok": True}
        if "1인당" in name and "시간" in txt:
            item.update(value=round(total_h / n, 1), unit="시간", basis=f"총 교육훈련시간 {total_h:,}시간 ÷ 인원 {len(act)}명(기준일 재직, 월평균 인원 자료가 있으면 대체)")
        elif "법정" in txt and "이수율" in txt:
            item.update(value=legal["rate"], unit="%", basis=f"법정교육 {legal['courses']}개 과정 이수 연인원 {legal['done']:,}명 ÷ 대상 연인원 {legal['target']:,}명(휴직 제외, 기준일 현재)")
        elif "필수" in txt and "이수율" in txt:
            item.update(value=req["rate"], unit="%", basis=f"필수교육(내규 별표) {req['courses']}개 과정 이수 연인원 {req['done']:,}명 ÷ 대상 연인원 {req['target']:,}명")
        elif "만족" in txt:
            item.update(value=sat["avg"], unit="점", basis=f"만족도 응답 {sat['n']}건 전 문항 평균(5점 척도)")
            item["ok"] = sat["avg"] is not None
        elif "집행률" in txt:
            if budget:
                item.update(value=round(100 * sp["total"] / budget, 1), unit="%", basis=f"집행 {sp['total']:,}원 ÷ 예산 {budget:,}원")
            else:
                item.update(ok=False, basis="자료 필요: 교육훈련 예산표")
        elif "1인당" in name and ("비" in name or "비용" in txt):
            item.update(value=round(sp["total"] / n), unit="원", basis=f"집행 {sp['total']:,}원(외부교육비 {sp['external']:,} + 여비 {sp['travel']:,} + 강사료 {sp['lecture']:,}) ÷ {len(act)}명")
        else:
            item.update(ok=False, basis="계산 규칙 없음 – 산식을 보고 직접 입력")
        if item["value"] is None and item["ok"]:
            item.update(ok=False, basis=item["basis"] or "자료 필요")
        out.append(item)
    return {"kpis": out, "hours": hrs, "totals": tot, "total_hours": total_h, "per_capita": round(total_h / n, 1), "people": len(act),
            "target_hours": target_h, "gov_hours": gov_h, "below": below, "spend": sp, "budget": budget, "legal": legal, "required": req,
            "satisfaction": sat}


def hours_excel(res: dict, k: dict) -> bytes:
    import io

    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "집계"
    ws.append([f"{res['year']}년 교육훈련 실적 집계 (기준일 {res['base']})"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append(["재직 인원", k["people"], "총 교육시간", k["total_hours"], "1인당", k["per_capita"], "내규 목표", k["target_hours"] or "-",
               "정부 권장", k["gov_hours"] or "-"])
    ws.append([])
    ws.append(["분야", "교육시간", "1인당", "과정 수"])
    for c in CATS:
        ws.append([c, k["totals"][c], round(k["totals"][c] / max(1, k["people"]), 1), len(k["hours"]["courses"][c])])
    ws.append([])
    ws.append(["지표", "산식", "실적", "단위", "산출 근거"])
    for x in k["kpis"]:
        ws.append([x["name"], x["formula"], x["value"], x["unit"], x["basis"]])
    ws2 = wb.create_sheet("직원별")
    ws2.append(["사번", "성명", "소속", "직급", "직무", "법정", "필수", "직무교육", "외부(위탁)", "합계", "목표 대비(%)"])
    people = {p["id"]: p for p in res["people"]}
    for pid, v in k["hours"]["per"].items():
        p = people[pid]
        tot = round(sum(v.values()), 1)
        ws2.append([pid, p["name"], p["dept"], p.get("grade", ""), p["job"], v["법정"], v["필수"], v["직무"], v["외부"], tot,
                    round(100 * tot / k["target_hours"]) if k["target_hours"] else ""])
    ws3 = wb.create_sheet("과정별")
    ws3.append(["분야", "과정명"])
    for c in CATS:
        for t in k["hours"]["courses"][c]:
            ws3.append([c, t])
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["E"].width = 60
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
