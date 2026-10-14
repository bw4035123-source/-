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
        s, j, _ = self.req("/api/laws/housing-lease")
        self.assertEqual(j["children"][0]["id"], "housing-lease-decree")
        s, j, _ = self.req("/api/laws/NOPE!")
        self.assertEqual(s, 400)
        s, j, _ = self.req("/api/providers")
        self.assertEqual([p["id"] for p in j["providers"]], ["mock", "openai", "anthropic", "ollama"])

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
