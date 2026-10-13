"""다이수 테스트: python -m unittest discover -s tests"""
from __future__ import annotations

import datetime as dt
import glob
import io
import math
import os
import shutil
import sys
import tempfile
import urllib.parse
import time
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DAISU_WORKSPACE", tempfile.mkdtemp(prefix="daisu_test_"))

from daisu import config, engine, qa, reports, schedule  # noqa: E402
from daisu.readers import read  # noqa: E402
from daisu.render import FORMATS  # noqa: E402
from daisu.sources import doc_kinds  # noqa: E402

BASE = config.SAMPLE


def _bytes(p):
    with open(p, "rb") as f:
        return f.read()


def sample_project(overrides=None, base="2026-10-12"):
    files = [engine.file_entry(p, os.path.relpath(p, BASE)) for p in sorted(glob.glob(BASE + "/**/*.*", recursive=True))]
    return {"id": "test0000", "files": files, "base_date": base, "overrides": overrides or {"person": {}, "course": {}}}


class TestReading(unittest.TestCase):
    def test_kinds(self):
        kinds = {}
        for p in glob.glob(BASE + "/**/*.*", recursive=True):
            kinds[os.path.relpath(p, BASE)] = doc_kinds(read(p))
        got = sorted(k for ks in kinds.values() for k in ks)
        self.assertEqual(got.count("roster"), 1)
        self.assertEqual(got.count("records"), 2)  # 사이버·직무교육 이수현황, 외부(위탁)교육 실적
        self.assertEqual(got.count("sign"), 3)  # 한글·엑셀·워드 서명부
        self.assertEqual(got.count("cert"), 3)
        self.assertEqual(got.count("shift"), 1)
        self.assertEqual(got.count("survey"), 1)
        self.assertEqual(got.count("guide"), 6)  # 운영지침 + [모의] 규정·기준 5종
        self.assertEqual(got.count("budget"), 1)


class TestEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = engine.compute(sample_project())
        cls.sm = {s["key"]: s for s in cls.res["summary"]}
        cls.by_name = {}
        for p in cls.res["people"]:
            cls.by_name.setdefault(p["name"], []).append(p)

    def cell(self, pid, key):
        return self.res["cells"][pid][key]

    def test_planted_findings(self):
        self.assertEqual(self.sm["sr@H1"]["overdue"], 12)   # 상반기 현장 안전교육: 한 회차만 듣거나 불참
        self.assertEqual(self.sm["sr@H1"]["partial"], 7)
        self.assertEqual(self.sm["hire"]["overdue"], 1)     # 10/5 입사자 채용 시 교육 없음
        types = sorted(i["type"] for i in self.res["issues"])
        self.assertEqual(types, ["ambiguous", "course", "unknown"])
        unk = next(i for i in self.res["issues"] if i["type"] == "unknown")
        self.assertEqual(unk["candidates"][0]["name"], "이영희")  # 오타 후보 제시

    def test_combined_course_split(self):
        """4대폭력 통합 4시간 → 성희롱·성매매·성폭력·가정폭력 각 1시간으로 인정."""
        rec = next(r for r in self.res["records"] if "통합" in r["title"] and r["done"] and r["pid"])
        for k in ("sh", "pr", "sv", "dv"):
            c = self.cell(rec["pid"], k)
            self.assertEqual(c["s"], "done")
            self.assertIn(rec["rid"], c["recs"])
            self.assertAlmostEqual(c["h"], 1.0)

    def test_partial_hours(self):
        short = [r for r in self.res["records"] if r["title"].startswith("청렴 첫걸음")]
        self.assertTrue(short)
        c = self.cell(short[0]["pid"], "int")
        self.assertEqual((c["s"], c["h"], c["need"]), ("partial", 1.0, 2))

    def test_job_hours_and_supervisor(self):
        field = next(p for p in self.res["people"] if p["job"] == "현장" and not p["flags"]["관리감독자"])
        office = next(p for p in self.res["people"] if p["job"] == "사무")
        self.assertEqual(self.cell(field["id"], "sr@H2")["need"], 12)
        self.assertEqual(self.cell(office["id"], "sr@H2")["need"], 6)
        sup = [p for p in self.res["people"] if p["flags"]["관리감독자"]]
        self.assertEqual(len(sup), 9)
        for p in sup:
            self.assertEqual(self.cell(p["id"], "sr@H2")["s"], "na")  # 관리감독자는 별도 과정
        certs = [r for r in self.res["records"] if r["kind"] == "cert"]
        self.assertTrue(all(r["pid"] and r["rules"] == ["sup"] for r in certs))
        for r in certs:
            self.assertEqual(self.cell(r["pid"], "sup")["s"], "done")

    def test_leave_left_flags(self):
        leave = next(p for p in self.res["people"] if p.get("leave") and p["leave"][0] == "2026-03-01")
        self.assertEqual(self.cell(leave["id"], "int")["s"], "leave")
        left = next(p for p in self.res["people"] if p.get("left"))
        self.assertTrue(all(c["s"] == "left" for c in self.res["cells"][left["id"]].values()))
        nonpi = next(p for p in self.res["people"] if not p["flags"]["개인정보취급자"])
        self.assertEqual(self.cell(nonpi["id"], "pi")["s"], "na")

    def test_unsigned_not_credited(self):
        unsigned = [r for r in self.res["records"] if r["kind"] == "sign" and not r["done"]]
        self.assertTrue(unsigned)
        for r in unsigned:
            for key, c in self.res["cells"].get(r["pid"], {}).items():
                self.assertNotIn(r["rid"], c["recs"])

    def test_overrides(self):
        amb = next(i for i in self.res["issues"] if i["type"] == "ambiguous")
        target = amb["candidates"][0]["id"]
        before = self.cell(target, "sr@H1")["h"]
        course = next(i for i in self.res["issues"] if i["type"] == "course")
        res2 = engine.compute(sample_project({"person": {amb["key"]: target}, "course": {course["key"]: []}}))
        self.assertEqual(res2["cells"][target]["sr@H1"]["h"], before + 4)
        self.assertEqual([i["type"] for i in res2["issues"]], ["unknown"])

    def test_base_date_changes_overdue(self):
        before = {s["key"]: s for s in engine.compute(sample_project(base="2026-06-29"))["summary"]}
        after = {s["key"]: s for s in engine.compute(sample_project(base="2026-07-01"))["summary"]}
        self.assertEqual(before["sr@H1"]["overdue"], 0)  # 상반기 기한(6/30) 전에는 지남 아님
        self.assertEqual(after["sr@H1"]["overdue"], 12)  # 지나면 기한 지남
        prj = sample_project(base="2027-01-20")
        self.assertEqual(engine.compute(prj)["summary"][0]["done"], 0)  # 새해에는 새 연도 기준(지난해 기록 미인정)
        prj["year"] = 2026
        last = {s["key"]: s for s in engine.compute(prj)["summary"]}
        self.assertEqual(last["sh"]["done"], 107)  # 판정 연도를 2026으로 두면 지난해 실적 그대로
        self.assertEqual(last["sh"]["overdue"], last["sh"]["none"])  # 못 마친 사람은 모두 기한 지남


class TestSchedule(unittest.TestCase):
    def test_constraints(self):
        res = engine.compute(sample_project())
        st = config.settings()["schedule"]
        idx, days = schedule._shift_index(res["shifts"], res["people"])
        people = {p["id"]: p for p in res["people"]}
        for key in ("sr@H2", "dis", "int"):
            pl = schedule.plan(res, key)
            self.assertTrue(pl["sessions"])
            seen = {}
            for s in pl["sessions"]:
                d = dt.date.fromisoformat(s["date"])
                self.assertLess(d.weekday(), 5)
                self.assertNotIn(s["date"], st["holidays"])
                self.assertLessEqual(s["count"], st["room_capacity"])
                for a in s["people"]:
                    p = people[a["id"]]
                    if p["shift"] == "교대":
                        self.assertIn(idx[p["id"]][s["date"]], st["day_shift_codes"])  # 비번·휴무·야간일 배정 없음
                    self.assertNotIn((a["id"], s["date"]), seen)  # 하루 한 회차
                    seen[(a["id"], s["date"])] = 1
                for dept, n in s["by_dept"].items():
                    on = sum(1 for p in people.values() if p["dept"] == dept and not p.get("left") and
                             (p["shift"] != "교대" or idx.get(p["id"], {}).get(s["date"]) in st["day_shift_codes"]))
                    self.assertLessEqual(n, max(1, math.floor(on * (1 - st["min_on_duty_ratio"]))))
            if key == "dis":
                self.assertFalse(pl["unplaced"])
                self.assertGreater(pl["naive"]["absent"], 0)


class TestReports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = engine.compute(sample_project())
        cls.org = config.settings()["org"]

    def test_documents_roundtrip(self):
        pl = schedule.plan(self.res, "dis")
        sign = next(s for s in self.res["signs"] if "2회차" in s["title"])
        d = tempfile.mkdtemp()
        for name, blocks, must in (("status", reports.status_blocks(self.res, self.org, pl), "교육별 이수 현황"),
                                   ("result", reports.result_blocks(self.res, self.org, sign), "만족도"),
                                   ("plan", reports.plan_blocks(self.res, self.org, pl), "회차")):
            for fmt, (fn, _) in FORMATS.items():
                path = os.path.join(d, f"{name}.{fmt}")
                with open(path, "wb") as f:
                    f.write(fn(blocks))
                if fmt in ("hwpx", "docx"):
                    doc = read(path)
                    text = " ".join(t for t, _ in doc.texts) + " ".join(" ".join(" ".join(r) for r in t.rows) for t in doc.tables)
                    self.assertIn(must, text, (name, fmt))
        shutil.rmtree(d)

    def test_survey_and_improvements(self):
        sign = next(s for s in self.res["signs"] if "2회차" in s["title"])
        sv = reports.survey_summary(reports.survey_for(self.res, sign["title"] + " " + sign["context"]))
        self.assertEqual(sv["n"], 46)
        self.assertIn("시간", sv["lowest"]["item"])
        imp = reports.improvements(sv)
        self.assertTrue(any("4시간 이내" in x for x in imp))
        first = next(s for s in self.res["signs"] if "1회차" in s["title"])
        self.assertEqual(reports.survey_for(self.res, first["title"] + " " + first["context"]), [])  # 다른 회차 응답 섞지 않음
        dis = next(s for s in self.res["signs"] if "장애인" in s["title"])
        imp = reports.improvements(reports.survey_summary(reports.survey_for(self.res, dis["title"])))
        self.assertFalse(any("4시간 이내" in x for x in imp))  # “짧고 좋았다”는 불만이 아님

    def test_reminders_excel_evidence(self):
        msgs = reports.reminders(self.res, self.org)
        over = [m for m in msgs if m["overdue"]]
        self.assertEqual(len(over), 15)  # 법정 13명 + 필수(승진자 과정) 2명
        self.assertIn("기한이 지났습니다", over[0]["text"])
        self.assertIn("(목)", next(m for m in msgs if not m["overdue"])["text"])  # 2026-12-31은 목요일
        wb = reports.excel(self.res)
        from openpyxl import load_workbook
        self.assertEqual(load_workbook(io.BytesIO(wb)).sheetnames, ["교육별 요약", "이수현황", "미이수자", "판정 근거", "확인 필요"])
        files = {f["rel"]: f["path"] for f in sample_project()["files"]}
        z = zipfile.ZipFile(io.BytesIO(reports.evidence_zip(self.res, files)))
        names = z.namelist()
        self.assertIn("00_증빙목록.xlsx", names)
        self.assertTrue(any("수료증_" in n and "관리감독자" in n for n in names))


class TestQA(unittest.TestCase):
    def test_answers(self):
        res = engine.compute(sample_project())
        a = qa.ask(res, "김민수 뭐 남았어?")
        self.assertEqual(a["mode"], "person")
        self.assertIn("같은 이름이 여러 명", a["answer"])
        a = qa.ask(res, "기간제도 청렴교육 대상이야?")
        self.assertIn("기간제 근로자를 포함한 전 직원", a["answer"])
        self.assertIn("제81조의2", a["answer"])
        self.assertEqual(qa.ask(res, "체육시설팀 미이수자")["mode"], "dept")
        self.assertEqual(qa.ask(res, "급한 거 알려줘")["mode"], "due")
        self.assertEqual(qa.ask(res, "주차 등록 방법")["mode"], "none")  # 근거 없으면 모른다고


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from daisu.server import app
        cls.c = TestClient(app)

    def test_security(self):
        c = self.c
        self.assertEqual(c.post("/api/settings", headers={"Origin": "https://evil.example", "Content-Type": "application/json"}, content="{}").status_code, 403)
        self.assertEqual(c.post("/api/settings", headers={"Content-Type": "text/plain"}, content='{"org":{"name":"X"}}').status_code, 415)
        self.assertEqual(c.get("/api/info", headers={"Host": "evil.example"}).status_code, 403)
        self.assertEqual(c.post("/api/projects/sample", headers={"Origin": "null"}).status_code, 403)
        s = c.get("/api/settings").json()
        self.assertTrue(all("api_key" not in v for v in s["profiles"].values()))
        self.assertEqual(c.get("/api/projects/../../etc").status_code, 404)

    def test_flow(self):
        c = self.c
        pid = c.post("/api/projects/sample").json()["id"]
        d = c.get(f"/api/projects/{pid}").json()
        self.assertTrue(d["integrity"])
        self.assertEqual(len(d["issues"]), 3)
        amb = next(i for i in d["issues"] if i["type"] == "ambiguous")
        self.assertEqual(c.post(f"/api/projects/{pid}/resolve", json={"type": "person", "key": amb["key"], "value": "없는사람"}).status_code, 400)
        c.post(f"/api/projects/{pid}/resolve", json={"type": "person", "key": amb["key"], "value": amb["candidates"][1]["id"]})
        self.assertEqual(len(c.get(f"/api/projects/{pid}").json()["issues"]), 2)
        c.delete(f"/api/projects/{pid}/resolve", params={"type": "person", "key": amb["key"]})
        self.assertEqual(len(c.get(f"/api/projects/{pid}").json()["issues"]), 3)
        self.assertEqual(c.patch(f"/api/projects/{pid}", json={"base_date": "2026-02-30"}).status_code, 400)
        self.assertEqual(c.get(f"/api/projects/{pid}/plan", params={"col": "없음"}).status_code, 400)
        for q in ("doc=status&fmt=hwpx&col=sr@H2", "doc=result&fmt=docx&sign=0", "doc=plan&fmt=md&col=int", "doc=excel",
                  "doc=evidence", "doc=reminders&within=30"):
            r = c.get(f"/api/projects/{pid}/export?{q}")
            self.assertEqual(r.status_code, 200, q)
            self.assertGreater(len(r.content), 500, q)
        self.assertEqual(c.get(f"/api/projects/{pid}/export?doc=result&sign=99").status_code, 400)
        self.assertEqual(c.post(f"/api/projects/{pid}/ask", json={"q": ""}).status_code, 400)
        self.assertEqual(len(c.get(f"/api/projects/{pid}/survey").json()), 3)
        rec = c.get(f"/api/projects/{pid}/records", params={"person": d["people"][0]["id"]}).json()
        self.assertTrue(rec and all("file" in r for r in rec))
        c.delete(f"/api/projects/{pid}")

    def test_upload_filters_and_path(self):
        c = self.c
        roster = glob.glob(BASE + "/01_인사/*.xlsx")[0]
        cyber = glob.glob(BASE + "/02_이수기록/*.xlsx")[0]
        files = [("files", ("01_인사/명단.xlsx", _bytes(roster), "application/octet-stream")),
                 ("files", ("02/이수.xlsx", _bytes(cyber), "application/octet-stream")),
                 ("files", ("사진.jpg", b"\xff\xd8\xff", "image/jpeg")),
                 ("files", ("../../escape.xlsx", _bytes(cyber), "application/octet-stream"))]
        r = c.post("/api/projects/upload", files=files, data={"name": "업로드", "base_date": "2026-10-12"})
        self.assertEqual(r.status_code, 200)
        pid = r.json()["id"]
        d = c.get(f"/api/projects/{pid}").json()
        self.assertEqual(sorted(f["rel"] for f in d["files"]), ["01_인사/명단.xlsx", "02/이수.xlsx", "escape.xlsx"])
        self.assertEqual(len(d["people"]), 120)
        self.assertEqual(c.post("/api/projects/upload", files=[("files", ("a.jpg", b"x", "image/jpeg"))]).status_code, 400)
        r = c.post("/api/projects/path", json={"path": BASE})
        self.assertEqual(len(c.get(f"/api/projects/{r.json()['id']}").json()["files"]), 18)
        self.assertEqual(c.post("/api/projects/path", json={"path": "/없는/폴더"}).status_code, 400)

    def test_rules_edit(self):
        c = self.c
        try:
            rules = c.get("/api/rules").json()
            bad = dict(rules, courses=[dict(rules["courses"][0], hours=-1)])
            self.assertEqual(c.put("/api/rules", json=bad).status_code, 400)
            dup = dict(rules, courses=rules["courses"] + [rules["courses"][0]])
            self.assertEqual(c.put("/api/rules", json=dup).status_code, 400)
            changed = dict(rules, courses=[dict(x, hours=3) if x["id"] == "int" else x for x in rules["courses"]])
            self.assertEqual(c.put("/api/rules", json=changed).status_code, 200)
            res = engine.compute(sample_project())
            self.assertTrue(all(row["int"]["need"] in (0, 3) for row in res["cells"].values()))
        finally:
            c.post("/api/rules/reset")
        self.assertFalse(os.path.exists(os.path.join(config.CONFIG, "rules.local.json")))


class TestWorkGantt(unittest.TestCase):
    """업무 분석 → 간트(업무별·기간별) → 막대별 체크리스트."""

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from daisu.server import app
        cls.c = TestClient(app)
        cls.pid = cls.c.post("/api/projects/sample").json()["id"]

    def test_items(self):
        w = self.c.get(f"/api/projects/{self.pid}/work").json()
        lanes = {i["lane"] for i in w["items"]}
        for l in ("계획·예산", "법정교육", "필수교육", "안내·독려", "집합교육 운영", "외부(위탁)교육", "보고·평가"):
            self.assertIn(l, lanes)
        for i in w["items"]:
            self.assertLessEqual(i["start"], i["end"])
            self.assertIn(i["status"], w["status"])
        up = next(i for i in w["items"] if i["title"] == "산업안전보건 정기교육(상반기)")
        self.assertEqual(up["status"], "late")  # 기한(6/30) 지난 미이수자 있음
        self.assertEqual((up["start"], up["end"]), ("2026-01-01", "2026-06-30"))
        self.assertTrue(any(i["status"] == "done" for i in w["items"] if i["lane"] == "외부(위탁)교육"))
        self.assertNotIn("ctx", w["items"][0])

    def test_checklist(self):
        c, pid = self.c, self.pid
        w = c.get(f"/api/projects/{pid}/work").json()
        for it in w["items"]:  # 모든 업무 종류에서 체크리스트가 만들어짐
            r = c.post(f"/api/projects/{pid}/work/{it['id']}/checklist")
            self.assertEqual(r.status_code, 200, it["id"])
            self.assertGreaterEqual(len(r.json()["items"]), 3)
        iid = next(i["id"] for i in w["items"] if i["kind"] == "course")
        r = c.get(f"/api/projects/{pid}/work/{iid}/checklist").json()
        self.assertTrue(r["items"][0]["auto_ok"])  # 대상자 명단은 자료로 확인
        r = c.patch(f"/api/projects/{pid}/work/{iid}/checklist", json={"toggle": "t2"}).json()
        self.assertTrue(r["items"][1]["done"])
        r = c.patch(f"/api/projects/{pid}/work/{iid}/checklist", json={"add": "교육장 냉방 점검"}).json()
        uid = r["items"][-1]["id"]
        self.assertTrue(r["items"][-1]["mine"])
        r = c.patch(f"/api/projects/{pid}/work/{iid}/checklist", json={"remove": uid}).json()
        self.assertNotIn(uid, [x["id"] for x in r["items"]])
        it = next(i for i in c.get(f"/api/projects/{pid}/work").json()["items"] if i["id"] == iid)
        self.assertEqual(it["check"]["done"], 2)
        self.assertEqual(c.patch(f"/api/projects/{pid}/work/{iid}/checklist", json={"add": " "}).status_code, 400)

    def test_dates_custom_export(self):
        c, pid = self.c, self.pid
        iid = "plan:annual"
        self.assertEqual(c.patch(f"/api/projects/{pid}/work/{iid}", json={"start": "2026-02-01", "end": "2026-01-01"}).status_code, 400)
        self.assertEqual(c.patch(f"/api/projects/{pid}/work/{iid}", json={"start": "2026-02-30", "end": "2026-03-01"}).status_code, 400)
        c.patch(f"/api/projects/{pid}/work/{iid}", json={"start": "2026-02-01", "end": "2026-02-28"})
        it = next(i for i in c.get(f"/api/projects/{pid}/work").json()["items"] if i["id"] == iid)
        self.assertEqual((it["start"], it["moved"]), ("2026-02-01", True))
        new = c.post(f"/api/projects/{pid}/work", json={"title": "강사 풀 구축", "start": "2026-03-01", "end": "2026-04-30"}).json()["id"]
        c.post(f"/api/projects/{pid}/work/{new}/checklist")
        for t in ("t1", "t2", "t3", "t4"):
            c.patch(f"/api/projects/{pid}/work/{new}/checklist", json={"toggle": t})
        it = next(i for i in c.get(f"/api/projects/{pid}/work").json()["items"] if i["id"] == new)
        self.assertEqual((it["status"], it["progress"]), ("done", 100))
        self.assertEqual(c.delete(f"/api/projects/{pid}/work/plan:annual").status_code, 400)
        self.assertEqual(c.delete(f"/api/projects/{pid}/work/{new}").status_code, 200)
        x = c.get(f"/api/projects/{pid}/export?doc=gantt")
        self.assertEqual(x.status_code, 200)
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(x.content))
        self.assertEqual(wb.sheetnames, ["업무 일정", "체크리스트"])
        self.assertGreater(wb["체크리스트"].max_row, 2)


if __name__ == "__main__":
    unittest.main()


PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


class TestOperations(unittest.TestCase):
    def test_fees(self):
        from daisu import fees
        cfg = config.settings()["fees"]
        r = fees.compute({"grade": "일반1", "income": "기타소득"}, 1, cfg)
        self.assertEqual((r["total"], r["withholding"], r["net"]), (250000, 22000, 228000))  # 실효 8.8%
        r = fees.compute({"grade": "일반2", "income": "기타소득"}, 1, cfg)
        self.assertEqual(r["withholding"], 13200)
        r = fees.compute({"grade": "내부", "income": "기타소득"}, 1, cfg)
        self.assertEqual(r["withholding"], 0)  # 10만원: 기타소득금액 4만원 ≤ 5만원 과세최저한
        r = fees.compute({"grade": "일반2", "income": "사업소득", "pages": 5, "travel": 30000}, 4, cfg)
        self.assertEqual((r["lecture"], r["income_tax"], r["local_tax"], r["total"]), (515000, 15450, 1540, 545000))

    def test_gongmun_numbering(self):
        from daisu import gongmun
        b = gongmun.blocks({"name": "기관"}, "제목", ["가", ["나", "다", ["라"]], "마"], ["붙임1 1부.", "붙임2 1부."])
        text = [x[1] for x in b if x[0] == "p"]
        self.assertIn("제목  제목", text)
        self.assertIn("  가. 나", text)
        self.assertIn("    1) 라", text)
        self.assertIn("2. 마", text)
        self.assertTrue(any(t.endswith("붙임2 1부.  끝.") for t in text))
        b = gongmun.blocks({"name": "기관"}, "제목", ["하나"])
        self.assertIn("1. 하나  끝.", [x[1] for x in b if x[0] == "p"])

    def test_josa(self):
        from daisu.util import josa
        self.assertEqual(josa("「청렴교육」"), "「청렴교육」을")
        self.assertEqual(josa("「교육 1회차」"), "「교육 1회차」를")

    def test_planning(self):
        from daisu import planning
        prj = sample_project()
        res = engine.compute(prj)
        st = planning.stats(prj, res, config.settings()["fees"])
        self.assertEqual(st["people"], 119)
        self.assertGreater(st["avg_hours"], 5)
        tasks = planning.tasks(prj, res, {"first_days": 30, "boss_days": 14})
        titles = " ".join(t["title"] for t in tasks)
        self.assertIn("확인 필요 3건", titles)
        self.assertIn("기한(6. 30.(화)) 지난", titles)
        self.assertIn("채용 시 교육", titles)
        md = __import__("daisu.render", fromlist=["to_md"]).to_md(planning.next_plan_blocks(prj, res, config.settings()["org"], config.settings()["fees"])).decode()
        self.assertIn("2027년 법정의무교육 운영 계획(안)", md)
        self.assertIn("기한 지난 미이수 12명", md)
        self.assertIn("4시간 이내", md)        # 만족도 의견 반영
        self.assertNotIn("하반기): 현장직 이수율", md)  # 진행 중인 반기는 문제로 잡지 않음
        card = planning.card_blocks(res, res["people"][0]["id"], config.settings()["org"])
        self.assertEqual(card[0][0], "title")


class TestSessionFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from daisu.server import app
        cls.c = TestClient(app)

    def test_flow(self):
        c = self.c
        pid = c.post("/api/projects/sample").json()["id"]
        ids = c.post(f"/api/projects/{pid}/sessions", json={"col": "dis", "place": "대회의실"}).json()["ids"]
        self.assertGreaterEqual(len(ids), 2)
        sid = ids[0]
        s = c.get(f"/api/projects/{pid}/sessions/{sid}").json()
        person = s["targets"][0]["id"]
        before = c.get(f"/api/projects/{pid}").json()["cells"][person]["dis"]["s"]
        self.assertIn(before, ("none", "partial"))
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions/{sid}/attend", json={"person": person, "sign": "data:image/png;base64,AAAA"}).status_code, 400)
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions/{sid}/attend", json={"person": person}).status_code, 400)
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions/{sid}/attend", json={"person": "없음", "sign": PNG}).status_code, 400)
        self.assertTrue(c.post(f"/api/projects/{pid}/sessions/{sid}/attend", json={"person": person, "sign": PNG}).json()["ok"])
        self.assertTrue(c.post(f"/api/projects/{pid}/sessions/{sid}/attend", json={"person": person, "sign": PNG}).json()["already"])
        d = c.get(f"/api/projects/{pid}").json()
        self.assertEqual(d["cells"][person]["dis"]["s"], "done")  # 전자 서명 → 바로 이수
        scores = {k: 4 for k in __import__("daisu.sessions", fromlist=["SURVEY_ITEMS"]).SURVEY_ITEMS}
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions/{sid}/survey", json={"scores": {"x": 9}}).status_code, 400)
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions/{sid}/survey", json={"scores": scores, "comment": "좋음"}).json()["n"], 1)
        self.assertEqual(c.patch(f"/api/projects/{pid}/sessions/{sid}", json={"instructor": {"grade": "없는등급"}}).status_code, 400)
        self.assertEqual(c.get(f"/api/projects/{pid}/export?doc=session_fee&fmt=hwpx&session={sid}").status_code, 400)  # 강사 없음
        c.patch(f"/api/projects/{pid}/sessions/{sid}", json={"instructor": {"name": "박강사", "org": "가상기관", "grade": "일반2급"}, "start": "10:00"})
        v = c.get(f"/api/projects/{pid}/sessions/{sid}").json()
        self.assertEqual(v["fee"]["net"], 136800)
        tasks = {t["key"]: t for t in c.get(f"/api/projects/{pid}/tasks").json()}
        self.assertFalse(tasks[f"plan:{sid}"]["done"])
        for doc, fmt in (("session_plan", "hwpx"), ("signsheet", "docx"), ("signsheet", "hwpx"), ("session_result", "hwpx"), ("session_fee", "docx")):
            r = c.get(f"/api/projects/{pid}/export?doc={doc}&fmt={fmt}&session={sid}")
            self.assertEqual(r.status_code, 200, doc)
        tasks = {t["key"]: t for t in c.get(f"/api/projects/{pid}/tasks").json()}
        self.assertTrue(tasks[f"plan:{sid}"]["done"] and tasks[f"result:{sid}"]["done"] and tasks[f"run:{sid}"]["done"])  # 자동 완료
        self.assertTrue(c.post(f"/api/projects/{pid}/tasks/issues").json()["done"])
        for q in ("doc=nextplan&fmt=hwpx", "doc=stats", f"doc=card&fmt=docx&person={person}"):
            self.assertEqual(c.get(f"/api/projects/{pid}/export?{q}").status_code, 200, q)
        st = c.get(f"/api/projects/{pid}/stats").json()
        self.assertEqual(st["spend"], 150000)
        c.delete(f"/api/projects/{pid}/sessions/{sid}/attend/{person}")
        self.assertNotEqual(c.get(f"/api/projects/{pid}").json()["cells"][person]["dis"]["s"], "done")
        c.delete(f"/api/projects/{pid}/sessions/{sid}")
        self.assertEqual(c.get(f"/api/projects/{pid}/sessions/{sid}").status_code, 404)
        self.assertEqual(c.post(f"/api/projects/{pid}/sessions", json={"manual": True, "col": "int", "date": "2026-11-20"}).status_code, 200)


class TestLawAPI(unittest.TestCase):
    """국가법령정보 DRF 연동: 네트워크 대신 urlopen 을 바꿔 끼워 응답 해석·저장본·개정 감지를 시험(형식 시험용 데이터)."""

    def setUp(self):
        import json as _json
        import urllib.request

        from daisu import lawapi
        self.lawapi = lawapi
        self.json = _json
        self._orig = urllib.request.urlopen
        self.calls = []
        self.effective = "20250101"
        self.fail = False
        self.html = False
        for f in ("law_cache.json", "law_status.json"):
            p = os.path.join(config.WORKSPACE, f)
            if os.path.exists(p):
                os.remove(p)
        os.environ["LAW_OC"] = "testoc"

        test = self

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout=0):
            url = req.full_url if hasattr(req, "full_url") else req
            test.calls.append(url)
            if test.fail:
                raise urllib.error.URLError("network down")
            if test.html:
                return Resp("<html>등록되지 않은 IP입니다</html>".encode())
            import urllib.parse as up
            q = dict(up.parse_qsl(up.urlparse(url).query))
            if "lawSearch" in url:
                name = q["query"]
                body = {"LawSearch": {"totalCnt": "1", "law": [{"법령명한글": name, "법령일련번호": "999" + str(len(name)), "법령ID": "001",
                                                                 "시행일자": test.effective, "공포일자": "20241201", "현행연혁코드": "현행"}]}}
            else:
                body = {"법령": {"기본정보": {"법령명_한글": "x", "시행일자": test.effective, "공포일자": "20241201"},
                                "조문": {"조문단위": [
                                    {"조문번호": "29", "조문가지번호": "", "조문여부": "조문", "조문제목": "근로자에 대한 안전보건교육",
                                     "조문내용": "제29조(근로자에 대한 안전보건교육)", "항": [{"항번호": "①", "항내용": "① 사업주는 정기적으로 안전보건교육을 하여야 한다.",
                                                                                     "호": [{"호내용": "1. 예시 호"}]}]},
                                    {"조문번호": "81", "조문가지번호": "2", "조문여부": "조문", "조문제목": "공직자 부패방지 교육",
                                     "조문내용": "제81조의2(교육) 공직자는 매년 2시간 이상 교육을 받아야 한다."},
                                    {"조문번호": "13", "조문가지번호": "", "조문여부": "조문", "조문제목": "직장 내 성희롱 예방 교육", "조문내용": "제13조 예시"},
                                ]}}}
            return Resp(test.json.dumps(body, ensure_ascii=False).encode())

        urllib.request.urlopen = fake

    def tearDown(self):
        import urllib.request
        urllib.request.urlopen = self._orig
        os.environ.pop("LAW_OC", None)

    def test_article_and_cache(self):
        a = self.lawapi.article("산업안전보건법", "29")
        self.assertEqual(a["title"], "근로자에 대한 안전보건교육")
        self.assertIn("정기적으로", a["text"])
        self.assertIn("1. 예시 호", a["text"])
        self.assertEqual(a["effective"], "20250101")
        self.assertIn("OC=testoc", self.calls[0])
        self.assertTrue(self.calls[0].startswith("https://www.law.go.kr/DRF/"))
        b = self.lawapi.article("부패방지 및 국민권익위원회의 설치와 운영에 관한 법률", "81", "2")
        self.assertIn("2시간", b["text"])
        n = len(self.calls)
        self.fail = True  # 인터넷이 끊겨도 저장본으로
        self.assertEqual(self.lawapi.article("산업안전보건법", "29", cache_only=True)["jo"], "29")
        self.assertEqual(len(self.calls), n)
        with self.assertRaises(self.lawapi.LawError):
            self.lawapi.article("개인정보 보호법", "28")  # 저장본 없음 + 네트워크 실패

    def test_errors(self):
        self.html = True
        with self.assertRaises(self.lawapi.LawError) as e:
            self.lawapi.search("산업안전보건법")
        self.assertIn("등록한 IP", str(e.exception))
        os.environ.pop("LAW_OC")
        with self.assertRaises(self.lawapi.LawError) as e:
            self.lawapi.search("청렴")
        self.assertIn("인증키", str(e.exception))

    def test_rules_check_detects_amendment(self):
        rules = {"courses": [c for c in config.rules()["courses"] if c["id"] in ("sr", "int")]}
        st = self.lawapi.check_rules(rules)
        self.assertTrue(all(i["ok"] for i in st["items"]))
        self.assertEqual(st["pending"], [])
        self.effective = "20260601"  # 법령 개정
        st = self.lawapi.check_rules(rules)
        self.assertIn("산업안전보건법 제29조", st["pending"])
        res = engine.compute(sample_project())
        from daisu import planning
        tasks = planning.tasks(sample_project(), res, {})
        self.assertTrue(any(t["title"].startswith("법령 개정 확인 – 산업안전보건법") for t in tasks))
        a = qa.ask(res, "산업안전보건교육 몇 시간 들어야 해?")
        self.assertIn("조문 원문", a["answer"])  # 저장본 조문을 근거로 붙임
        self.assertEqual(self.lawapi.acknowledge()["pending"], [])

    def test_server_hides_key(self):
        from fastapi.testclient import TestClient

        from daisu.server import app
        c = TestClient(app)
        s = c.get("/api/settings").json()
        self.assertTrue(s["law"]["has_oc"])
        self.assertNotIn("testoc", self.json.dumps(s))
        self.assertEqual(c.post("/api/settings", json={"law": {"oc": "bad key!<>"}}).status_code, 400)
        self.assertTrue(c.get("/api/law/check").json()["ok"])
        self.assertEqual(c.get("/api/law/article", params={"name": "산업안전보건법", "jo": "x"}).status_code, 400)
        r = c.get("/api/law/rule/sr", params={"cache_only": False}).json()
        self.assertTrue(r["items"][0]["ok"])


class TestRegulations(unittest.TestCase):
    """규정 문서 해석 → 기준 → 계산 → 보고서."""

    @classmethod
    def setUpClass(cls):
        from daisu import costs, kpi
        cls.prj = sample_project()
        cls.res = engine.compute(cls.prj)
        cls.rg = cls.res["regs"]
        cls.ex = costs.external(cls.res)
        cls.k = kpi.compute(cls.res, cls.prj, cls.ex, config.settings()["fees"])

    def test_extracted_criteria(self):
        rg = self.rg
        self.assertEqual(rg["training"]["annual_hours"]["value"], 60)
        self.assertIn("제5조", rg["training"]["annual_hours"]["src"]["text"])  # 근거 원문
        self.assertEqual(rg["training"]["report_days"]["value"], 7)
        self.assertEqual(rg["training"]["support_limit"]["value"], 1000000)
        self.assertEqual(rg["training"]["daily_ratio"]["value"], 0.5)
        self.assertTrue(rg["travel"]["no_lodging_if_provided"])
        self.assertEqual([(g["label"], g["lodging"]) for g in rg["travel"]["groups"]],
                         [("제1호(임원)", 100000), ("제2호(1급~4급)", 80000), ("제3호(5급 이하)", 70000)])
        self.assertEqual([t["grade"] for t in rg["fee"]["tiers"]], ["특1급", "특2급", "일반1급", "일반2급", "일반3급"])
        self.assertEqual(rg["fee"]["manuscript_per_page"], 13000)
        self.assertEqual(len(rg["kpis"]), 6)
        self.assertEqual(rg["gov"]["rec_hours"]["value"], 80)  # 본문에 '경영평가'가 있어도 정부 계획으로 판별
        self.assertEqual(len(rg["gov"]["priorities"]), 3)
        self.assertEqual(rg["budget"]["total"], 22000000)
        self.assertEqual([r["name"] for r in rg["required"]], ["신규임용자 기본교육", "승진자 역량향상 과정", "신임 관리자 리더십", "고객응대 CS 실무"])

    def test_required_courses_judged(self):
        sm = {s["label"]: s for s in self.res["summary"]}
        self.assertEqual(sm["승진자 역량향상 과정"]["category"], "필수")
        self.assertEqual(sm["승진자 역량향상 과정"]["target"], 6)    # 올해 승진자만
        self.assertEqual(sm["신임 관리자 리더십"]["target"], 6)      # 팀장만
        self.assertEqual(sm["고객응대 CS 실무"]["target"], 82)       # 현장직만
        promo = next(p for p in self.res["people"] if p.get("promoted") == "2026-03-01")
        c = self.res["cells"][promo["id"]][next(x["key"] for x in self.res["columns"] if x["label"] == "승진자 역량향상 과정")]
        self.assertEqual(c["due"], "2026-09-01")  # 승진 후 6개월(달력 기준)

    def test_categories(self):
        cats = {r["category"] for r in self.res["records"]}
        self.assertEqual(cats, {"법정", "필수", "직무", "외부"})
        self.assertTrue(all(r["category"] == "외부" for r in self.res["records"] if r["kind"] == "external"))

    def test_travel_settlement(self):
        row = next(x for x in self.ex["rows"] if x["days"] == 3 and x["grade"] in ("5급", "6급", "7급") and x["nights"] == 2 and not x["stay_provided"])
        # 5급 이하: 일비 25,000×1/2×3일 + 식비 25,000×3일 + 숙박 70,000×2박
        self.assertEqual((row["daily"], row["meal"], row["lodging"], row["travel"]), (37500, 75000, 140000, 252500))
        prov = [x for x in self.ex["rows"] if x["stay_provided"] and x["nights"]]
        self.assertTrue(prov and all(x["lodging"] == 0 for x in prov))  # 숙박 제공 → 숙박비 없음
        self.assertEqual(len(self.ex["missing"]), 2)
        self.assertEqual([o["name"] for o in self.ex["over_limit"]], [self.ex["over_limit"][0]["name"]])
        self.assertGreater(self.ex["over_limit"][0]["cost"], 1000000)

    def test_kpis(self):
        ks = {x["name"]: x for x in self.k["kpis"]}
        self.assertEqual(ks["1인당 교육훈련시간"]["value"], round(self.k["total_hours"] / 119, 1))
        self.assertEqual(ks["교육훈련 예산 집행률"]["value"], round(100 * self.k["spend"]["total"] / 22000000, 1))
        self.assertIn("÷", ks["법정의무교육 이수율"]["basis"])
        self.assertEqual(ks["교육훈련 만족도"]["value"], 4.04)

    def test_reports(self):
        from daisu import annual
        from daisu.render import to_md
        org = config.settings()["org"]
        md = to_md(annual.annual_blocks(self.res, self.k, self.ex, org)).decode()
        for must in ("1. 총괄", "내규 목표", "정부 권장", "분야별 실적", "필수교육(내규 별표)", "외부(위탁)교육", "1인당 지원 한도 초과",
                     "교육훈련비 집행", "경영평가 교육훈련 지표", "정부 중점 과제 대비", "내규 목표(60시간)가 정부 권장(80시간)보다 낮습니다"):
            self.assertIn(must, md)
        self.assertNotIn("올해 관련 과정 없음", md)  # AI·안전 과정을 찾아냄
        kmd = to_md(annual.kpi_blocks(self.res, self.k, org)).decode()
        self.assertIn("편람 근거", kmd)
        cmd = to_md(annual.criteria_blocks(self.res, org)).decode()
        self.assertIn("수료 후 7일 이내", cmd)
        for fn, _ in FORMATS.values():
            fn(annual.annual_blocks(self.res, self.k, self.ex, org))

    def test_no_regulations_fallback(self):
        prj = sample_project()
        prj["files"] = [f for f in prj["files"] if "07_" not in f["rel"] and "06_" not in f["rel"]]
        res = engine.compute(prj)
        self.assertIsNone(res["regs"]["travel"])
        from daisu import costs, kpi
        ex = costs.external(res)
        self.assertIsNone(ex["rows"][0]["travel"])
        k = kpi.compute(res, prj, ex, config.settings()["fees"])
        self.assertEqual([x["name"] for x in k["kpis"]], ["1인당 교육훈련시간", "법정의무교육 이수율"])  # 편람 없으면 기본 지표

    def test_api(self):
        from fastapi.testclient import TestClient

        from daisu.server import app
        c = TestClient(app)
        pid = c.post("/api/projects/sample").json()["id"]
        r = c.get(f"/api/projects/{pid}/regs").json()
        self.assertTrue(r["fee_from_doc"])
        self.assertIn("정부 권장", r["warnings"][0])
        o = c.get(f"/api/projects/{pid}/overview").json()
        self.assertEqual(len(o["per_person"]), 119)
        for q in ("doc=annual&fmt=hwpx", "doc=kpi&fmt=docx", "doc=criteria&fmt=hwpx", "doc=settle", "doc=stats"):
            self.assertEqual(c.get(f"/api/projects/{pid}/export?{q}").status_code, 200, q)
        sid = c.post(f"/api/projects/{pid}/sessions", json={"col": "dis"}).json()["ids"][0]
        self.assertEqual(c.patch(f"/api/projects/{pid}/sessions/{sid}", json={"instructor": {"name": "a", "grade": "일반1"}}).status_code, 400)
        self.assertEqual(c.patch(f"/api/projects/{pid}/sessions/{sid}", json={"instructor": {"name": "a", "grade": "일반1급"}}).status_code, 200)


class TestAdversarialFixes(unittest.TestCase):
    """적대적 검증에서 재현된 문제의 회귀 테스트."""

    @staticmethod
    def person(id_, name, **kw):
        d = {"id": id_, "name": name, "dept": "총무팀", "title": "주임", "grade": "6급", "emp": "정규", "job": "사무", "promoted": None,
             "shift": "일근", "team": "", "hired": "2020-01-01", "left": None, "leave": None,
             "flags": {"개인정보취급자": False, "관리감독자": False}, "src": {"file": "x", "where": "y"}}
        d.update(kw)
        return d

    @staticmethod
    def rec(name, title, date, hours, **kw):
        d = {"kind": "cyber", "title": title, "date": date, "hours": hours, "done": True, "name": name, "emp_id": "", "dept": "",
             "file": "f.xlsx", "where": f"{title}{date}{name}{kw.get('file', '')}", "note": ""}
        d.update(kw)
        return d

    def run_engine(self, people, records, base="2026-10-13", year=None, reg=None):
        from unittest import mock
        parsed = {"kinds": ["roster"], "note": "", "people": people, "records": records, "signs": [], "shifts": [], "survey": [],
                  "texts": [], "reg": reg}
        proj = {"files": [{"path": "x", "rel": "x", "sha": "s"}], "base_date": base, "overrides": {}, "sessions": []}
        if year:
            proj["year"] = year
        with mock.patch.object(engine, "parse_file", lambda *a, **k: parsed):
            return engine.compute(proj)

    def test_progress_and_hours_cells(self):
        from daisu import sources
        from daisu.readers import Table
        t = Table([["성명", "과정명", "학습시간", "이수일", "진도율"], ["박영희", "청렴교육", "1:30", "2026-03-01", "80%"],
                   ["김철수", "청렴교육", "2시간", "2026-03-01", "100"]], "표1", [])
        r = {x["name"]: x for x in sources.parse_records(t, "f")}
        self.assertEqual((r["박영희"]["done"], r["박영희"]["hours"]), (False, 1.5))
        self.assertEqual((r["김철수"]["done"], r["김철수"]["hours"]), (True, 2.0))
        t2 = Table([["성명", "과정명", "학습시간", "진도율"], ["가나", "청렴교육", "1", "1"], ["다라", "청렴교육", "1", "0.8"]], "표1", [])
        self.assertEqual([x["done"] for x in sources.parse_records(t2, "f")], [True, False])  # 엑셀 백분율 서식

    def test_roster_without_ids_and_sign_date(self):
        from daisu import sources
        from daisu.readers import Table
        h = ["성명", "소속", "직위", "입사일"]
        ps = (sources.parse_roster(Table([h, ["김철수", "총무팀", "주임", "2020-01-01"]], "시트1"), "정규직.xlsx")
              + sources.parse_roster(Table([h, ["이민수", "시설팀", "주무관", "2021-01-01"]], "시트1"), "공무직.xlsx"))
        self.assertEqual(len({p["id"] for p in ps}), 2)
        t = Table([["성명", "소속", "서명"], ["김철수", "총무팀", "김철수"]], "표1", ["청렴교육 참석자 서명부", "장소: 본관 2-1 회의실", "일시: 2026. 9. 10.(목) 14:00~16:00"])
        self.assertEqual(sources.sign_info(t, "청렴교육 서명부.xlsx", 2026)["date"], "2026-09-10")

    def test_duplicate_leave_nodate_future(self):
        p = self.person("A1", "김철수")
        r1 = self.rec("김철수", "산업안전보건교육", "2026-08-01", 3)
        res = self.run_engine([p], [r1, dict(r1, file="g.xlsx", where="다른 파일")])
        self.assertEqual(res["cells"]["A1"]["sr@H2"]["h"], 3.0)  # 두 자료에 같은 기록 → 한 번만
        lv = self.person("A1", "김철수", leave=["2026-09-01", "2026-12-31"])
        for b in ("2026-10-13", "2027-01-10"):
            self.assertEqual(self.run_engine([lv], [], base=b, year=2026)["cells"]["A1"]["sr@H2"]["s"], "leave")
        nd = self.run_engine([p], [self.rec("김철수", "산업안전보건교육", None, 6)], base="2027-01-10", year=2026)
        self.assertEqual(nd["cells"]["A1"]["sr@H2"]["s"], "done")
        fut = self.run_engine([p, self.person("A2", "신입", hired="2026-12-01")], [self.rec("김철수", "청렴교육", "2026-03-01", 2)])
        self.assertEqual(fut["cells"]["A2"]["int"]["s"], "na")

    def test_external_year_and_swapped_dates(self):
        from daisu import costs
        tr = {"rel": "여비규정.hwpx", "texts": [{"text": "여비규정", "where": "p1"}],
              "tables": [{"rows": [["구분", "일비", "식비", "숙박비"], ["5급 이하", "25,000원", "25,000원", "70,000원"]], "where": "표 1", "before": []}],
              "budget": None}
        rs = [self.rec("김철수", "위탁A", "2025-11-03", 24, kind="external", start="2025-11-01", stay=False, stay_provided=False, cost=700000, inst="X"),
              self.rec("김철수", "위탁B", "2026-06-01", 8, kind="external", start="2026-06-03", stay=True, stay_provided=False, cost=0, inst="X")]
        e = costs.external(self.run_engine([self.person("A1", "김철수")], rs, reg=tr))
        self.assertEqual(e["total_cost"], 0)
        self.assertEqual(len(e["rows"]), 1)
        self.assertEqual((e["rows"][0]["days"], e["rows"][0]["start"]), (3, "2026-06-01"))
        self.assertGreater(e["rows"][0]["travel"], 0)

    def test_money_and_required_hours(self):
        from daisu import regs as R
        self.assertEqual([R.money(x) for x in ("2만5천원", "1일 25,000원", "100만원", "1시간 250,000원", "실비")],
                         [25000, 25000, 1000000, 250000, None])
        t = {"rows": [["과정명", "대상", "시간", "시기"], ["신규임용자 기본교육", "신규임용자", "16시간", "임용 후 3개월 이내"]], "where": "표 1", "before": []}
        out = R.extract([{"rel": "교육훈련규정.hwpx", "texts": [{"text": "교육훈련규정", "where": "p"}], "tables": [t], "budget": None}])
        rule = R.required_rules(out)[0]
        self.assertEqual((rule["hours"], rule["due_months"]), (16.0, 3))
        from daisu.util import add_months, due_label
        self.assertEqual(add_months(dt.date(2026, 11, 30), 3), dt.date(2027, 2, 28))
        self.assertEqual(due_label({"cycle": "promo", "due_months": 6}), "승진일 기준(6개월 이내)")

    def test_fee_grade_missing_and_formula(self):
        from daisu import fees
        cfg = {"tiers": [{"grade": "특별", "first": 400000, "extra": 300000}, {"grade": "일반", "first": 100000, "extra": 50000}]}
        f = fees.compute({"grade": "", "income": "기타소득"}, 2, cfg)
        self.assertTrue(f["grade_missing"])
        self.assertEqual(f["lecture"], 0)
        g = fees.compute({"grade": "특별", "income": "기타소득"}, 4, cfg)
        self.assertTrue(any("= 1,300,000원" in x for x in g["steps"]))

    def test_next_plan_average_ignores_courses_without_targets(self):
        from daisu.planning import _avg_rate
        res = {"summary": [{"mandatory": True, "rate": 100.0}, {"mandatory": True, "rate": None}, {"mandatory": True, "rate": 80.0}]}
        self.assertEqual(_avg_rate(res), 90.0)


class TestAdversarialServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from daisu.server import app
        cls.c = TestClient(app)
        cls.pid = cls.c.post("/api/projects/sample").json()["id"]

    def test_upload_never_escapes_workspace(self):
        from daisu.server import _safe_rel
        long = "AAAA/" + "tmp/ESCAPE/" + "d" * 200 + "/pwn.xlsx"
        for name in ("../../x.xlsx", "/etc/x.xlsx", "C:\\Windows\\x.xlsx", long, "a/" * 200 + "b.xlsx"):
            r = _safe_rel(name)
            self.assertFalse(r.startswith("/") or ".." in r.split("/"), name)
            self.assertLessEqual(len(r), 240)
        out = tempfile.mkdtemp()
        r = self.c.post("/api/projects/upload", files=[("files", ("A/" + out.lstrip("/") + "/" + "d" * 230 + "/pwn.xlsx", b"x", None))])
        self.assertIn(r.status_code, (200, 400))
        self.assertEqual(os.listdir(out), [])

    def test_session_inputs(self):
        c, P = self.c, f"/api/projects/{self.pid}"
        for h in ("abc", [1], {}, True):
            self.assertEqual(c.post(P + "/sessions", json={"col": "sh", "hours": h}).status_code, 400, h)
        sid = c.post(P + "/sessions", json={"col": "dis", "manual": True, "date": "2026-11-02"}).json()["ids"][0]
        S = f"{P}/sessions/{sid}"
        for bad in ("20261102", "2026-W45-1", "2026-02-30"):
            self.assertEqual(c.patch(S, json={"date": bad}).status_code, 400, bad)
        import base64
        bad_png = "data:image/png;base64," + base64.b64encode(b"\x89PNGnotrealpngdata").decode()
        d = c.get(P).json()
        self.assertEqual(c.post(S + "/attend", json={"person": d["people"][0]["id"], "sign": bad_png}).status_code, 400)
        self.assertEqual(c.get(P + "/export", params={"doc": "session_result", "session": sid, "fmt": "hwpx"}).status_code, 400)
        c.patch(S, json={"instructor": {"name": "김강사", "grade": ""}})
        self.assertEqual(c.get(P + "/export", params={"doc": "session_fee", "session": sid, "fmt": "hwpx"}).status_code, 400)

    def test_export_format_fallback_and_empty_checklist_sheet(self):
        r = self.c.get(f"/api/projects/{self.pid}/export", params={"doc": "nextplan", "fmt": "pdf"})
        self.assertEqual(r.status_code, 200)
        self.assertIn(".hwpx", urllib.parse.unquote(r.headers["content-disposition"]))
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(self.c.get(f"/api/projects/{self.pid}/export?doc=gantt").content))
        self.assertGreater(wb["체크리스트"].max_row, 1)
