"""Python 서버 단위·통합 테스트: 데이터 무결성, 가드, DRF 파서, LLM 어댑터(HTTP 모킹), HTTP 서버"""
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
for k in ("LAW_API_OC", "LAW_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
    os.environ.pop(k, None)
os.environ["LAW_PROXY_URL"] = "off"  # 테스트는 네트워크 없이(기본 중계 서버 대신 직접 모드 + 모킹)

from law_for_all import data  # noqa: E402
from law_for_all.analyze import analyze  # noqa: E402
from law_for_all.ask import ask  # noqa: E402
from law_for_all.drf import parse_articles, parse_case_list, parse_law_list  # noqa: E402
from law_for_all.guard import GuardError, find_unverified_mentions, guard_llm_output, sanitize_markers  # noqa: E402
from law_for_all.server import make_server  # noqa: E402


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(payload: dict, calls: list):
    def _open(req, timeout=None):
        calls.append(req)
        return FakeResp(json.dumps(payload).encode("utf-8"))
    return _open


class DataIntegrity(unittest.TestCase):
    def test_refs_exist(self):
        for t in data.TOPICS:
            for r in t["refs"]:
                self.assertTrue(data.article_exists(r), f"{t['id']} {r}")
        for pid, p in data.PERSPECTIVES.items():
            for r in p["judge"]["requirements"]:
                if r.get("ref"):
                    self.assertTrue(data.article_exists(r["ref"]), f"{pid} {r['ref']}")


_LAW = data.get_law("housing-lease")
_CTX = [data.to_citation(_LAW, a) for a in _LAW["articles"] if a["no"] in ("3", "3의2")]


class RoutingTest(unittest.TestCase):
    def test_routing_cases(self):
        """토픽 라우팅 회귀 시험(Next.js 판과 같은 질문 목록)"""
        from law_for_all.search import match_topics
        fx = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
        if not (fx / "routing-cases.json").is_file():
            self.skipTest("저장소의 tests/fixtures 가 없음(실행판 단독)")
        wrong = []
        for name in ("routing-cases", "routing-holdout"):
            for c in json.loads((fx / f"{name}.json").read_text(encoding="utf-8"))["cases"]:
                h = match_topics(c["q"])
                got = h[0]["topic"]["id"] if h else None
                if got != c["topic"]:
                    wrong.append(f"{c['q']} — 기대 {c['topic']} / 실제 {got}")
        self.assertEqual(wrong, [])


class LawAliasTest(unittest.TestCase):
    def test_alias_cases(self):
        """생활 용어 → 법령 사전(Next.js 판과 같은 질문 목록), 법령명 낱말 일치"""
        from law_for_all.search import law_name_has, match_law_aliases
        fx = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "alias-cases.json"
        if fx.is_file():
            wrong = []
            for c in json.loads(fx.read_text(encoding="utf-8"))["cases"]:
                m = match_law_aliases(c["q"])
                got = m[0]["law"] if m else None
                if got != c["law"]:
                    wrong.append(f"{c['q']} — 기대 {c['law']} / 실제 {got}")
            self.assertEqual(wrong, [])
        self.assertFalse(law_name_has("군사기밀 보호법", "사기"))
        self.assertFalse(law_name_has("지진ㆍ화산재해대책법", "산재"))
        self.assertTrue(law_name_has("주차장법", "주차"))
        self.assertTrue(law_name_has("소음ㆍ진동관리법", "진동"))


class GuardTest(unittest.TestCase):
    ctx = _CTX

    def test_sanitize(self):
        out, removed, used = sanitize_markers("가 [[housing-lease:3]]. 나 [[fake:1]].", {c["key"] for c in self.ctx})
        self.assertEqual(removed, ["fake:1"])
        self.assertEqual(used, ["housing-lease:3"])
        self.assertNotIn("fake", out)

    def test_unverified(self):
        bad = find_unverified_mentions("「주택임대차보호법」 제3조, 「주택임대차보호법」 제99조, 「민사집행법」 제41조", self.ctx)
        self.assertEqual(bad, ["「주택임대차보호법」 제99조"])

    def test_no_citation_raises(self):
        with self.assertRaises(GuardError):
            guard_llm_output({"summary": "근거 없음", "citations": []}, "officer", self.ctx)

    def test_key_notation(self):
        # [[키]]로 감싸거나 한 문자열에 여러 키를 써도 인정(목록 밖 키는 제거)
        g = guard_llm_output({"summary": "전입 다음 날부터 대항력이 생겨요.", "steps": [{"title": "전입신고", "detail": "하세요", "ref": "[[housing-lease:3]]"}], "citations": ["[[housing-lease:3]], [[fake:1]]"]}, "citizen", self.ctx)
        self.assertEqual(g["citationKeys"], ["housing-lease:3"])
        self.assertEqual(g["citizen"]["steps"][0]["ref"], "housing-lease:3")
        self.assertIn("fake:1", g["removed"])

    def test_small_model_output(self):
        # 감싼 JSON·answer 키·[[키]] 누락 보정 — 근거 목록의 조문을 이름·번호로 언급할 때만 인용으로 인정
        g = guard_llm_output({"answer": {"answer": "「주택임대차보호법」 제3조에 따라 전입 다음 날 대항력이 생겨요."}}, "citizen", self.ctx)
        self.assertEqual(g["citationKeys"], ["housing-lease:3"])
        with self.assertRaises(GuardError):
            guard_llm_output({"summary": "「주택임대차보호법」 제30조를 보세요."}, "citizen", self.ctx)
        self.assertEqual(guard_llm_output({"summary": "주택임대차보호법 제3조의2에 따라 우선변제"}, "officer", self.ctx)["citationKeys"], ["housing-lease:3의2"])
        from law_for_all.guard import guard_analysis_output
        a = guard_analysis_output({"result": {"lawyer": {"stance": "「주택임대차보호법」 제3조 대항력 주장"}, "prosecutor": {"stance": ""}, "judge": {"stance": "요건 검토"}}}, self.ctx)
        self.assertEqual(a["citationKeys"], ["housing-lease:3"])


class DrfTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_law_list({"LawSearch": {"law": {"법령명한글": "형법", "법령일련번호": "1"}}})[0]["mst"], "1")
        arts = parse_articles({"조문단위": [{"조문여부": "전문"}, {"조문여부": "조문", "조문번호": "3", "조문가지번호": "2", "조문제목": "t", "조문내용": "제3조의2(t) ① 본문", "항": {"항내용": "② 둘째", "호": [{"호내용": "1. 호"}]}}]})
        self.assertEqual(arts, [{"no": "3의2", "title": "t", "text": "① 본문\n② 둘째\n  1. 호"}])
        self.assertNotIn("OC=", parse_case_list({"prec": [{"사건명": "x", "사건번호": "2020다1"}]}, "판례")[0]["url"])


class LLMAdapterTest(unittest.TestCase):
    def tearDown(self):
        for k in ("LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            os.environ.pop(k, None)

    def test_openai_guard(self):
        os.environ.update(OPENAI_API_KEY="sk-test", LLM_PROVIDER="openai")
        content = json.dumps({"summary": "0.03% 이상 [[road-traffic:44]]. 가짜 [[road-traffic:999]]", "steps": [{"title": "a", "detail": "b", "ref": "road-traffic:44"}], "citations": ["road-traffic:44"]})
        calls = []
        with mock.patch("urllib.request.urlopen", fake_urlopen({"model": "gpt-test", "choices": [{"message": {"content": content}}]}, calls)):
            r = ask("음주운전 처벌 기준", "citizen")
        self.assertEqual(calls[0].full_url, "https://api.openai.com/v1/chat/completions")
        self.assertEqual(json.loads(calls[0].data)["response_format"], {"type": "json_object"})
        self.assertEqual(r["provider"]["id"], "openai")
        self.assertIn("road-traffic:999", r["guard"]["removedCitations"])

    def test_anthropic_bad_json_falls_back(self):
        os.environ.update(ANTHROPIC_API_KEY="k")
        calls = []
        with mock.patch("urllib.request.urlopen", fake_urlopen({"model": "c", "content": [{"type": "text", "text": "JSON 아님"}]}, calls)):
            r = ask("민원 처리 기한", "officer", "anthropic")
        self.assertEqual(calls[0].full_url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(calls[0].get_header("X-api-key"), "k")
        self.assertEqual(r["provider"]["id"], "mock")
        self.assertIn("Anthropic", r["guard"]["fallbackReason"])

    def test_ollama_analysis(self):
        os.environ.update(LLM_PROVIDER="ollama")
        content = json.dumps({
            "lawyer": {"stance": "주장 [[labor-standards:36]]", "arguments": ["14일 [[labor-standards:36]]"]},
            "prosecutor": {"stance": "처벌 [[labor-standards:109]]"},
            "judge": {"stance": "판단", "requirements": [{"label": "퇴직", "ref": "labor-standards:36", "status": "met", "basis": "퇴사"}, {"label": "x", "ref": "fake:1", "status": "??"}]},
            "citations": ["labor-standards:36"],
        })
        calls = []
        with mock.patch("urllib.request.urlopen", fake_urlopen({"model": "exaone3.5:7.8b", "message": {"content": content}}, calls)):
            r = analyze("퇴사했는데 사장님이 마지막 월급을 3주째 안 주고 있어요")
        self.assertEqual(calls[0].full_url, "http://localhost:11434/api/chat")
        self.assertEqual(r["provider"]["id"], "ollama")
        req = r["analyses"][0]["perspectives"]["judge"]["requirements"]
        self.assertEqual(req[1]["status"], "unclear")
        self.assertNotIn("ref", req[1])
        self.assertIn("fake:1", r["guard"]["removedCitations"])

    def test_llm_test_two_models(self):
        """--llm-test: 모델을 바꿔 가며 같은 질문을 돌리고, 2종 모두 통과하면 입증으로 판정·결과 문서 작성"""
        import re
        import tempfile
        from law_for_all.llmtest import run as llm_test
        sent_models = []

        def fake_ollama(req, timeout=None):
            body = json.loads(req.data)
            sent_models.append(body["model"])
            # 질문 프롬프트에 실린 근거 조문 키(<<법령id:조>>)만 인용 — 지시문 속 예시 표기는 제외
            keys = re.findall(r"<<([^>\s]+)>>", body["messages"][-1]["content"]) or ["labor-standards:36"]
            k = keys[0]
            content = json.dumps({
                "summary": f"근거 조문에 따르면 이렇습니다 [[{k}]].", "steps": [{"title": "확인", "detail": "원문 확인", "ref": k}],
                "background": f"배경 [[{k}]]", "keyPoints": [f"쟁점 [[{k}]]"], "adminNotes": ["유의"], "checklist": ["확인"],
                "lawyer": {"stance": f"주장 [[{k}]]"}, "prosecutor": {"stance": f"검토 [[{k}]]"},
                "judge": {"stance": "판단", "requirements": [{"label": "요건", "ref": k, "status": "met", "basis": "서술"}], "outlook": "가능성"},
                "citations": [k],
            }, ensure_ascii=False)
            return FakeResp(json.dumps({"model": body["model"], "message": {"content": content}}).encode("utf-8"))

        with tempfile.TemporaryDirectory() as d, mock.patch("urllib.request.urlopen", fake_ollama):
            path, two = llm_test("ollama:gemma3:4b,ollama:exaone3.5:7.8b", Path(d))
            text = path.read_text(encoding="utf-8")
        self.assertTrue(two)
        self.assertEqual(set(sent_models), {"gemma3:4b", "exaone3.5:7.8b"})
        self.assertIn("| ollama:gemma3:4b | gemma3:4b | 4/4 |", text)
        self.assertIn("| ollama:exaone3.5:7.8b | exaone3.5:7.8b | 4/4 |", text)
        self.assertNotIn("OLLAMA_MODEL", os.environ)  # 모델 바꾼 설정은 끝나면 원래대로

    def test_http_error_falls_back(self):
        os.environ.update(OPENAI_API_KEY="bad", LLM_PROVIDER="openai")

        def boom(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b'{"error":{"message":"invalid key"}}'))

        with mock.patch("urllib.request.urlopen", boom):
            r = ask("층간소음 기준", "citizen")
        self.assertEqual(r["provider"]["id"], "mock")
        self.assertIn("invalid key", r["guard"]["fallbackReason"])


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, path, body=None):
        r = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=10) as res:
                return res.status, json.loads(res.read()), res.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers

    def test_api(self):
        s, j, h = self.req("/api/health")
        self.assertEqual((s, j["runtime"]), (200, "python"))
        self.assertEqual(h["X-Content-Type-Options"], "nosniff")
        s, j, _ = self.req("/api/ask", {"query": "윗집 층간소음 기준", "mode": "citizen"})
        self.assertEqual(j["topic"]["id"], "floor-noise")
        s, j, _ = self.req("/api/ask", {"query": "x"})
        self.assertEqual((s, j["error"]), (400, "질문을 2자 이상 입력해 주세요."))
        s, j, _ = self.req("/api/analyze", {"situation": "짧음"})
        self.assertEqual(s, 400)
        s, j, _ = self.req("/api/followup", {"question": "언제까지 줘야 하나요?", "prevQuery": "퇴사했는데 마지막 월급을 안 줘요", "mode": "citizen"})
        self.assertEqual((s, j["intent"], [c["key"] for c in j["citations"]]), (200, "deadline", ["labor-standards:36"]))
        s, j, _ = self.req("/api/followup", {"question": "기한은?", "prevQuery": ""})
        self.assertEqual(s, 400)
        s, j, _ = self.req("/api/laws/housing-lease")
        self.assertEqual(j["children"][0]["id"], "housing-lease-decree")
        s, j, _ = self.req("/api/laws/NOPE!")
        self.assertEqual(s, 400)
        s, j, _ = self.req("/api/providers")
        self.assertEqual([p["id"] for p in j["providers"]], ["mock", "openai", "anthropic", "ollama"])

    def test_cors_for_shared_page(self):
        """단일 파일 공유판(다른 출처)이 /api/* 를 부를 수 있어야 하고, 화면 파일에는 허용 헤더를 붙이지 않음"""
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        conn.request("OPTIONS", "/api/ask", headers={"Origin": "null", "Access-Control-Request-Method": "POST"})
        r = conn.getresponse()
        r.read()
        self.assertEqual((r.status, r.getheader("Access-Control-Allow-Origin")), (204, "*"))
        self.assertIn("POST", r.getheader("Access-Control-Allow-Methods"))
        conn.close()
        _, _, h = self.req("/api/health")
        self.assertEqual(h["Access-Control-Allow-Origin"], "*")
        try:  # 화면 파일(빌드 전이면 404 페이지)에는 허용 헤더가 없어야 함
            with urllib.request.urlopen(self.base + "/", timeout=5) as res:
                headers = res.headers
        except urllib.error.HTTPError as e:
            headers = e.headers
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_share_download(self):
        """사이트에서 공유판을 내려받을 때: 열지 않고 저장(attachment), 영문 파일 이름"""
        from law_for_all.server import WEB
        if not (WEB / "downloads" / "law-on-share.html").is_file():
            self.skipTest("빌드 전에는 공유판 파일이 없음")
        req = urllib.request.Request(self.base + "/downloads/law-on-share.html", method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as res:
            cd = res.headers["Content-Disposition"]
        self.assertEqual(cd, 'attachment; filename="LAW-ON_share.html"')

    def test_keepalive_after_early_error(self):
        """오류로 일찍 응답해도 본문을 읽어 같은 연결의 다음 요청이 정상 처리되어야 함"""
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        body = json.dumps({"query": "x" * 600}).encode()
        conn.request("POST", "/api/ask", body, {"content-type": "application/json"})
        r1 = conn.getresponse()
        r1.read()
        self.assertEqual(r1.status, 400)
        conn.request("GET", "/api/health")
        r2 = conn.getresponse()
        self.assertEqual(r2.status, 200)
        self.assertEqual(json.loads(r2.read())["status"], "ok")
        conn.close()

    def test_static_traversal_blocked(self):
        try:
            with urllib.request.urlopen(self.base + "/..%2f..%2frun.py", timeout=5) as r:
                status = r.status
                body = r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, b""
        self.assertTrue(status == 404 or b"argparse" not in body)


if __name__ == "__main__":
    unittest.main()


class LiveModeTest(unittest.TestCase):
    def test_case_search_fallback(self):
        from law_for_all import service
        calls = []

        def fake(path, params, oc, timeout=20, retries=None):
            calls.append(params)
            if params["target"] == "prec":
                # 본문 검색: 제목이 맞는 사건 + 본문에만 낱말이 있는 엉뚱한 사건(제목으로 다시 걸러 빠져야 함)
                return {"PrecSearch": {"prec": [{"사건명": "손해배상(층간소음)", "사건번호": "2025다1"}, {"사건명": "특수공무집행방해", "사건번호": "2025도9"}] if params.get("search") == "2" else []}}
            return {"Expc": {"expc": [{"안건명": "민원인 - 층간소음의 범위(「공동주택관리법」 제20조 관련)", "안건번호": "1"}, {"안건명": "감사원 - 층간소음 기준 적용 시점", "안건번호": "2"}]}}

        with mock.patch.object(service, "drf_get", fake):
            cases = service.LawService("k").search_cases("층간소음")
        self.assertEqual([c["caseNo"] for c in cases if c["kind"] == "판례"], ["2025다1"])
        self.assertFalse(any(p["target"] == "expc" and p.get("search") == "2" for p in calls))

    def test_effective_date_from_list(self):
        from law_for_all import service

        def fake(path, params, oc, timeout=20, retries=None):
            if path == "lawSearch.do":
                return {"LawSearch": {"law": [{"법령명한글": "행정심판법", "법령일련번호": "7", "시행일자": "20230321", "현행연혁코드": "현행"}]}}
            return {"법령": {"기본정보": {"법령명_한글": "행정심판법", "시행일자": "20280101"}, "조문": {"조문단위": [{"조문여부": "조문", "조문번호": "27", "조문제목": "t", "조문내용": "제27조(t) ① 90일"}]}}}

        with mock.patch.object(service, "drf_get", fake):
            law = service.LawService("k").get_law("admin-appeal")
        self.assertEqual((law["source"], law["effectiveDate"]), ("live", "20230321"))

    def test_retry_on_reset(self):
        from law_for_all import drf
        drf._cache.clear()
        n = {"i": 0}

        def flaky(req, timeout=None):
            n["i"] += 1
            if n["i"] < 3:
                raise ConnectionResetError(104, "reset")
            return FakeResp(b'{"ok": 1}')

        with mock.patch("urllib.request.urlopen", flaky), mock.patch("time.sleep"):
            self.assertEqual(drf.drf_get("lawSearch.do", {"q": "x"}, "k"), {"ok": 1})
        self.assertEqual(n["i"], 3)


class ProxyRouteTest(unittest.TestCase):
    def test_default_and_routing(self):
        from law_for_all import config as cfg, drf
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LAW_PROXY_URL", None)
            self.assertEqual(cfg.law_proxy()["url"], "https://lawon.onrender.com")  # 기본: 법이음 클라우드 서버 중계
        with mock.patch.dict(os.environ, {"LAW_PROXY_URL": "off"}):
            self.assertIsNone(cfg.law_proxy())  # off: 법제처 API 직접 호출
        seen = []

        class R(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout=None):
            seen.append((req.full_url, req.headers.get("X-proxy-token")))
            return R(b'{"LawSearch": {"law": []}}')

        with mock.patch.dict(os.environ, {"LAW_PROXY_URL": "https://p.example/", "LAW_PROXY_TOKEN": "tok"}), mock.patch("urllib.request.urlopen", fake):
            drf.drf_get("lawSearch.do", {"target": "law", "query": "proxy-test"}, "SECRET", 1, 0)
        self.assertTrue(seen[0][0].startswith("https://p.example/api/raw/lawSearch.do?target=law"))
        self.assertNotIn("SECRET", seen[0][0])
        self.assertEqual(seen[0][1], "tok")


class RelayTest(unittest.TestCase):
    def test_relay_endpoint(self):
        """중계(/api/raw): 허용 범위만, 인증키를 붙여 조회하고 응답 속 인증키는 지운다"""
        from law_for_all import drf
        from law_for_all.server import make_server
        seen = []

        class R(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout=None):
            seen.append(req.full_url)
            return R('{"PrecSearch": {"prec": [{"판례상세링크": "/DRF/lawService.do?OC=SECRETOC&target=prec&ID=1"}]}}'.encode())

        httpd = make_server("127.0.0.1", 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        real_open = urllib.request.urlopen
        try:
            with mock.patch.dict(os.environ, {"LAW_API_OC": "SECRETOC"}), mock.patch.object(drf.urllib.request, "urlopen", fake):
                body = real_open(base + "/api/raw/lawSearch.do?target=prec&query=relay-test").read().decode()
            self.assertIn("OC=SECRETOC", seen[0])
            self.assertNotIn("SECRETOC", body)
            self.assertIn("PrecSearch", body)
            with self.assertRaises(urllib.error.HTTPError) as cm:
                real_open(base + "/api/raw/lawSearch.do?target=evil")
            self.assertEqual(cm.exception.code, 400)
            with mock.patch.dict(os.environ, {"LAW_API_OC": ""}), self.assertRaises(urllib.error.HTTPError) as cm:
                real_open(base + "/api/raw/lawSearch.do?target=law&query=x")
            self.assertEqual(cm.exception.code, 503)
        finally:
            httpd.shutdown()


class CaseViewerTest(unittest.TestCase):
    def test_parse_detail(self):
        from law_for_all.drf import parse_case_detail, parse_case_list
        d = parse_case_detail({"PrecService": {"사건명": "부당해고", "사건번호": "2023두1", "법원명": "대법원", "판결요지": "[1] 실질<br/>[2] 종속", "판례내용": "<b>○○</b>&nbsp;조합"}}, "판례", "1")
        self.assertEqual([s["label"] for s in d["sections"]], ["판결요지", "판결 전문"])
        self.assertEqual(d["sections"][0]["text"], "[1] 실질\n[2] 종속")
        self.assertEqual(d["sections"][1]["text"], "○○ 조합")
        self.assertEqual(parse_case_list({"prec": [{"사건명": "x", "판례일련번호": "77"}]}, "판례")[0]["id"], "77")

    def test_detail_route_without_key(self):
        httpd = make_server("127.0.0.1", 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            for path, code in (("/api/cases/detail?kind=prec&id=abc", 400), ("/api/cases/detail?kind=prec&id=123", 503)):
                try:
                    urllib.request.urlopen(base + path, timeout=5)
                    status = 200
                except urllib.error.HTTPError as e:
                    status = e.code
                self.assertEqual(status, code, path)
        finally:
            httpd.shutdown()
            httpd.server_close()


class LiveBudgetTest(unittest.TestCase):
    def test_slow_api_falls_back_within_budget(self):
        """국가법령정보센터가 응답하지 않아도 답변은 시간 예산 안에 공식 원문 스냅샷으로 나와야 함"""
        import time as _t
        from law_for_all import service

        def hang(*a, **k):
            _t.sleep(3)
            raise service.LawApiError("timeout")

        with mock.patch.object(service, "drf_get", hang):
            svc = service.LawService("k")
            t0 = _t.time()
            cites = svc.get_citations(["apartment-mgmt:20", "floor-noise-rule:3"], budget=0.5)
            took = _t.time() - t0
        self.assertLess(took, 1.5)
        self.assertEqual([c["key"] for c in cites], ["apartment-mgmt:20", "floor-noise-rule:3"])
        self.assertTrue(all(c["source"] == "mock" for c in cites))
        self.assertTrue(any("응답 지연" in w for w in svc.warnings))


class CaseBudgetTest(unittest.TestCase):
    def test_slow_fulltext_is_skipped_within_budget(self):
        """사건명 검색 결과가 없고 본문 검색이 느려도 예산 안에 응답(본문 검색 생략 안내)"""
        import time as _t
        from law_for_all import service

        def fake(path, params, oc, timeout=20, retries=None):
            if params.get("search") == "2":
                _t.sleep(3)
            return {"PrecSearch": {"prec": []}} if params["target"] == "prec" else {"Expc": {"expc": []}}

        with mock.patch.object(service, "drf_get", fake):
            svc = service.LawService("k")
            t0 = _t.time()
            svc.search_cases("층간소음", budget=1.0)
            took = _t.time() - t0
        self.assertLess(took, 2.0)
        self.assertTrue(any("본문 검색이 지연" in w for w in svc.warnings))


class LiveSearchTest(unittest.TestCase):
    """토픽 밖 질문 → 법제처 Open API 전체 법령 검색 순위(실제 응답 고정 데이터로 재현, Next.js 판과 같은 결과)"""

    def test_ranking(self):
        import urllib.parse
        from law_for_all import service
        fx = json.loads((Path(__file__).resolve().parents[2] / "tests/fixtures/live-search.json").read_text(encoding="utf-8"))

        def fake(path, params, oc, timeout=20, retries=None):
            k = path + "?" + urllib.parse.urlencode(sorted(params.items()))
            if k not in fx:
                raise service.LawApiError("no fixture " + k)
            return fx[k]

        cases = [("반려견 목줄 안하면 과태료 있나요", "동물보호법", "16"), ("청소년에게 술 팔면 처벌받나요", "청소년 보호법", "28"),
                 ("건축허가 받으려면 뭐가 필요해요", "건축법", "11"), ("학교폭력 신고하면 어떻게 처리되나요", "학교폭력예방 및 대책에 관한 법률", "20"),
                 ("주차장 설치 기준은 어떻게 되나요?", "주차장법", "12")]
        with mock.patch.object(service, "drf_get", fake):
            for q, law, no in cases:
                svc = service.LawService("test")
                keys = svc.search_live_keys(q, budget=60)
                cites = svc.get_citations(keys, 0)
                self.assertIn(f"{law}:{no}", [f"{c['lawName']}:{c['articleNo']}" for c in cites], q)


class RuleParserTest(unittest.TestCase):
    """행정규칙·자치법규 파서 — Next.js 판(tests/rules.test.ts)과 같은 실제 응답·같은 결과"""

    def test_parsers(self):
        from law_for_all.drf import parse_admrul_doc, parse_ordin_doc
        from law_for_all.data import article_label
        fx = json.loads((Path(__file__).resolve().parents[2] / "tests/fixtures/rules.json").read_text(encoding="utf-8"))
        o = parse_ordin_doc(fx["ordin"], "ord-2118167")
        self.assertEqual([o["name"], o["kind"], o["ministry"]], ["강화군 공동주택 층간소음 방지 조례", "자치법규", "인천광역시 강화군 · 조례"])
        self.assertEqual([(a["no"], a["title"]) for a in o["articles"]], [("1", "목적"), ("2", "정의"), ("3", "군수의 책무")])
        self.assertRegex(o["articles"][1]["text"].split("\n")[1], r"^ {2}1\. “공동주택”이란")
        a = parse_admrul_doc(fx["admrul"], "adm-2100000265232")
        self.assertEqual([a["name"], a["ministry"], a["articles"][0]["no"], article_label("본문")], ["층간소음 전문기관 지정 고시", "기후에너지환경부 · 고시", "본문", "본문"])
        self.assertNotIn("<img", a["articles"][0]["text"])
        self.assertRegex(a["articles"][0]["text"].split("\n")[1], r"^2\. 재검토기한")
        b = parse_admrul_doc(fx["admrulArticles"], "adm-99")
        self.assertEqual([x["no"] for x in b["articles"]], ["1", "2", "2의2"])
        self.assertEqual(b["articles"][1]["text"], "① 이 지침은 공무원에게 적용한다.\n② 다만, 다음 각 호는 제외한다.\n  1. 계약직2. 위촉직")


class GovThemePatchTest(unittest.TestCase):
    """2026 챌린지 테마 적용기: </head>·</body> 바로 앞 삽입, 중복 없음, 되돌리면 원본과 동일"""

    def test_patch_idempotent_and_revert(self):
        import tempfile
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import patch_gov_theme as g
        html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><title>t</title></head><body><main>x</main><script>self.__next_f.push([1,"</body> 문자열"])</script></body></html>'
        with tempfile.TemporaryDirectory() as d:
            web = Path(d)
            (web / "laws").mkdir()
            for p in (web / "index.html", web / "laws" / "a.html"):
                p.write_text(html, encoding="utf-8")
            (web / "data.txt").write_text("</body>", encoding="utf-8")
            s = g.run(web, quiet=True)
            self.assertEqual((s["scanned"], s["changed"]), (2, 2))
            out = (web / "laws" / "a.html").read_text(encoding="utf-8")
            self.assertIn(g.CSS_TAG + "</head>", out)
            self.assertTrue(out.endswith(g.JS_TAG + "</body></html>"))
            self.assertIn('"</body> 문자열"', out)  # 데이터 안의 문자열은 그대로
            self.assertEqual(out.count("gov-challenge-2026.css"), 1)
            self.assertEqual(g.run(web, quiet=True)["changed"], 0)  # 다시 실행해도 변경 없음
            self.assertEqual((web / "data.txt").read_text(encoding="utf-8"), "</body>")  # .html 만 대상
            g.run(web, revert=True, quiet=True)
            self.assertEqual((web / "index.html").read_text(encoding="utf-8"), html)


class PrivacyMaskTest(unittest.TestCase):
    """질문 속 개인정보 가리기 — tests/privacy-mask.test.ts 와 같은 사례"""

    def test_masks(self):
        from law_for_all.privacy import mask_pii
        text, found = mask_pii("제 주민번호는 900101-1234567이고 010-1234-5678로 연락주세요. 국민은행 123456-01-234567, 카드 1234-5678-9012-3456, a.b@test.co.kr, 여권 M12345678")
        self.assertNotRegex(text, r"\d{6}-\d{7}|010-1234|123456-01|1234-5678-9012|@test|M12345678")
        self.assertEqual(found, ["주민등록번호", "카드번호", "전화번호", "이메일", "계좌번호", "여권번호"])
        self.assertEqual(mask_pii("집주인 번호 01098765432 이에요")[1], ["전화번호"])
        self.assertEqual(mask_pii("02-123-4567 사무실")[1], ["전화번호"])

    def test_keeps(self):
        from law_for_all.privacy import mask_pii
        for q in ["2026-10-25에 계약 끝나요", "보증금 2억 3000만원", "음주운전 0.03 걸리면", "제3조의2 대항력", "2025년 10월 1일부터 30일까지", "시급 10,030원"]:
            self.assertEqual(mask_pii(q), (q, []))


class LiveMergeTest(unittest.TestCase):
    """실시간 조문으로 바꿔도 내장 별표 요지(금액·기준)는 유지"""

    def test_keeps_byeolpyo(self):
        from law_for_all.data import get_law
        from law_for_all.service import _merge
        mock = get_law("anti-graft-decree")
        live = {**mock, "articles": [{**a, "text": a["text"].split("\n[별표")[0]} for a in mock["articles"]]}
        merged = {a["no"]: a["text"] for a in _merge(live, mock)["articles"]}
        self.assertIn("40만원", merged["25"])
        self.assertIn("음식물", merged["17"])
        self.assertEqual(merged["25"].count("[별표 2] <개정 2026.6.30>"), 1)


class QuantityGuardTest(unittest.TestCase):
    """수치 대조 — tests/fixtures/quantity-cases.json 을 Next.js 판(tests/numbers.test.ts)과 함께 사용"""

    def test_fixture_cases(self):
        from law_for_all.numbers import extract_quantities, unverified_quantities
        fx = Path(__file__).resolve().parents[2] / "tests/fixtures/quantity-cases.json"
        if not fx.exists():
            self.skipTest("저장소의 tests/fixtures 가 없는 배포본")
        data = json.loads(fx.read_text(encoding="utf-8"))
        for c in data["extract"]:
            self.assertEqual(extract_quantities(c["text"]), c["expect"], c["text"])
        for c in data["verify"]:
            self.assertEqual(unverified_quantities(c["answer"], c["sources"]), c["expect"], c["answer"])

    def test_guard_rejects_wrong_number(self):
        from law_for_all.guard import GuardError, guard_llm_output
        ctx = [{"key": "labor-standards:36", "lawId": "labor-standards", "lawName": "근로기준법", "articleNo": "36", "title": "금품 청산",
                "text": "사용자는 근로자가 사망 또는 퇴직한 경우에는 그 지급 사유가 발생한 때부터 14일 이내에 임금, 보상금, 그 밖의 모든 금품을 지급하여야 한다.", "url": "", "source": "mock"}]
        ok = {"summary": "퇴직 후 14일 이내에 받아야 해요 [[labor-standards:36]]", "steps": [], "easyTerms": [], "citations": ["labor-standards:36"]}
        self.assertIn("14일", guard_llm_output(ok, "citizen", ctx)["summary"])
        with self.assertRaisesRegex(GuardError, "확인되지 않은 수치 1건: 30일"):
            guard_llm_output({**ok, "summary": "퇴직 후 30일 이내에 받아야 해요 [[labor-standards:36]]"}, "citizen", ctx)
        with_user = {**ok, "summary": "못 받은 180만원은 14일 이내에 받아야 해요 [[labor-standards:36]]"}
        with self.assertRaises(GuardError):
            guard_llm_output(with_user, "citizen", ctx)
        self.assertIn("180만원", guard_llm_output(with_user, "citizen", ctx, ["마지막 월급 180만원을 못 받았어요"])["summary"])


class TrafficCasesTest(unittest.TestCase):
    """교통사고 보험처리 — 라우팅과 이런 경우라면(tests/case-rank.test.ts 와 같은 사례)"""

    def test_route_and_cases(self):
        from law_for_all.ask import ask
        from law_for_all.cases import pick_cases
        from law_for_all.data import TOPICS
        r = ask("교통사고 났는데 상대가 보험처리 안 해줘요", "citizen")
        self.assertEqual(r["topic"]["id"], "traffic-insurance")
        self.assertEqual(r["citizen"]["cases"][0]["situation"], "상대가 보험 접수를 안 해 줄 때")
        keys = {c["key"] for c in r["citations"]}
        self.assertIn("commercial-act:724", keys)
        t = next(x for x in TOPICS if x["id"] == "traffic-insurance")
        self.assertEqual(pick_cases(t, "상대 차가 무보험이래요")[0]["situation"], "상대 차가 보험이 없을 때")
        self.assertEqual(len(pick_cases(t, "교통사고 났어요")), 3)
        self.assertEqual(pick_cases(None, "아무 질문"), [])


class CaseRankTest(unittest.TestCase):
    """판례·해석례 관련도 정리 — tests/case-rank.test.ts 와 같은 사례"""

    def test_rank(self):
        from law_for_all.case_rank import case_core_title, rank_cases
        from law_for_all.search import live_case_query
        c = lambda kind, title, i: {"kind": kind, "id": i, "title": title}  # noqa: E731
        items = [c("판례", "특수공무집행방해, 허위공문서작성, 대통령기록물관리에관한법률위반", "1"), c("판례", "공유재산사용허가취소처분취소", "2"),
                 c("법령해석례", "고양시 - 기부채납 재산에 대하여 무상 사용·수익허가기간을 20년으로 정하여 허가하는 경우(「공유재산 및 물품 관리법」 제21조 관련)", "3")]
        self.assertEqual([x["id"] for x in rank_cases("공유재산 사용허가", items, 10)], ["2", "3"])
        self.assertEqual(case_core_title(c("법령해석례", "경기도 고양시ㆍ민원인 - 둘 이상의 주택건설대지를 대상으로 지역주택조합 설립", "x")), "둘 이상의 주택건설대지를 대상으로 지역주택조합 설립")
        items = [c("법령해석례", "민원인 - 지역주택조합의 설립 인가", "1"), c("법령해석례", "민원인 - 법정민원의 처리기간을 연장하는 경우(「민원 처리에 관한 법률 시행령」 제21조)", "2")]
        self.assertEqual([x["id"] for x in rank_cases("민원 처리기간", items, 10)], ["2"])
        items = [c("법령해석례", "광주광역시 서구 - 무기계약근로자 등 행정보조인력에게 인·허가 등의 업무를 분장할 수 있는지", "1"), c("법령해석례", "개인정보보호위원회 - 비상임위원이 겸직하려는 경우 별도의 허가 절차를 거쳐야 하는지 여부", "2")]
        self.assertEqual([x["id"] for x in rank_cases("겸직 허가", items, 10)], ["2"])
        self.assertEqual(len(rank_cases("공무원 선거운동", [c("판례", "국가공무원법위반·공직선거법위반", "1")], 10)), 1)
        items = [c("판례", "취득세 중과세율 적용", "1"), c("판례", "스토킹범죄의처벌등에관한법률위반[수개월간 반복하여 고의로 소음을 발생시킨 행위]", "2"), c("법령해석례", "감사원 - 공동주택 각 층간 바닥충격음 기준이 적용되는 시점", "3")]
        self.assertEqual([x["id"] for x in rank_cases("층간소음", items, 10)], ["2", "3"])
        self.assertEqual(rank_cases("공유재산 사용허가", [c("판례", "단독주택을 지분 취득한 경우 구분소유적 공유관계를 인정하여 세율을 적용할 수 있는지 여부", "1")], 10), [])
        t = "국토교통부 - 공공임대주택 임차인의 재계약에 적용되는 법률(「공공주택 특별법」 제49조의3 등)"
        self.assertEqual(len(rank_cases("공공임대주택 재계약", [c("법령해석례", t, str(i)) for i in range(3)], 10)), 1)
        self.assertEqual(live_case_query("공무원 겸직 허가 기준"), "겸직")
        self.assertEqual(live_case_query("택배가 분실됐는데 배상받을 수 있나요"), "택배 분실")
        self.assertEqual(live_case_query("주차장에서 문콕 당했어요"), "주차장 문콕")
        self.assertEqual(live_case_query("아르바이트 최저시급 못 받았어요"), "최저임금")
