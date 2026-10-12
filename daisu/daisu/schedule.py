"""교대근무표 기반 집합교육 일정 추천.

원칙(설정에서 바꿀 수 있음)
  - 교육은 근무시간 중 실시: 교대 근무자는 '주간' 근무일에만 배정, 비번·휴무일에는 부르지 않음
  - 그날 근무 중인 팀 인원의 일정 비율(기본 50%) 이상은 현장에 남김
  - 일근 직원은 평일(공휴일 제외)에 배정, 같은 팀 절반 이상은 사무실에 남김
  - 교육장 정원, 최대 회차 수 제한
가장 많은 대상자를 담는 회차부터 차례로 고르는 방식(탐욕적 집합 덮기)이라 결과를 사람이 쉽게 검증할 수 있다.
"""
from __future__ import annotations

import datetime as dt
import math

from . import config
from .util import kdate, norm_name, same_dept


def _shift_index(shifts: list[dict], people: list[dict]) -> tuple[dict, list[str]]:
    """직원 id → {날짜: 근무코드}."""
    by_id = {p["id"]: p for p in people}
    by_name: dict[str, list] = {}
    for p in people:
        by_name.setdefault(p["name"], []).append(p)
    idx, days = {}, set()
    for sh in shifts:
        days |= set(sh["days"])
        for row in sh["people"]:
            pid = row["emp_id"] if row["emp_id"] in by_id else None
            if not pid:
                c = [p for p in by_name.get(norm_name(row["name"]), []) if not row["dept"] or same_dept(row["dept"], p["dept"])]
                pid = c[0]["id"] if len(c) == 1 else None
            if pid:
                idx[pid] = row["codes"]
    return idx, sorted(days)


def plan(result: dict, col_key: str, hours: float | None = None, start: str | None = None, end: str | None = None) -> dict:
    st = config.settings()["schedule"]
    people = {p["id"]: p for p in result["people"]}
    col = next(c for c in result["columns"] if c["key"] == col_key)
    base = dt.date.fromisoformat(result["base"])
    shift_idx, shift_days = _shift_index(result["shifts"], result["people"])
    holidays = set(st.get("holidays", []))
    day_codes, rest_codes = set(st["day_shift_codes"]), set(st["rest_codes"])
    ratio = float(st.get("min_on_duty_ratio", 0.5))

    # 대상: 이 교육을 아직 못 마친 사람(휴직·퇴사 제외)
    need = {}
    for pid, row in result["cells"].items():
        c = row[col_key]
        if c["s"] in ("none", "partial"):
            need[pid] = max(0.0, c["need"] - c["h"])
    if not need:
        return {"col": col, "sessions": [], "unplaced": [], "targets": 0, "message": "이 교육은 대상자 모두 이수했습니다."}
    L = float(hours or min(4.0, max(need.values())))
    times = {pid: math.ceil(round(h / L, 3)) for pid, h in need.items()}

    # 기간: 기본은 근무표가 있는 달(없으면 기준일+7일 ~ 기한)
    due = dt.date.fromisoformat(col["due"]) if col.get("due") else base + dt.timedelta(days=30)
    if start:
        d0 = dt.date.fromisoformat(start)
    elif shift_days:
        d0 = max(dt.date.fromisoformat(shift_days[0]), base + dt.timedelta(days=1))
    else:
        d0 = base + dt.timedelta(days=7)
    d1 = dt.date.fromisoformat(end) if end else (dt.date.fromisoformat(shift_days[-1]) if shift_days else due)
    d1 = min(d1, due) if due >= d0 else d1
    dates = []
    d = d0
    while d <= d1:
        if d.weekday() < 5 and d.isoformat() not in holidays:
            dates.append(d)
        d += dt.timedelta(days=1)

    def available(pid, day):
        p = people[pid]
        if p["shift"] == "교대":
            code = shift_idx.get(pid, {}).get(day.isoformat())
            if code is None:
                return False, "근무표에 없음"
            if code in day_codes:
                return True, ""
            return False, "비번·휴무" if code in rest_codes else f"근무코드 {code}"
        return True, ""

    # 팀별 그날 근무 인원(현장 최소 인원 계산용)
    def on_duty(dept, day):
        n = 0
        for p in people.values():
            if p["dept"] != dept or p.get("left"):
                continue
            if p["shift"] == "교대":
                n += shift_idx.get(p["id"], {}).get(day.isoformat()) in day_codes
            else:
                n += 1
        return n

    slots = [(day, s["name"], s["start"]) for day in dates for s in st["slots"]]
    left = dict(times)
    used_day: dict[str, set] = {}
    sessions = []
    cap_room = int(st.get("room_capacity", 40))
    while any(v > 0 for v in left.values()) and len(sessions) < int(st.get("max_sessions", 8)):
        best = None
        for day, part, t0 in slots:
            if any(s["date"] == day.isoformat() and s["part"] == part for s in sessions):
                continue
            quota: dict[str, int] = {}
            picked = []
            for pid in sorted(left, key=lambda x: (-left[x], people[x]["dept"], people[x]["name"])):
                if left[pid] <= 0 or pid in used_day.get(day.isoformat(), set()):
                    continue
                ok, _ = available(pid, day)
                if not ok:
                    continue
                dept = people[pid]["dept"]
                if dept not in quota:
                    quota[dept] = max(1, math.floor(on_duty(dept, day) * (1 - ratio)))
                if quota[dept] <= 0:
                    continue
                quota[dept] -= 1
                picked.append(pid)
                if len(picked) >= cap_room:
                    break
            if picked and (not best or len(picked) > len(best[3])):
                best = (day, part, t0, picked)
        if not best:
            break
        day, part, t0, picked = best
        for pid in picked:
            left[pid] -= 1
            used_day.setdefault(day.isoformat(), set()).add(pid)
        h0, m0 = map(int, t0.split(":"))
        lunch = 1 if L > 4 and h0 < 12 < h0 + L else 0  # 4시간을 넘는 교육만 점심 1시간을 끼움
        end_t = dt.datetime(2000, 1, 1, h0, m0) + dt.timedelta(hours=L + lunch)
        by_dept: dict[str, int] = {}
        for pid in picked:
            by_dept[people[pid]["dept"]] = by_dept.get(people[pid]["dept"], 0) + 1
        sessions.append({"date": day.isoformat(), "label": f"{kdate(day)} {part} {t0}~{end_t:%H:%M}", "part": part,
                         "count": len(picked), "by_dept": by_dept,
                         "people": [{"id": pid, "name": people[pid]["name"], "dept": people[pid]["dept"],
                                     "team": people[pid].get("team", ""), "shift": people[pid]["shift"]} for pid in picked]})
    sessions.sort(key=lambda s: (s["date"], s["part"]))
    unplaced = []
    for pid, v in left.items():
        if v > 0:
            p = people[pid]
            n_days = sum(1 for day in dates if available(pid, day)[0])
            if p["shift"] == "교대" and pid not in shift_idx:
                why = "근무표에 이름이 없음"
            elif n_days < times[pid]:
                why = f"기간 내 주간 근무일 {n_days}일뿐" if n_days else "기간 내 주간 근무일이 없음"
            else:
                why = "최대 회차 수 도달(설정에서 늘리거나 사이버교육 안내)"
            unplaced.append({"id": pid, "name": p["name"], "dept": p["dept"], "team": p.get("team", ""), "remain": v, "why": why})

    # 비교: 대상자 전원을 하루에 모으면?
    naive = None
    if dates:
        day = dates[len(dates) // 2]
        absent = [pid for pid in need if not available(pid, day)[0]]
        over = []
        for dept in {people[pid]["dept"] for pid in need}:
            want = sum(1 for pid in need if people[pid]["dept"] == dept and available(pid, day)[0])
            cap = max(1, math.floor(on_duty(dept, day) * (1 - ratio)))
            if want > cap:
                over.append({"dept": dept, "want": want, "cap": cap})
        naive = {"date": kdate(day), "absent": len(absent), "over": over}

    return {"col": col, "hours": L, "targets": len(need), "sessions": sessions, "unplaced": unplaced,
            "range": [d0.isoformat(), d1.isoformat()], "naive": naive,
            "rules": [f"교대 근무자는 주간({', '.join(sorted(day_codes))}) 근무일에만 배정, 비번·휴무일 제외",
                      f"팀별로 그날 근무 인원의 {int(ratio * 100)}% 이상은 현장에 남김",
                      f"교육장 정원 {cap_room}명, 한 사람은 하루 한 회차",
                      "평일·공휴일 제외(설정에서 공휴일 수정)"]}
