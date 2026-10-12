"""자료 분류·해석: 표의 머리글을 보고 직원명단·이수기록·서명부·근무표·만족도 응답을 스스로 알아낸다.

기관마다 엑셀 양식이 달라도 되도록 머리글 이름을 여러 가지로 받아 준다(ALIASES).
"""
from __future__ import annotations

import datetime as dt
import os
import re

from .readers import Doc, Table
from .util import all_dates, hours_in, norm_name, num, parse_date, parse_range, yes

ALIASES = {
    "사번": ["사번", "직원번호", "사원번호", "개인번호", "아이디", "id", "학습자id", "교번"],
    "성명": ["성명", "이름", "직원명", "학습자명", "학습자", "수강자", "수강자명", "참석자", "성함"],
    "소속": ["소속", "부서", "부서명", "소속부서", "소속팀", "팀", "응답자소속"],
    "직위": ["직위", "직급", "직책"],
    "고용형태": ["고용형태", "고용구분", "신분", "채용구분", "근로형태"],
    "직무구분": ["직무구분", "직무", "업무구분", "직종", "직군"],
    "근무형태": ["근무형태", "근무유형", "근무구분"],
    "근무조": ["근무조", "조", "교대조"],
    "입사일": ["입사일", "임용일", "채용일", "입사일자", "입사"],
    "퇴사일": ["퇴사일", "퇴직일", "퇴사일자"],
    "휴직": ["휴직기간", "휴직", "휴직일"],
    "개인정보취급자": ["개인정보취급자", "개인정보취급", "개인정보"],
    "관리감독자": ["관리감독자", "관리감독"],
    "과정명": ["과정명", "교육명", "과정", "교육과정", "강좌명", "과목명", "교육과정명"],
    "이수일": ["이수일", "수료일", "완료일", "학습종료일", "종료일", "교육일", "교육일자", "이수일자"],
    "시작일": ["학습시작일", "시작일", "수강시작일"],
    "학습시간": ["인정시간", "학습시간", "교육시간", "이수시간", "시간", "인정시간(h)"],
    "이수여부": ["이수여부", "수료여부", "이수상태", "상태", "결과", "이수"],
    "진도율": ["진도율", "진도", "진도율(%)"],
    "서명": ["서명", "서명란", "확인", "참석확인", "참석여부"],
    "의견": ["의견", "건의사항", "기타의견", "자유의견"],
}
_LOOKUP = {}
for key, names in ALIASES.items():
    for n in names:
        _LOOKUP[re.sub(r"\s|\(.*?\)", "", n.lower())] = key


def canon(h: str) -> str | None:
    k = re.sub(r"\s|\(.*?\)|\*", "", str(h or "").lower())
    return _LOOKUP.get(k) or _LOOKUP.get(re.sub(r"\(.*?\)", "", str(h or "").lower()).replace(" ", ""))


def find_header(rows: list[list[str]]) -> tuple[int, dict[str, int]]:
    """앞쪽 10행 중 아는 머리글이 가장 많은 행을 머리글로 본다."""
    best, best_i, best_map = 0, -1, {}
    for i, r in enumerate(rows[:10]):
        cmap = {}
        for j, c in enumerate(r):
            k = canon(c)
            if k and k not in cmap:
                cmap[k] = j
        if len(cmap) > best:
            best, best_i, best_map = len(cmap), i, cmap
    return (best_i, best_map) if best >= 2 else (-1, {})


def _day_header(rows) -> int:
    for i, r in enumerate(rows[:10]):
        days = [c for c in r if re.fullmatch(r"\d{1,2}(일)?|\d{1,2}/\d{1,2}", c.strip())]
        if len(days) >= 20:
            return i
    return -1


def classify(t: Table) -> str:
    if _day_header(t.rows) >= 0:
        return "shift"
    hi, cmap = find_header(t.rows)
    if hi < 0:
        return "other"
    head = " ".join(t.rows[hi])
    if "성명" in cmap and "과정명" in cmap and ("이수여부" in cmap or "학습시간" in cmap or "이수일" in cmap):
        return "records"
    if "성명" in cmap and "서명" in cmap:
        return "sign"
    if "5점" in head or "만족" in head:
        return "survey"
    if "성명" in cmap and len({"입사일", "고용형태", "직위", "근무형태", "직무구분"} & set(cmap)) >= 2:
        return "roster"
    return "other"


KIND_LABEL = {"roster": "직원 명단", "records": "이수 기록", "sign": "집합교육 서명부", "cert": "수료증", "shift": "근무표",
              "survey": "만족도 조사", "guide": "지침·규정", "other": "기타"}


def doc_kinds(doc: Doc) -> list[str]:
    kinds = [classify(t) for t in doc.tables]
    text = "\n".join(t for t, _ in doc.texts)
    if not doc.tables and re.search(r"수\s*료\s*증|이수증", text) and re.search(r"성\s*명", text):
        kinds.append("cert")
    elif doc.texts and not any(k != "other" for k in kinds):
        kinds.append("guide")
    return [k for k in dict.fromkeys(kinds) if k != "other"] or ["other"]


def _get(r, cmap, key):
    j = cmap.get(key)
    return r[j].strip() if j is not None and j < len(r) else ""


# ───────────── 직원 명단
def parse_roster(t: Table, rel: str) -> list[dict]:
    hi, cmap = find_header(t.rows)
    people = []
    for i, r in enumerate(t.rows[hi + 1:], hi + 2):
        name = norm_name(_get(r, cmap, "성명"))
        if not name or not re.fullmatch(r"[가-힣A-Za-z·]{2,20}", name):
            continue
        shift = _get(r, cmap, "근무형태")
        job = _get(r, cmap, "직무구분")
        job = "사무" if "사무" in job or "행정" in job else ("현장" if job else ("현장" if "교대" in shift else "사무"))
        ls, le = parse_range(_get(r, cmap, "휴직"))
        people.append({
            "id": _get(r, cmap, "사번") or f"N{len(people) + 1:03d}", "name": name, "dept": _get(r, cmap, "소속"),
            "title": _get(r, cmap, "직위"), "emp": _get(r, cmap, "고용형태"), "job": job,
            "shift": "교대" if "교대" in shift else "일근", "team": _get(r, cmap, "근무조"),
            "hired": (parse_date(_get(r, cmap, "입사일")) or dt.date(2000, 1, 1)).isoformat(),
            "left": (parse_date(_get(r, cmap, "퇴사일")) or None) and parse_date(_get(r, cmap, "퇴사일")).isoformat(),
            "leave": [ls.isoformat(), le.isoformat()] if ls and le else None,
            "flags": {"개인정보취급자": yes(_get(r, cmap, "개인정보취급자")), "관리감독자": yes(_get(r, cmap, "관리감독자"))},
            "src": {"file": rel, "where": f"{t.where} {i}행"},
        })
    return people


# ───────────── 이수 기록(사이버교육 등 목록형)
def parse_records(t: Table, rel: str) -> list[dict]:
    hi, cmap = find_header(t.rows)
    out = []
    for i, r in enumerate(t.rows[hi + 1:], hi + 2):
        name = norm_name(_get(r, cmap, "성명"))
        title = _get(r, cmap, "과정명")
        if not name or not title:
            continue
        status = _get(r, cmap, "이수여부")
        prog = num(_get(r, cmap, "진도율"))
        done = ("이수" in status or "수료" in status or "완료" in status or status in ("Y", "O", "○")) and "미" not in status
        if not status:
            done = prog is None or prog >= 100
        if prog is not None and prog < 100:
            done = False
        hours = num(_get(r, cmap, "학습시간"))
        if not hours:
            hours = hours_in(title) or 0
        when = parse_date(_get(r, cmap, "이수일")) or parse_date(_get(r, cmap, "시작일"))
        out.append({"kind": "cyber", "title": title, "date": when.isoformat() if when else None, "hours": hours, "done": done,
                    "name": name, "emp_id": _get(r, cmap, "사번"), "dept": _get(r, cmap, "소속"),
                    "file": rel, "where": f"{t.where} {i}행", "note": "" if done else (f"진도율 {prog:g}%" if prog is not None else status)})
    return out


# ───────────── 집합교육 서명부
def sign_info(t: Table, rel: str, year: int) -> dict:
    hi, _ = find_header(t.rows)
    lines = list(t.before) + [" ".join(c for c in r if c) for r in t.rows[:max(hi, 0)]]
    stem = os.path.splitext(os.path.basename(rel))[0]
    title = ""
    for ln in lines:
        m = re.search(r"(?:교육명|과정명|교육과정)\s*[:：]\s*(.+)", ln)
        if m:
            title = m.group(1).strip()
            break
    if not title:
        title = next((ln for ln in lines if "교육" in ln and len(ln) < 80), "") or stem
    title = re.sub(r"\s*(참석자\s*)?(서명부|명단)\s*$", "", title)
    when, hours = None, None
    for ln in lines + [stem]:
        if not when:
            ds = all_dates(ln, year)
            when = ds[0] if ds else None
        if hours is None and re.search(r"\d+\s*시간|\d{1,2}:\d{2}", ln):
            hours = hours_in(ln)
    if hours is None:
        hours = hours_in(title) or hours_in(stem)
    # 제목에 과목명이 없으면(예: '1회차(밀폐공간)') 파일명·첫 줄의 교육 이름을 붙여 분류가 되게
    ctx = " ".join(lines[:2] + [stem])
    span = next((m.group(0) for ln in lines for m in [re.search(r"\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}", ln)] if m), "")
    place = next((m.group(1).strip() for ln in lines for m in [re.search(r"장소\s*[:：]\s*([^/]+)", ln)] if m), "")
    return {"title": title, "date": when.isoformat() if when else None, "hours": hours or 0, "context": ctx, "time": span,
            "place": place}


def parse_sign(t: Table, rel: str, year: int) -> tuple[dict, list[dict]]:
    info = sign_info(t, rel, year)
    hi, cmap = find_header(t.rows)
    out = []
    for i, r in enumerate(t.rows[hi + 1:], hi + 2):
        name = norm_name(_get(r, cmap, "성명"))
        if not name or not re.fullmatch(r"[가-힣A-Za-z·]{2,20}", name):
            continue
        signed = bool(_get(r, cmap, "서명"))
        out.append({"kind": "sign", "title": info["title"], "context": info["context"], "date": info["date"], "hours": info["hours"],
                    "done": signed, "name": name, "emp_id": _get(r, cmap, "사번"), "dept": _get(r, cmap, "소속"),
                    "file": rel, "where": f"{t.where} {i}행", "note": "" if signed else "서명 없음(불참)"})
    return info, out


# ───────────── 수료증(PDF·한글 문서의 글)
def parse_cert(doc: Doc, rel: str) -> list[dict]:
    text = "\n".join(t for t, _ in doc.texts)

    def grab(label):
        m = re.search(label + r"\s*[:：]\s*(.+)", text)
        return m.group(1).strip() if m else ""

    name = norm_name(grab(r"성\s*명"))
    if not name:
        return []
    title = grab(r"과\s*정\s*명") or grab(r"교\s*육\s*명") or os.path.basename(rel)
    period = grab(r"교\s*육\s*기\s*간") or grab(r"수\s*료\s*일") or text
    ds = all_dates(period) or all_dates(text)
    dept = re.sub(r"^\S*(공단|공사|재단|청|시|구|군)\s+", "", grab(r"소\s*속"))
    return [{"kind": "cert", "title": title, "date": ds[-1].isoformat() if ds else None,
             "hours": hours_in(period) or hours_in(text) or 0, "done": True, "name": name, "emp_id": "", "dept": dept,
             "file": rel, "where": doc.texts[0][1] if doc.texts else "", "note": ""}]


# ───────────── 근무표
def parse_shift(t: Table, rel: str, year: int) -> dict:
    hi = _day_header(t.rows)
    head = t.rows[hi]
    text = " ".join(" ".join(r) for r in t.rows[:hi]) + " " + " ".join(t.before) + " " + os.path.basename(rel)
    m = re.search(r"(20\d{2})\s*[년.\-]\s*(\d{1,2})\s*월?", text)
    y, mo = (int(m.group(1)), int(m.group(2))) if m else (year, None)
    if not mo:
        m2 = re.search(r"(\d{1,2})\s*월", text)
        mo = int(m2.group(1)) if m2 else 1
    cols = {}
    for j, c in enumerate(head):
        mm = re.fullmatch(r"(\d{1,2})(일)?|(\d{1,2})/(\d{1,2})", c.strip())
        if mm:
            day = int(mm.group(1) or mm.group(4))
            try:
                cols[j] = dt.date(y, mo, day).isoformat()
            except ValueError:
                pass
    cmap = {}
    for j, c in enumerate(head):
        k = canon(c)
        if k and k not in cmap:
            cmap[k] = j
    people = []
    for r in t.rows[hi + 1:]:
        name = norm_name(_get(r, cmap, "성명"))
        if not name:
            continue
        people.append({"emp_id": _get(r, cmap, "사번"), "name": name, "dept": _get(r, cmap, "소속"), "team": _get(r, cmap, "근무조"),
                       "codes": {d: (r[j].strip() if j < len(r) else "") for j, d in cols.items()}})
    legend = " ".join(" ".join(r) for r in t.rows[:hi])
    return {"month": f"{y}-{mo:02d}", "days": sorted(cols.values()), "people": people, "file": rel, "legend": legend}


# ───────────── 만족도 조사
def parse_survey(t: Table, rel: str) -> list[dict]:
    hi, cmap = find_header(t.rows)
    head = t.rows[hi]
    score_cols = [j for j, h in enumerate(head) if "5점" in h or "만족" in h or "적절" in h or "도움" in h]
    out = []
    for i, r in enumerate(t.rows[hi + 1:], hi + 2):
        course = _get(r, cmap, "과정명")
        scores = {head[j]: num(r[j]) for j in score_cols if j < len(r) and num(r[j]) is not None}
        if not scores:
            continue
        out.append({"course": course, "dept": _get(r, cmap, "소속"), "scores": scores, "comment": _get(r, cmap, "의견"),
                    "file": rel, "where": f"{t.where} {i}행"})
    return out
