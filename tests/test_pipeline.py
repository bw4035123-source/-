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
                if it["meta"].get("type") != "missing":  # '누락'은 없는 것을 알리는 항목이라 출처가 없음
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

    def test_model_family_quirks(self):
        """젬마(system 거부)·엑사원(생각 태그)·GPT-OSS(생각만 하다 빈 답)·Ollama 기본 API 모두 같은 결과."""
        port = self.srv.server_address[1]
        s = config.load_settings()
        for name, model, typ in [("q-gemma", "gemma3:4b", "openai"), ("q-exaone", "exaone3.5:7.8b", "openai"),
                                 ("q-gptoss", "gpt-oss:20b", "openai"), ("q-ollama", "gemma3:4b", "ollama")]:
            s["llm"]["profiles"][name] = {"type": typ, "base_url": f"http://127.0.0.1:{port}/v1", "model": model}
        config.save_settings(s)
        for name in ("q-gemma", "q-exaone", "q-gptoss", "q-ollama"):
            r = self_check(name)
            self.assertTrue(r["ok"], (name, r))
        self.assertIn("exaone3.5:7.8b", get_client("q-exaone").models())

    def test_llm_down_falls_back(self):
        s = config.load_settings()
        s["llm"]["profiles"]["dead"] = {"type": "openai", "base_url": "http://127.0.0.1:9/v1", "model": "x"}
        config.save_settings(s)
        d = build_draft(_project(), get_client("dead"))
        self.assertTrue(d["warnings"])
        self.assertTrue(all(s["mode"] == "rule" for s in d["sections"]))


class TestCreativeFeatures(unittest.TestCase):
    def _draft(self):
        p = _project()
        p["base_date"] = "2026-05-11"
        p["draft"] = build_draft(p, OfflineClient())
        return p

    def test_ics_and_relay_roundtrip(self):
        from baton.export import to_baton, to_ics

        p = self._draft()
        p.update(id="00000000", name="시험", from_name="김바통", to_name="이어달")
        ics = to_ics(p)
        self.assertIn("RRULE:FREQ=MONTHLY;BYMONTHDAY=10", ics)
        self.assertIn("RRULE:FREQ=YEARLY", ics)
        for it in p["draft"]["sections"][0]["items"]:
            it["status"] = "verified"
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "넘김.baton"), "w", encoding="utf-8") as f:
            f.write(to_baton(p))
        r = ingest_folder(d)
        self.assertEqual(r["docs"][0]["kind"], "relay")
        names = [g["name"] for g in r["docs"][0]["info"]["lineage"]]
        self.assertEqual(names, ["김바통"])

    def test_sample_has_relay_generation(self):
        r = ingest_folder(SAMPLE)
        relay = [d for d in r["docs"] if d["kind"] == "relay"]
        self.assertEqual(len(relay), 1)
        self.assertEqual(relay[0]["info"]["lineage"][0]["name"], "박선배 주무관")


class TestRehearsal(unittest.TestCase):
    """인수 리허설: 정답 비공개, 서버 채점, 모호한 문제 제외, 준비도·수정 시 재확인."""

    @classmethod
    def setUpClass(cls):
        p = _project()
        p["base_date"] = "2026-05-11"
        p["draft"] = build_draft(p, OfflineClient())
        cls.draft = p["draft"]

    def test_round_has_mixed_types_and_hidden_answers(self):
        from baton import rehearsal as R

        rnd = R.make_round(self.draft, {}, n=10, seed=1)
        kinds = {q["kind"] for q in rnd["questions"]}
        self.assertGreaterEqual(len(kinds), 4)
        self.assertFalse(rnd["confirmed_only"])  # 아직 아무것도 확정하지 않음 → 검수 전 항목 포함 표시
        pub = json.dumps(R.public(rnd), ensure_ascii=False)
        for key in ('"answer"', '"explain"', '"sources"'):
            self.assertNotIn(key, pub)

    def test_no_ambiguous_questions(self):
        from baton import rehearsal as R

        qs, _ = R._candidates(self.draft, __import__("random").Random(3))
        when = [q for q in qs if q["kind"] == "when"]
        texts = [q["q"] for q in when]
        self.assertEqual(len(texts), len(set(texts)))  # 같은 문장에서 답이 둘인 문제 없음
        for q in qs:
            if q["kind"] == "status":  # 대기·보류·회신 대기는 서로 오답 보기가 되지 않음
                groups = [R.STATUS_GROUP[o] for o in q["options"]]
                self.assertEqual(len(groups), len(set(groups)))
            self.assertIn(q["answer"], q["options"])

    def test_tip_false_statement(self):
        import random

        from baton import rehearsal as R

        fake = R._falsify("작년 양식 쓰면 반려되니 꼭 새 양식 받을 것!", random.Random(0))
        self.assertEqual(fake, "새 양식 쓰면 반려되니 꼭 작년 양식 받을 것!")
        self.assertIsNone(R._falsify("담당자에게 확인할 것", random.Random(0)))

    def test_confirmed_only_when_reviewed(self):
        import copy

        from baton import rehearsal as R

        d = copy.deepcopy(self.draft)
        for s in d["sections"]:
            for it in s["items"]:
                it["status"] = "verified" if s["kind"] in ("people", "issues") else it["status"]
        rnd = R.make_round(d, {}, n=10, seed=1)
        self.assertTrue(rnd["confirmed_only"])
        self.assertEqual({q["kind"] for q in rnd["questions"]} - {"who", "status"}, set())

    def test_server_grading_readiness_and_stale_after_edit(self):
        from fastapi.testclient import TestClient

        from baton.server import app

        c = TestClient(app)
        pid = c.post("/api/projects/demo").json()["id"]
        for _ in range(100):
            if c.get(f"/api/projects/{pid}/job").json().get("state") in ("done", "error"):
                break
            time.sleep(0.2)
        self.assertEqual(c.post(f"/api/projects/{pid}/rehearsal/submit", json={"answers": {}}).status_code, 400)
        rnd = c.post(f"/api/projects/{pid}/rehearsal/start", json={}).json()
        from baton import store

        # 정답 열쇠는 서버 저장본에만 있고, 화면용 정보(프로젝트 조회)로도 새지 않는다
        key = {q["id"]: q["answer"] for q in store.load(pid)["rehearsal"]["open"]["questions"]}
        view = c.get(f"/api/projects/{pid}").json()
        self.assertNotIn("rehearsal", view)
        self.assertNotIn(store.load(pid)["rehearsal"]["open"]["questions"][0]["explain"], json.dumps(view, ensure_ascii=False))
        res = c.post(f"/api/projects/{pid}/rehearsal/submit", json={"answers": key}).json()
        self.assertTrue(all(r["correct"] for r in res["results"]))
        self.assertEqual(res["readiness"]["ok"], len(rnd["questions"]))
        self.assertGreater(res["readiness"]["pct"], 0)
        # 틀린 답에는 근거 원문이 붙는다
        rnd2 = c.post(f"/api/projects/{pid}/rehearsal/start", json={}).json()
        key2 = {q["id"]: q["answer"] for q in store.load(pid)["rehearsal"]["open"]["questions"]}
        wrong = {k: (v + 1) % len(next(q for q in rnd2["questions"] if q["id"] == k)["options"]) for k, v in key2.items()}
        res2 = c.post(f"/api/projects/{pid}/rehearsal/submit", json={"answers": wrong}).json()
        self.assertTrue(all(not r["correct"] and r["sources"] for r in res2["results"]))
        # 맞혔던 항목을 전임자가 고치면 그 항목은 다시 확인해야 한다
        p = store.load(pid)
        ok_item = next(i for i, m in p["rehearsal"]["mastery"].items() if m["ok"])
        before = c.get(f"/api/projects/{pid}/rehearsal").json()["readiness"]["ok"]
        c.patch(f"/api/projects/{pid}/items/{ok_item}", json={"text": "고친 내용 2026. 7. 1.까지 제출"})
        after = c.get(f"/api/projects/{pid}/rehearsal").json()["readiness"]["ok"]
        self.assertEqual(after, before - 1)


FACILITY = os.path.join(ROOT, "sample_data", "전임자_김도윤_업무폴더")


class TestFacilitySample(unittest.TestCase):
    """다른 기관·업무(시설관리)의 모의자료로 규칙엔진이 한 샘플에만 맞춰져 있지 않은지 확인."""

    @classmethod
    def setUpClass(cls):
        r = ingest_folder(FACILITY)
        cls.p = {"id": "00000000", "docs": r["docs"], "chunks": r["chunks"], "from_name": "", "base_date": "2026-10-08",
                 "source_path": FACILITY}
        cls.p["draft"] = build_draft(cls.p, OfflineClient())
        cls.f = cls.p["draft"]["facts"]

    def test_predecessor_from_folder_and_duties(self):
        self.assertEqual(self.f["me"]["name"], "김도윤")
        duties = [i["text"] for i in self.f["rr"]]
        self.assertIn("수영장 수질관리 및 결과 보고", duties)
        self.assertIn("안전점검(해빙기·정기·우기·동절기) 계획 및 시행", duties)  # 괄호 안 쉼표·가운뎃점에서 나누지 않음

    def test_people_from_tables(self):
        ppl = {x["name"]: x for x in self.f["people"]}
        self.assertNotIn("김도윤", ppl)
        self.assertEqual((ppl["정하은"]["title"], ppl["정하은"]["org"]), ("주임", "기관 경영지원팀"))
        self.assertIn("02-000-1830", ppl["정민재"]["tels"])
        self.assertTrue(ppl["정민재"]["changed"])
        self.assertNotIn("현장", ppl)  # '현장 대리인'은 사람이 아님

    def test_checks(self):
        conf = {v["date"] for c in self.f["conflicts"] for v in c["variants"]}
        self.assertTrue(any("27" in d for d in conf) and any("3일" in d for d in conf), conf)  # 착공일 10/27 ↔ 11/3
        self.assertEqual([o["date"] for o in self.f["overdue"]], ["2026-10-06"])
        self.assertTrue({"아마", "미정"} <= {u["word"] for u in self.f["uncertain"]})

    def test_month_and_people_questions(self):
        a = ask(self.p, "11월에 할 일 알려줘", OfflineClient())
        self.assertEqual(a["mode"], "calendar")
        self.assertIn("입찰공고", a["answer"])
        a = ask(self.p, "정민재 연락처", OfflineClient())
        self.assertIn("02-000-1830", a["answer"])
        self.assertIn("바뀌었다", a["answer"])
        a = ask(self.p, "냉난방기 공사 누구랑 협의해?", OfflineClient())
        self.assertIn("오세영", a["answer"])

    def test_exports_hwpx_docx_md(self):
        from baton.export import handover_blocks, manual_blocks
        from baton.parsers import parse_file
        from baton.render import FORMATS

        p = dict(self.p, name="시설", to_name="이서연")
        d = tempfile.mkdtemp()
        for doc, blocks in (("handover", handover_blocks(p)), ("manual", manual_blocks(p))):
            for fmt, (fn, _) in FORMATS.items():
                path = os.path.join(d, f"{doc}.{fmt}")
                with open(path, "wb") as f:
                    f.write(fn(blocks))
                segs, _ = parse_file(path)
                text = " ".join(x.text for x in segs)
                self.assertIn("정민재", text, (doc, fmt))
        man = " ".join(str(b[1]) for b in manual_blocks(p))
        self.assertIn("용어 풀이", man)
        self.assertIn("첫 주에 할 일", man)

    def test_issue_fields_and_urgent(self):
        iss = next(s for s in self.p["draft"]["sections"] if s["kind"] == "issues")["items"]
        self.assertTrue(any(i["meta"].get("due") for i in iss))
        self.assertTrue(any(i["meta"].get("next") for i in iss))
        a = ask(self.p, "급한 현안 알려줘", OfflineClient())
        self.assertEqual(a["mode"], "calendar")
        self.assertIn("기한 지남", a["answer"])
        self.assertIn("D-", a["answer"])
        self.assertTrue(a["sources"])

    def test_resolve_and_unresolve(self):
        import copy

        from baton.draft import update_item

        d = copy.deepcopy(self.p["draft"])
        chk = next(s for s in d["sections"] if s["kind"] == "checks")["items"][0]
        update_item(d, chk["id"], resolved="")
        self.assertEqual(chk["meta"]["resolved"], "처리 완료")
        update_item(d, chk["id"], unresolve=True)
        self.assertNotIn("resolved", chk["meta"])

    def test_manual_level_and_start(self):
        from baton.export import manual_blocks

        p = dict(self.p, name="시설", to_name="이서연")
        new = " ".join(str(b[1:]) for b in manual_blocks(p, start="2026-11-02", level="new"))
        exp = " ".join(str(b[1:]) for b in manual_blocks(p, start="2026-11-02", level="exp"))
        self.assertIn("용어 풀이", new)
        self.assertNotIn("용어 풀이", exp)
        self.assertIn("2026-11-02", new)
        self.assertNotIn("재계약 필요 – 매월", new)  # 첫 주 할 일에 같은 설명 반복 없음


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

    def test_docsystem(self):
        from fastapi.testclient import TestClient

        from baton.server import app

        import socket
        import threading

        import uvicorn

        # 문서시스템 연계는 실제 HTTP로 목록·본문을 받아 오므로 이 테스트만 진짜 서버를 띄운다
        with socket.socket() as sk:
            sk.bind(("127.0.0.1", 0))
            port = sk.getsockname()[1]
        srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        threading.Thread(target=srv.run, daemon=True).start()
        self.addCleanup(setattr, srv, "should_exit", True)
        for _ in range(50):
            if srv.started:
                break
            time.sleep(0.1)
        c = TestClient(app)
        docs = c.get("/mock-docsystem/documents", params={"owner": "김도윤"}).json()["documents"]
        self.assertGreaterEqual(len(docs), 8)
        self.assertTrue(c.get(f"/mock-docsystem/documents/{docs[0]['id']}/content").json())
        pid = c.post("/api/projects/docsystem", json={"base_url": f"http://127.0.0.1:{port}/mock-docsystem", "owner": "김도윤"}).json()["id"]
        for _ in range(100):
            if c.get(f"/api/projects/{pid}/job").json().get("state") in ("done", "error"):
                break
            time.sleep(0.2)
        p = c.get(f"/api/projects/{pid}").json()
        self.assertEqual(c.get(f"/api/projects/{pid}/job").json()["state"], "done")
        self.assertEqual(p["from_name"], "김도윤")
        self.assertGreaterEqual(len(p["docs"]), 8)
        self.assertEqual(c.get(f"/api/projects/{pid}/docs/{p['docs'][0]['id']}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
