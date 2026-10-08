"""업무바통 핵심 기능 시험: python -m pytest tests  (또는 python -m unittest discover tests)"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
TMP = tempfile.mkdtemp(prefix="baton_test_")
os.environ["BATON_WORKSPACE"] = os.path.join(TMP, "ws")
# 설정 파일을 임시 폴더에 복사해 시험 중 실제 설정이 바뀌지 않게 함
shutil.copytree(os.path.join(ROOT, "config"), os.path.join(TMP, "config"))
os.environ["BATON_CONFIG_DIR"] = os.path.join(TMP, "config")

from baton import config  # noqa: E402
from baton.draft import answer_question, build_draft  # noqa: E402
from baton.extract import extract, find_dates  # noqa: E402
from baton.ingest import ingest_folder, mask_sensitive, verify_originals  # noqa: E402
from baton.llm import OfflineClient, get_client, parse_json, self_check  # noqa: E402
from baton.qa import ask  # noqa: E402
from tests import mock_llm  # noqa: E402

SAMPLE = config.SAMPLE_DIR


def _project():
    r = ingest_folder(SAMPLE)
    return {"id": "00000000", "docs": r["docs"], "chunks": r["chunks"], "draft": None}


class TestParsers(unittest.TestCase):
    def test_all_sample_formats_parsed(self):
        r = ingest_folder(SAMPLE)
        exts = {d["ext"] for d in r["docs"] if d["n_chunks"]}
        self.assertTrue({".hwpx", ".pdf", ".xlsx", ".docx", ".eml", ".txt"} <= exts, exts)
        self.assertFalse([d for d in r["docs"] if d.get("error")])

    def test_originals_untouched(self):
        r = ingest_folder(SAMPLE)
        self.assertTrue(verify_originals(SAMPLE, r["docs"])["ok"])

    def test_document_kinds(self):
        kinds = {d["file"].split("/")[-1]: d["kind"] for d in ingest_folder(SAMPLE)["docs"]}
        self.assertEqual(kinds["업무메모_김바통.txt"], "memo")
        self.assertEqual(kinds["[공문]2026년_개인정보보호_관리수준진단_실적제출_안내.pdf"], "official")
        self.assertEqual(kinds["01_2027_정보화예산_요구일정.eml"], "mail")


class TestExtraction(unittest.TestCase):
    def test_masking(self):
        t, n = mask_sensitive("포털 PW: Gasang!2026, 주민번호 900101-1234567, 휴대폰 010-1234-5678, 사무실 02-123-4567")
        self.assertEqual(n, 3)
        self.assertNotIn("Gasang", t)
        self.assertIn("02-123-4567", t)

    def test_dates(self):
        self.assertEqual(find_dates("매월 10일 보안점검의 날")[0]["recur"], "monthly")
        d = find_dates("2026. 5. 29.(금)까지 제출")[0]
        self.assertEqual((d["year"], d["month"], d["day"]), (2026, 5, 29))
        self.assertEqual(find_dates("매년 3월 자체점검")[0]["recur"], "yearly")
        self.assertEqual(find_dates("5/22까지 도 제출")[0]["day"], 22)

    def test_conflict_found(self):
        p = _project()
        f = extract(p["chunks"], p["docs"])
        dates = {v["date"] for c in f["conflicts"] for v in c["variants"]}
        self.assertTrue(any("22" in d for d in dates) and any("29" in d for d in dates), f["conflicts"])

    def test_people_and_me(self):
        p = _project()
        f = extract(p["chunks"], p["docs"])
        self.assertEqual(f["me"]["name"], "김바통")
        names = {x["name"] for x in f["people"]}
        self.assertTrue({"박예산", "최보안", "정유지"} <= names, names)
        self.assertNotIn("김바통", names)


class TestOfflineDraft(unittest.TestCase):
    def test_draft_and_answer(self):
        p = _project()
        d = build_draft(p, OfflineClient())
        kinds = {s["kind"]: s for s in d["sections"]}
        self.assertTrue(kinds["calendar"]["items"] and kinds["issues"]["items"] and kinds["tips"]["items"])
        for s in d["sections"]:
            for it in s["items"]:
                self.assertTrue(it["sources"], it)  # 규칙엔진 항목은 모두 출처가 있어야 함
        q = next(q for q in d["questions"] if q["type"] == "conflict")
        answer_question(d, q["id"], "도 마감 5/22가 실제 기한")
        conflict_items = [i for i in kinds["checks"]["items"] if i["meta"].get("type") == "conflict"]
        self.assertTrue(all(i["meta"].get("resolved") for i in conflict_items))

    def test_offline_qa(self):
        p = _project()
        p["draft"] = build_draft(p, OfflineClient())
        r = ask(p, "수준진단 증빙자료는 어디에 모아 뒀어?", OfflineClient())
        self.assertTrue(r["found"] and r["sources"])
        self.assertFalse(ask(p, "청사 주차 등록 방법", OfflineClient())["found"])


class TestLLMPath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv, port = mock_llm.start()
        s = config.load_settings()
        s["llm"]["profiles"]["mock"] = {"type": "openai", "label": "모의 LLM", "base_url": f"http://127.0.0.1:{port}/v1", "model": "mock"}
        config.save_settings(s)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_parse_json_tolerant(self):
        self.assertEqual(parse_json('```json\n[{"a": 1},]\n```'), [{"a": 1}])
        self.assertEqual(parse_json('설명\n[{"a": 1}, {"a": 2}]\n끝'), [{"a": 1}, {"a": 2}])
        self.assertEqual(parse_json('[{"a": 1}, {"a": 2'), [{"a": 1}])

    def test_self_check(self):
        r = self_check("mock")
        self.assertTrue(r["ok"], r)

    def test_llm_draft_validates_sources(self):
        p = _project()
        d = build_draft(p, get_client("mock"))
        self.assertEqual(d["mode"], "llm")
        issues = next(s for s in d["sections"] if s["kind"] == "issues")
        self.assertEqual(issues["mode"], "llm")
        bad = [i for i in issues["items"] if "지어낸" in i["text"]]
        self.assertEqual(bad[0]["status"], "unsupported")  # 존재하지 않는 근거 ID → 근거없음 처리
        self.assertTrue(any(q["origin"] == "llm" for q in d["questions"]))
        self.assertEqual(d["doc_cards"][0].get("by"), "llm")

    def test_llm_qa(self):
        p = _project()
        p["draft"] = build_draft(p, OfflineClient())
        r = ask(p, "예산 요구서는 언제까지 제출해?", get_client("mock"))
        self.assertEqual(r["mode"], "llm")
        self.assertTrue(r["sources"])

    def test_llm_down_falls_back(self):
        s = config.load_settings()
        s["llm"]["profiles"]["dead"] = {"type": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "x"}
        config.save_settings(s)
        d = build_draft(_project(), get_client("dead"))
        self.assertTrue(d["warnings"])
        self.assertTrue(all(s["mode"] == "rule" for s in d["sections"]))


class TestServer(unittest.TestCase):
    def test_end_to_end(self):
        from fastapi.testclient import TestClient

        from baton.server import app

        c = TestClient(app)
        pid = c.post("/api/projects/demo").json()["id"]
        for _ in range(100):
            if c.get(f"/api/projects/{pid}/job").json().get("state") in ("done", "error"):
                break
            time.sleep(0.2)
        p = c.get(f"/api/projects/{pid}").json()
        self.assertTrue(p["integrity"]["ok"])
        item = p["draft"]["sections"][0]["items"][0]
        self.assertEqual(c.patch(f"/api/projects/{pid}/items/{item['id']}", json={"status": "verified"}).json()["status"], "verified")
        self.assertEqual(c.post(f"/api/projects/{pid}/handover", json={"role": "to"}).status_code, 400)  # 전임자 먼저
        c.post(f"/api/projects/{pid}/handover", json={"role": "from"})
        self.assertIn("to_signed_at", c.post(f"/api/projects/{pid}/handover", json={"role": "to"}).json())
        for fmt in ("docx", "md", "html"):
            self.assertEqual(c.get(f"/api/projects/{pid}/export?fmt={fmt}").status_code, 200)
        md = c.get(f"/api/projects/{pid}/export?fmt=md").text
        self.assertIn("근거 목록", md)
        self.assertNotIn("Gasang!2026", json.dumps(c.get(f"/api/projects/{pid}/chunks/S0012").json(), ensure_ascii=False))
        self.assertEqual(c.get(f"/api/projects/{pid}/plan").status_code, 200)


if __name__ == "__main__":
    unittest.main()
