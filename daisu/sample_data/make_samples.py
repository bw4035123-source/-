"""모의데이터 생성기 – 가상 기관 '가상구시설관리공단' 교육담당자의 자료 폴더.

모든 인물·기관은 가상이며 실제 개인정보를 포함하지 않는다.
실제 업무에서 자주 생기는 함정을 일부러 넣었다.
  - 동명이인(김민수 2명), 서명부의 이름 오타(이영히), 소속이 빈 서명
  - 상반기 현장직 안전교육을 한 회차만 들어 시간이 모자란 사람(기한 지남)
  - 청렴교육을 1시간짜리만 들어 1시간 부족한 사람, 진도율 미달로 미이수 처리된 사람
  - 휴직자, 퇴사자, 신규입사자(채용 시 교육 미이수 1명)
  - 의무교육이 아닌 과정(기록관리 실무)이 이수 목록에 섞여 있음

실행: python sample_data/make_samples.py   (reportlab·python-hwpx 필요)
"""
from __future__ import annotations

import datetime as dt
import os
import random
import shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "가상구시설관리공단_교육자료")
ORG = "가상구시설관리공단"
R = random.Random(20261012)
R2 = random.Random(77)  # 새로 넣은 항목(직급·직무교육·외부교육)은 별도 난수로 – 기존 자료의 값은 그대로

SURNAMES = list("김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허남심노하곽성차주우구민진나엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경")
GIVEN = ["민준", "서연", "도윤", "하은", "지호", "수아", "예준", "지유", "시우", "서윤", "주원", "하린", "지훈", "유진", "건우", "채원",
         "현우", "다은", "우진", "소윤", "선우", "예린", "연우", "윤서", "정우", "가은", "승현", "지아", "준서", "수빈", "태윤", "나연",
         "동현", "은서", "성민", "혜진", "재원", "민지", "상우", "보람", "영호", "미경", "철수", "순자", "경숙", "광수", "정희", "명수"]

# 부서: (이름, 직무구분, 인원, 교대 인원)
DEPTS = [
    ("경영지원팀", "사무", 12, 0),
    ("기획예산팀", "사무", 8, 0),
    ("체육시설팀", "현장", 36, 30),
    ("주차관리팀", "현장", 24, 21),
    ("환경시설팀", "현장", 22, 18),
    ("문화센터팀", "사무", 18, 0),
]


def path(*p):
    full = os.path.join(ROOT, *p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    return full


def wd(d: dt.date) -> str:
    return "월화수목금토일"[d.weekday()]


def kdate(d: dt.date) -> str:
    return f"{d.year}. {d.month}. {d.day}.({wd(d)})"


def rand_date(a: str, b: str, rng=None) -> dt.date:
    x, y = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    d = x + dt.timedelta(days=(rng or R).randint(0, (y - x).days))
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


# ───────────── 직원 명단 만들기
def make_people():
    used, people = set(), []
    n = 0
    for dept, job, size, shift in DEPTS:
        for k in range(size):
            while True:
                name = R.choice(SURNAMES[:20]) + R.choice(GIVEN)
                if name not in used and name not in ("김민수", "이영희"):
                    used.add(name)
                    break
            n += 1
            is_shift = k >= size - shift
            title = "팀장" if k == 0 else ("파트장" if job == "현장" and k in (1, 2) else R.choice(["대리", "주임", "사원", "주임"]))
            emp = "정규직" if k < size * 0.6 else ("무기계약직" if k < size * 0.9 else "기간제")
            hired = dt.date(R.randint(2008, 2025), R.randint(1, 12), R.randint(1, 28))
            people.append({
                "사번": f"{hired.year % 100:02d}{n:03d}", "성명": name, "소속": dept, "직위": title, "고용형태": emp,
                "직무구분": job, "근무형태": "교대" if is_shift else "일근",
                "근무조": "ABC"[(k - (size - shift)) % 3] if is_shift else "", "입사일": hired, "퇴사일": None, "휴직기간": "",
                "개인정보취급자": "Y" if (job == "사무" and k % 3 != 2) or (dept == "체육시설팀" and k in (3, 4, 5)) else "",
                "관리감독자": "Y" if title in ("팀장", "파트장") and job == "현장" else "",
            })
    by = {p["소속"]: [x for x in people if x["소속"] == p["소속"]] for p in people}
    # 함정: 동명이인 김민수(체육시설팀 교대 / 주차관리팀 교대), 이름 오타 대상 이영희
    by["체육시설팀"][10]["성명"] = "김민수"
    by["주차관리팀"][8]["성명"] = "김민수"
    by["환경시설팀"][9]["성명"] = "이영희"
    # 휴직: 육아휴직(연말까지), 병가휴직(11월 말 복직)
    by["문화센터팀"][6]["휴직기간"] = "2026.03.01~2027.02.28"
    by["주차관리팀"][12]["휴직기간"] = "2026.08.01~2026.11.30"
    # 퇴사자
    by["경영지원팀"][9]["퇴사일"] = dt.date(2026, 7, 31)
    # 신규입사자 3명(채용 시 교육 대상)
    for dept, d in (("체육시설팀", "2026-09-01"), ("주차관리팀", "2026-09-01"), ("환경시설팀", "2026-10-05")):
        p = by[dept][-1]
        p["입사일"] = dt.date.fromisoformat(d)
        p["고용형태"] = "기간제"
    # 직급(여비 등급 판단용)과 올해 승진일
    grade = {"팀장": "3급", "파트장": "4급", "대리": "5급", "주임": "6급", "사원": "7급"}
    for p in people:
        p["직급"] = grade.get(p["직위"], "7급")
        p["승진일"] = None
    for p in R2.sample([x for x in people if x["직위"] in ("대리", "파트장") and not x["휴직기간"] and not x["퇴사일"]], 6):
        p["승진일"] = dt.date(2026, R2.choice([3, 7]), 1)
    return people


def roster_xlsx(people):
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "인사현황"
    ws.append([f"{ORG} 직원 현황 (2026. 10. 1. 기준)"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    cols = ["사번", "성명", "소속", "직위", "직급", "고용형태", "직무구분", "근무형태", "근무조", "입사일", "승진일", "퇴사일", "휴직기간",
            "개인정보취급자", "관리감독자"]
    ws.append(cols)
    for p in people:
        ws.append([p[c] for c in cols])
    for row in ws.iter_rows(min_row=4, min_col=10, max_col=12):
        for c in row:
            c.number_format = "yyyy-mm-dd"
    wb.save(path("01_인사", "2026_직원현황(10월1일자).xlsx"))


# ───────────── 사이버교육 이수 현황(플랫폼 내려받기 엑셀)
CYBER = [
    # (과정명, 시간, 이수율, 시작, 끝, 대상 조건)
    ("2026 성희롱·성매매·성폭력·가정폭력 예방 통합교육(4H)", 4, 0.86, "2026-03-02", "2026-09-30", lambda p: True),
    ("장애인 인식개선 교육(1H)", 1, 0.62, "2026-04-01", "2026-09-25", lambda p: p["직무구분"] == "사무"),
    ("2026 청렴윤리 기본과정(2H)", 2, 0.58, "2026-05-01", "2026-10-08", lambda p: True),
    ("청렴 첫걸음(1H)", 1, 0.0, "2026-05-01", "2026-09-30", lambda p: False),  # 아래에서 일부에게만
    ("개인정보보호 기본교육(1H)", 1, 0.78, "2026-03-15", "2026-09-30", lambda p: p["개인정보취급자"] == "Y"),
    ("직장 내 괴롭힘 예방과 대응(1H)", 1, 0.5, "2026-04-01", "2026-09-30", lambda p: True),
    ("산업안전보건 정기교육 – 사무직(6H)", 6, 0.92, "2026-04-01", "2026-06-26", lambda p: p["직무구분"] == "사무"),
    ("산업안전보건 정기교육 – 사무직 하반기(6H)", 6, 0.25, "2026-07-01", "2026-10-08", lambda p: p["직무구분"] == "사무"),
    ("관리감독자 안전보건교육(16H)", 16, 0.5, "2026-03-01", "2026-09-30", lambda p: p["관리감독자"] == "Y"),
]


JOB_COURSES = [
    # (과정명, 시간, 이수율, 시작, 끝, 대상) – 직무교육과 내규 필수교육
    ("신규임용자 기본교육(16H)", 16, 1.0, "2026-01-01", "2026-12-31", lambda p: p["입사일"] == dt.date(2026, 9, 1)),
    ("승진자 역량향상 과정(12H)", 12, 0.5, "2026-03-15", "2026-09-30", lambda p: bool(p["승진일"])),
    ("신임 관리자 리더십(8H)", 8, 0.6, "2026-03-01", "2026-09-30", lambda p: p["직위"] == "팀장"),
    ("고객응대 CS 실무(4H)", 4, 0.68, "2026-03-01", "2026-09-30", lambda p: p["직무구분"] == "현장"),
    ("AI 활용 업무혁신(3H)", 3, 0.45, "2026-04-01", "2026-10-08", lambda p: p["직무구분"] == "사무"),
    ("엑셀 데이터 분석 실무(6H)", 6, 0.3, "2026-04-01", "2026-10-08", lambda p: p["직무구분"] == "사무"),
    ("공공회계 실무(8H)", 8, 0.7, "2026-03-01", "2026-09-30", lambda p: p["소속"] in ("경영지원팀", "기획예산팀")),
    ("수영장 안전요원 직무교육(8H)", 8, 0.8, "2026-04-01", "2026-08-31", lambda p: p["소속"] == "체육시설팀" and p["근무형태"] == "교대"),
    ("인권 감수성 향상 예방교육(2H)", 2, 0.2, "2026-05-01", "2026-09-30", lambda p: p["직무구분"] == "사무"),
]


def cyber_xlsx(people):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "이수현황"
    ws.append(["[공공e배움터] 기관 학습자 이수현황 내려받기", "", "", "", "기관: " + ORG, "", "", "", "출력일: 2026-10-08"])
    ws.append(["아이디", "성명", "소속", "과정명", "학습시작일", "학습종료일", "인정시간", "진도율(%)", "이수여부"])
    rows = []
    active = [p for p in people if not p["퇴사일"] or p["퇴사일"] > dt.date(2026, 3, 1)]
    for title, hours, rate, a, b, cond in CYBER:
        for p in active:
            if not cond(p):
                continue
            if p["휴직기간"].startswith("2026.03"):
                continue  # 육아휴직자는 수강 기록 없음
            if p["입사일"] >= dt.date(2026, 9, 1) and "통합" not in title:
                continue
            roll = R.random()
            if roll < rate:
                end = rand_date(a, b)
                rows.append([p["사번"], p["성명"], p["소속"], title, end - dt.timedelta(days=R.randint(0, 6)), end, hours, 100, "이수"])
            elif roll < rate + 0.08:  # 듣다 만 사람
                end = rand_date(a, b)
                rows.append([p["사번"], p["성명"], p["소속"], title, end, None, 0, R.choice([20, 45, 60, 80]), "미이수"])
    # 청렴 1시간 과정만 들은 사람(1시간 부족)
    integ_done = {r[0] for r in rows if "청렴윤리" in r[3] and r[8] == "이수"}
    for p in [x for x in active if x["사번"] not in integ_done][:9]:
        end = rand_date("2026-06-01", "2026-09-30")
        rows.append([p["사번"], p["성명"], p["소속"], "청렴 첫걸음(1H)", end, end, 1, 100, "이수"])
    # 신규입사자 채용 시 교육: 9/1 입사자 2명 이수, 10/5 입사자는 기록 없음
    for p in people:
        if p["입사일"] == dt.date(2026, 9, 1):
            d = dt.date(2026, 9, 1)
            rows.append([p["사번"], p["성명"], p["소속"], "채용 시 안전보건교육(8H)", d, d, 8, 100, "이수"])
    # 의무교육이 아닌 과정
    for p in R.sample([x for x in active if x["직무구분"] == "사무"], 7):
        d = rand_date("2026-04-01", "2026-09-30")
        rows.append([p["사번"], p["성명"], p["소속"], "공공기관 기록관리 실무(3H)", d, d, 3, 100, "이수"])
    # 직무·필수(내규) 교육
    for title, hours, rate, a, b, cond in JOB_COURSES:
        for p in active:
            if not cond(p) or p["휴직기간"].startswith("2026.03"):
                continue
            if R2.random() < rate:
                end = rand_date(a, b, R2) if "신규" not in title else p["입사일"] + dt.timedelta(days=R2.randint(5, 20))
                rows.append([p["사번"], p["성명"], p["소속"], title, end - dt.timedelta(days=R2.randint(0, 3)), end, hours, 100, "이수"])
    rows.sort(key=lambda r: (r[3], r[2], r[1]))
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=3, min_col=5, max_col=6):
        for c in row:
            c.number_format = "yyyy-mm-dd"
    wb.save(path("02_이수기록", "사이버교육_이수현황_20261008.xlsx"))


# ───────────── 집합교육 서명부
def field_people(people):
    return [p for p in people if p["직무구분"] == "현장" and not p["관리감독자"] and not p["휴직기간"].startswith("2026.03")
            and p["입사일"] < dt.date(2026, 6, 1)]


def sign_rows(people, attended):
    out = []
    for i, p in enumerate(people, 1):
        out.append([str(i), p["소속"], p["성명"], "서명" if p["사번"] in attended else ""])
    return out


def safety_signsheets(people):
    fp = field_people(people)
    # 1회차(4시간)와 2회차(8시간)를 모두 들어야 12시간. 일부는 1회차만 들음 → 상반기 시간 부족
    s1 = {p["사번"] for p in fp}
    s2 = {p["사번"] for p in fp}
    only1 = R.sample(sorted(s1), 7)
    s2 -= set(only1)
    none = R.sample(sorted(s1 - set(only1)), 2)
    s1 -= set(none)
    s2 -= set(none)
    by_dept = sorted(fp, key=lambda p: (p["소속"], p["성명"]))

    # 1회차: 한글(HWPX) 서명부 – 표 안의 이름 오타·소속 빈칸 함정
    rows = sign_rows(by_dept, s1)
    for r in rows:
        if r[2] == "이영희":
            r[2] = "이영히"  # 오타
        if r[2] == "김민수" and r[1] == "체육시설팀":
            r[1] = ""  # 소속을 안 적음 → 동명이인 구분 불가
    make_hwpx_sign(
        path("02_이수기록", "집합교육", "2026 상반기 산업안전보건교육(현장직 1회차) 서명부.hwpx"),
        ["2026년 상반기 산업안전보건 정기교육(현장직) 참석자 서명부",
         "교육명: 상반기 산업안전보건 정기교육 1회차(밀폐공간·추락 예방)",
         f"교육일시: {kdate(dt.date(2026, 6, 11))} 14:00~18:00 (4시간)",
         "장소: 본사 3층 대회의실 / 강사: 가상안전기술원 정안전 강사"],
        ["연번", "소속", "성명", "서명"], rows)

    # 2회차: 엑셀 서명부
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "서명부"
    ws.append(["2026년 상반기 산업안전보건 정기교육(현장직) 2회차 참석자 명단"])
    ws.append([f"일시: {kdate(dt.date(2026, 6, 25))} 09:00~18:00 (8시간, 점심 1시간 제외)", "", "장소: 본사 3층 대회의실"])
    ws.append([])
    ws.append(["연번", "소속", "성명", "서명"])
    for r in sign_rows(by_dept, s2):
        ws.append(r)
    wb.save(path("02_이수기록", "집합교육", "2026 상반기 산업안전보건교육(현장직 2회차) 서명부.xlsx"))
    return s1, s2


def make_hwpx_sign(out, head_lines, header, rows):
    import warnings

    from hwpx import HwpxDocument

    warnings.filterwarnings("ignore", category=DeprecationWarning)
    doc = HwpxDocument.new()
    doc.paragraphs[0].add_run(head_lines[0], char_pr_id_ref=doc.ensure_run_style(bold=True, size=14))
    for t in head_lines[1:]:
        doc.add_paragraph(t)
    t = doc.add_table(len(rows) + 1, len(header))
    for c, hname in enumerate(header):
        t.set_cell_text(0, c, hname)
    for ri, row in enumerate(rows, 1):
        for c, v in enumerate(row):
            t.set_cell_text(ri, c, v)
    with open(out, "wb") as f:
        f.write(doc.to_bytes())


def disability_docx(people):
    """현장직 장애인 인식개선 집합교육(워드 서명부) – 서명이 빈 사람은 불참."""
    from docx import Document

    fp = [p for p in people if p["직무구분"] == "현장" and not p["휴직기간"].startswith("2026.03") and p["입사일"] < dt.date(2026, 9, 1)]
    fp.sort(key=lambda p: (p["소속"], p["성명"]))
    absent = set(R.sample([p["사번"] for p in fp], 11))
    d = Document()
    d.add_heading("장애인 인식개선 교육 참석자 서명부", 1)
    d.add_paragraph(f"교육일시: {kdate(dt.date(2026, 9, 10))} 10:00~11:00 (1시간)")
    d.add_paragraph("대상: 현장직 직원 / 장소: 본사 3층 대회의실 / 강사: 가상장애인고용공단 전문강사")
    t = d.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    for c, hname in enumerate(["연번", "부서", "이름", "서명"]):
        t.rows[0].cells[c].text = hname
    for i, p in enumerate(fp, 1):
        cells = t.add_row().cells
        cells[0].text, cells[1].text, cells[2].text = str(i), p["소속"], p["성명"]
        cells[3].text = "" if p["사번"] in absent else "(서명)"
    d.save(path("02_이수기록", "집합교육", "장애인 인식개선 교육(현장직) 서명부_0910.docx"))
    return len(fp) - len(absent)


# ───────────── 외부교육 수료증(PDF)
def certificates(people):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
    sup = [p for p in people if p["관리감독자"] == "Y"]
    picks = sup[-3:]
    for i, p in enumerate(picks, 1):
        d = dt.date(2026, 8, 20 + i)
        out = path("02_이수기록", "외부교육_수료증", f"수료증_{p['성명']}.pdf")
        c = canvas.Canvas(out)
        y = 760
        for t, size in [("수   료   증", 26), ("", 12), (f"제 2026-관리-{100 + i}호", 11), ("", 12),
                        (f"성      명 : {p['성명']}", 13), (f"소      속 : {ORG} {p['소속']}", 13),
                        ("과  정  명 : 관리감독자 정기 안전보건교육", 13),
                        (f"교육기간 : {d.year}. {d.month}. {d.day - 1}. ~ {d.year}. {d.month}. {d.day}. (16시간)", 13),
                        ("", 12), ("위 사람은 산업안전보건법 제29조에 따른 관리감독자 정기교육 과정을", 12),
                        ("이수하였으므로 이 증서를 수여합니다.", 12), ("", 30),
                        (f"{d.year}년 {d.month}월 {d.day}일", 13), ("", 12), ("가상안전보건교육원장", 18)]:
            c.setFont("HYGothic-Medium", size)
            c.drawCentredString(297, y, t) if size >= 18 or "년" in t[:6] else c.drawString(90, y, t)
            y -= size + 14
        c.save()


# ───────────── 11월 교대근무표
PATTERN = ["주", "주", "야", "야", "비", "휴"]


def shift_xlsx(people):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "11월"
    ws.append(["2026년 11월 교대근무표 (체육시설팀·주차관리팀·환경시설팀)"])
    ws.append(["※ 주: 주간(09~18시)  야: 야간(18~익일 09시)  비: 비번(야간 다음 날)  휴: 휴무"])
    ws.append(["사번", "성명", "소속", "조"] + [str(d) for d in range(1, 31)])
    offset = {"A": 0, "B": 2, "C": 4}
    for p in people:
        if p["근무형태"] != "교대":
            continue
        codes = [PATTERN[(d - 1 + offset[p["근무조"]]) % 6] for d in range(1, 31)]
        if p["휴직기간"].startswith("2026.08"):
            codes = ["휴직"] * 29 + [codes[-1]]
        ws.append([p["사번"], p["성명"], p["소속"], p["근무조"]] + codes)
    wb.save(path("03_근무표", "2026년_11월_교대근무표.xlsx"))


# ───────────── 만족도 조사
def survey_xlsx():
    from openpyxl import Workbook

    comments = ["실제 사고 사례 위주라 이해가 잘 됐습니다", "8시간은 너무 길어요. 두 번으로 나눠 주세요", "야간 근무 후 바로 와서 힘들었습니다",
                "현장 장비로 실습하면 좋겠습니다", "강사님 설명이 좋았습니다", "", "자료를 미리 나눠 주면 좋겠습니다", "교육장이 덥습니다",
                "밀폐공간 내용은 우리 팀 업무와 직접 관련 있어 유익", "", "시간이 길어 집중이 어려웠음", "사례 영상이 도움이 됨"]
    wb = Workbook()
    ws = wb.active
    ws.title = "응답"
    ws.append(["교육명", "응답자 소속", "교육 내용 만족(5점)", "강사 만족(5점)", "업무 도움(5점)", "시간·장소 적절(5점)", "의견"])
    for _ in range(46):
        ws.append(["상반기 산업안전보건 정기교육 2회차", R.choice(["체육시설팀", "주차관리팀", "환경시설팀"]),
                   R.choice([5, 4, 4, 4, 3, 5]), R.choice([5, 5, 4, 4, 4]), R.choice([4, 4, 5, 3, 4]), R.choice([2, 3, 3, 2, 4, 3]),
                   R.choice(comments)])
    for _ in range(38):
        ws.append(["장애인 인식개선 교육(현장직)", R.choice(["체육시설팀", "주차관리팀", "환경시설팀"]),
                   R.choice([5, 4, 5, 4]), R.choice([5, 5, 4]), R.choice([4, 3, 4, 5]), R.choice([4, 5, 4, 3]),
                   R.choice(["짧고 핵심만 있어 좋았습니다", "", "수어 기초를 배워서 유익했어요", "민원 응대 사례가 더 있으면 좋겠습니다", ""])])
    wb.save(path("04_만족도조사", "2026_집합교육_만족도조사_응답.xlsx"))


# ───────────── 내부 지침(질문하기 근거)
GUIDE = [
    f"2026년 법정의무교육 운영 지침 ({ORG} 경영지원팀)",
    "1. 목적: 법령에 따른 의무교육을 전 직원이 기한 내에 이수하도록 교육 운영 기준을 정한다.",
    "2. 적용 대상: 정규직, 무기계약직, 기간제 근로자를 포함한 전 직원. 단, 휴직 중인 직원은 복직 후 30일 이내에 미이수 교육을 이수한다.",
    "3. 이수 인정 기준: 사이버교육은 진도율 100% 및 평가 통과 시 이수로 인정한다. 집합교육은 서명부에 서명한 경우에만 인정한다.",
    "4. 교육 시간: 집합교육은 근무시간 중 실시하며 교육 시간은 근무로 인정한다. 야간 근무 다음 날(비번)에는 집합교육 참석을 요구하지 않는다.",
    "5. 현장 근무 인원: 집합교육 실시 중에도 각 팀은 그날 근무자의 절반 이상을 현장에 남겨야 한다.",
    "6. 신규 입사자: 채용 시 안전보건교육(8시간)을 업무 배치 전에 이수한다.",
    "7. 미이수자 조치: 기한 1개월 전 본인 안내, 2주 전 부서장 통보, 기한 경과 시 경영지원팀장에게 보고한다.",
    "8. 결과 제출: 성희롱 등 폭력예방교육 실적은 다음 해 2월 말까지 주무부처 시스템에 등록한다. 청렴교육 실적은 기관 청렴 업무 담당과 공유한다.",
    "9. 개인정보보호 교육: 개인정보취급자는 연 1회 이상 이수하며, 개인정보 내부관리계획에 따른다.",
]


def guide_hwpx():
    import warnings

    from hwpx import HwpxDocument

    warnings.filterwarnings("ignore", category=DeprecationWarning)
    doc = HwpxDocument.new()
    doc.paragraphs[0].add_run(GUIDE[0], char_pr_id_ref=doc.ensure_run_style(bold=True, size=14))
    for t in GUIDE[1:]:
        doc.add_paragraph(t)
    with open(path("05_지침", "2026년_법정의무교육_운영지침.hwpx"), "wb") as f:
        f.write(doc.to_bytes())


# ───────────── 외부(위탁)교육 실적
EXTERNAL = [
    # (교육명, 교육기관, 일수, 시간, 교육비, 지역, 숙박, 숙박 제공)
    ("공기업 중간관리자 리더십 과정", "가상공기업연수원", 3, 21, 350000, "세종", "Y", "N"),
    ("공공기관 계약실무 전문과정", "가상회계연수원", 2, 14, 280000, "서울", "Y", "N"),
    ("체육시설 안전관리자 양성과정", "가상안전보건교육원", 5, 35, 600000, "천안", "Y", "Y"),
    ("공공데이터 분석 실무", "가상인재개발원", 1, 7, 120000, "서울", "N", "N"),
    ("민원응대 전문가 과정", "가상인재개발원", 2, 14, 200000, "대전", "Y", "N"),
    ("환경시설 운영관리 직무과정", "가상환경기술원", 3, 21, 420000, "인천", "Y", "Y"),
]


def external_xlsx(people):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "외부교육"
    ws.append(["2026년 외부(위탁)교육 실적 – 경영지원팀"])
    ws.append(["사번", "성명", "소속", "직급", "교육명", "교육기관", "교육 시작일", "교육 종료일", "교육시간", "교육비", "교육장소", "숙박",
               "숙박 제공", "수료여부", "결과보고 제출일"])
    pool = [p for p in people if not p["퇴사일"] and not p["휴직기간"] and p["입사일"] < dt.date(2026, 6, 1)]
    for title, inst, days, hours, fee, place, stay, provided in EXTERNAL:
        for p in R2.sample(pool, R2.randint(2, 5)):
            st = rand_date("2026-03-02", "2026-09-25", R2)
            en = st + dt.timedelta(days=days - 1)
            roll = R2.random()
            rep = en + dt.timedelta(days=R2.randint(2, 6)) if roll < 0.7 else (en + dt.timedelta(days=R2.randint(10, 20)) if roll < 0.88 else None)
            ws.append([p["사번"], p["성명"], p["소속"], p["직급"], title, inst, st, en, hours, fee, place, stay, provided, "수료", rep])
    # 함정: 한 사람이 위탁교육을 두 번 받아 1인당 지원 한도(100만원)를 넘김
    p = [x for x in pool if x["직무구분"] == "사무"][3]
    for title, inst, st, days, hours, fee in (("공공기관 감사실무 전문과정", "가상감사연수원", dt.date(2026, 4, 13), 3, 21, 650000),
                                             ("공공기관 계약실무 전문과정", "가상회계연수원", dt.date(2026, 8, 24), 2, 14, 480000)):
        en = st + dt.timedelta(days=days - 1)
        ws.append([p["사번"], p["성명"], p["소속"], p["직급"], title, inst, st, en, hours, fee, "서울", "Y", "N", "수료", en + dt.timedelta(days=3)])
    for row in ws.iter_rows(min_row=3, min_col=7, max_col=15):
        for c in row:
            if isinstance(c.value, dt.date):
                c.number_format = "yyyy-mm-dd"
    wb.save(path("02_이수기록", "외부교육", "2026_외부위탁교육_실적.xlsx"))


def budget_xlsx():
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "예산"
    ws.append(["2026년 교육훈련 예산 배정 현황"])
    ws.append(["구분", "예산액(원)", "비고"])
    for r in [["법정의무교육(집합 강사료)", 3000000, ""], ["직무교육(내부 강사료·교재)", 6000000, ""], ["외부(위탁)교육비", 9000000, "1인당 연 100만원 한도"],
              ["교육훈련 여비", 4000000, "여비규정 적용"], ["합계", 22000000, ""]]:
        ws.append(r)
    wb.save(path("06_계획·예산", "2026_교육훈련_예산.xlsx"))


# ───────────── 규정·기준 문서([모의] – 실제 규정·편람과 다름)
def make_hwpx_doc(out, title, items):
    import warnings

    from hwpx import HwpxDocument

    warnings.filterwarnings("ignore", category=DeprecationWarning)
    doc = HwpxDocument.new()
    doc.paragraphs[0].add_run(title, char_pr_id_ref=doc.ensure_run_style(bold=True, size=14))
    for it in items:
        if isinstance(it, str):
            doc.add_paragraph(it)
        else:
            header, rows = it
            t = doc.add_table(len(rows) + 1, len(header))
            for c, hname in enumerate(header):
                t.set_cell_text(0, c, hname)
            for ri, row in enumerate(rows, 1):
                for c, v in enumerate(row):
                    t.set_cell_text(ri, c, str(v))
            doc.add_paragraph("")
    with open(out, "wb") as f:
        f.write(doc.to_bytes())


def regulations():
    note = "※ [모의] 다이수 시연용 가상 문서입니다. 실제 규정·기준과 다릅니다."
    make_hwpx_doc(path("07_규정·기준", "[모의] 가상구시설관리공단 교육훈련규정.hwpx"), "가상구시설관리공단 교육훈련규정", [
        note,
        "제1조(목적) 이 규정은 직원의 교육훈련에 필요한 사항을 정함을 목적으로 한다.",
        "제5조(교육훈련 시간) ① 직원은 연간 60시간 이상 교육훈련을 이수하여야 한다. ② 법정의무교육, 필수교육, 직무교육, 외부(위탁)교육 시간을 모두 합산한다.",
        "제8조(필수교육) 직원은 별표 1의 필수교육을 정해진 시기에 이수하여야 한다.",
        "제12조(위탁교육 결과보고) 외부 위탁교육을 받은 직원은 교육 수료 후 7일 이내에 결과보고서를 제출하여야 한다.",
        "제13조(교육비 지원) 외부 위탁교육비는 1인당 연간 100만원 한도에서 지원한다.",
        "제15조(교육여비) ① 교육훈련 여비는 여비규정에 따른다. ② 교육기관에서 숙박을 제공하는 경우 숙박비는 지급하지 아니한다. ③ 교육기간 중 일비는 2분의 1을 지급한다.",
        "[별표 1] 필수교육 과정",
        (["교육과정", "대상", "시간", "이수 시기"],
         [["신규임용자 기본교육", "신규임용자", "16", "임용 후 3개월 이내"],
          ["승진자 역량향상 과정", "당해연도 승진자", "12", "승진 후 6개월 이내"],
          ["신임 관리자 리더십", "팀장", "8", "연 1회"],
          ["고객응대 CS 실무", "현장직", "4", "연 1회"]]),
    ])
    make_hwpx_doc(path("07_규정·기준", "[모의] 여비규정(별표2 국내여비 지급표).hwpx"), "가상구시설관리공단 여비규정 별표 2 국내여비 지급표", [
        note,
        (["구분", "일비(1일)", "식비(1일)", "숙박비(1박 상한)", "교통비"],
         [["제1호(임원)", "25,000원", "25,000원", "100,000원", "실비"],
          ["제2호(1급~4급)", "25,000원", "25,000원", "80,000원", "실비"],
          ["제3호(5급 이하)", "25,000원", "25,000원", "70,000원", "실비"]]),
        "비고: 교통비는 철도·버스 등 실제 운임을 지급한다.",
    ])
    make_hwpx_doc(path("07_규정·기준", "[모의] 강사수당 지급기준(인재개발원 기준 준용).hwpx"), "강사수당 지급기준(인재개발원 기준 준용)", [
        note,
        (["구분", "대상", "기본(1시간)", "초과(1시간당)"],
         [["특1급", "전·현직 장차관급, 대학 총장", "400,000", "300,000"],
          ["특2급", "전·현직 기관장, 대학교수(정교수)", "300,000", "200,000"],
          ["일반1급", "대학교수, 변호사·노무사 등 전문자격자", "250,000", "150,000"],
          ["일반2급", "그 밖의 외부 전문가", "150,000", "100,000"],
          ["일반3급", "소속 직원(내부 강사)", "100,000", "50,000"]]),
        "원고료는 A4 1매당 13,000원을 지급한다.",
    ])
    make_hwpx_doc(path("07_규정·기준", "[모의] 지방공기업 경영평가 편람(교육훈련 지표 발췌).hwpx"), "지방공기업 경영평가 편람 – 교육훈련 지표(발췌)", [
        note,
        (["세부지표", "산식", "배점"],
         [["1인당 교육훈련시간", "총 교육훈련시간 ÷ 평균 인원", "2"],
          ["법정의무교육 이수율", "법정의무교육 이수 인원 ÷ 대상 인원 × 100", "1"],
          ["필수교육 이수율", "필수교육 이수 인원 ÷ 대상 인원 × 100", "1"],
          ["1인당 교육훈련비", "교육훈련비 집행액 ÷ 평균 인원", "1"],
          ["교육훈련 만족도", "교육 만족도 조사 평균(5점 척도)", "1"],
          ["교육훈련 예산 집행률", "교육훈련비 집행액 ÷ 교육훈련 예산 × 100", "1"]]),
        "증빙: 교육 실적 대장, 이수증·서명부, 예산 집행 내역, 만족도 조사 결과",
    ])
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
    c = canvas.Canvas(path("07_규정·기준", "[모의] 행정안전부 지방공기업 교육훈련 운영 계획(발췌).pdf"))
    y = 780
    for t, size in [("[모의] 지방공기업 임직원 교육훈련 운영 계획(발췌)", 15), (note, 9), ("", 10),
                    ("1. 추진 목표", 12), ("  가. 임직원 1인당 연간 80시간 이상 교육훈련 권장", 11),
                    ("  나. 청렴교육은 연 2시간 이상 실시하고 실적을 관리", 11), ("2. 중점 과제", 12),
                    ("  가. 디지털·AI 활용 역량교육 확대", 11), ("  나. 현장 근무자 맞춤형 안전교육 강화", 11),
                    ("  다. 교육 성과(만족도·현업 적용도) 측정 및 환류", 11), ("3. 실적 관리", 12),
                    ("  가. 기관별 교육훈련 실적을 다음 해 1월 말까지 정리하여 경영평가에 활용", 11)]:
        c.setFont("HYGothic-Medium", size)
        c.drawString(50, y, t)
        y -= size + 12
    c.save()


def main():
    if os.path.isdir(ROOT):
        shutil.rmtree(ROOT)
    people = make_people()
    roster_xlsx(people)
    cyber_xlsx(people)
    safety_signsheets(people)
    disability_docx(people)
    certificates(people)
    shift_xlsx(people)
    survey_xlsx()
    guide_hwpx()
    external_xlsx(people)
    budget_xlsx()
    regulations()
    n = sum(len(f) for _, _, f in os.walk(ROOT))
    print(f"모의자료 {n}개 생성: {ROOT}")


if __name__ == "__main__":
    main()
