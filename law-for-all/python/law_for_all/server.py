"""HTTP 서버 — 정적 화면(web/) + JSON API. 표준 라이브러리 http.server 기반(설치 불필요)."""
from __future__ import annotations

import json
import mimetypes
import re
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__
from .analyze import analyze
from .ask import ask
from .config import config
from .llm import list_providers
from .service import LawService

WEB = Path(__file__).resolve().parent / "web"
MAX_BODY = 64 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/x-component", ".txt")  # Next.js RSC 페이로드

# ───────────── 간이 요청 제한(고정 창)
_buckets: dict[str, list] = {}
_rl_lock = threading.Lock()


def rate_limit(key: str, limit: int = 30, window: float = 60.0):
    now = time.time()
    with _rl_lock:
        b = _buckets.get(key)
        if not b or b[1] < now:
            _buckets[key] = [1, now + window]
            return True, 0
        b[0] += 1
        return b[0] <= limit, int(b[1] - now) + 1


class ApiError(Exception):
    def __init__(self, status: int, message: str, headers: dict | None = None):
        super().__init__(message)
        self.status, self.headers = status, headers or {}


def _validate_ask(body: dict) -> dict:
    q = body.get("query")
    q = q.strip() if isinstance(q, str) else ""
    if len(q) < 2:
        raise ApiError(400, "질문을 2자 이상 입력해 주세요.")
    if len(q) > 500:
        raise ApiError(400, "질문은 500자 이내로 입력해 주세요.")
    mode = body.get("mode") or "citizen"
    if mode not in ("citizen", "officer"):
        raise ApiError(400, "mode 값이 올바르지 않습니다.")
    prov = body.get("provider")
    return {"query": q, "mode": mode, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def _validate_analyze(body: dict) -> dict:
    s = body.get("situation")
    s = s.strip() if isinstance(s, str) else ""
    if len(s) < 10:
        raise ApiError(400, "상황을 10자 이상 구체적으로 적어 주세요.")
    if len(s) > 2000:
        raise ApiError(400, "상황 설명은 2,000자 이내로 적어 주세요.")
    prov = body.get("provider")
    return {"situation": s, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


class Handler(BaseHTTPRequestHandler):
    server_version = f"LawOn/{__version__}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 조용한 로그(오류만)
        if args and isinstance(args[1], str) and args[1].startswith(("4", "5")) and not self.path.startswith("/_next"):
            super().log_message(fmt, *args)

    # ───── 응답 도우미
    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None, head_only=False):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in {**SECURITY_HEADERS, **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _json(self, status: int, obj, extra: dict | None = None):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", {"Cache-Control": "no-store", **(extra or {})})

    def _client(self) -> str:
        return self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

    def _read_raw(self) -> bytes:
        """요청 본문을 항상 끝까지 읽음 — 오류로 일찍 응답해도 keep-alive 연결에 찌꺼기가 남지 않도록"""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY:
            self.close_connection = True
            self._raw = b""
            self._too_big = True
            return b""
        self._too_big = False
        self._raw = self.rfile.read(n) if n > 0 else b""
        return self._raw

    def _body(self) -> dict:
        if getattr(self, "_too_big", False):
            raise ApiError(413, "요청이 너무 큽니다.")
        try:
            data = json.loads(getattr(self, "_raw", b"").decode("utf-8") or "{}")
        except ValueError:
            raise ApiError(400, "요청 형식이 올바르지 않습니다.")
        if not isinstance(data, dict):
            raise ApiError(400, "요청 형식이 올바르지 않습니다.")
        return data

    # ───── 라우팅
    def do_GET(self):
        self._route("GET")

    def do_HEAD(self):
        self._route("HEAD")

    def do_POST(self):
        self._route("POST")

    def _route(self, method: str):
        if method == "POST":
            self._read_raw()
        url = urlparse(self.path)
        path = unquote(url.path)
        try:
            if path.startswith("/api/"):
                self._api(method, path, parse_qs(url.query))
            elif method in ("GET", "HEAD"):
                self._static(path, head_only=method == "HEAD")
            else:
                raise ApiError(405, "허용되지 않은 메서드입니다.")
        except ApiError as e:
            self._json(e.status, {"error": str(e)}, e.headers)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            self._json(500, {"error": "서버 내부 오류가 발생했습니다."})

    def _api(self, method: str, path: str, qs: dict):
        q = (qs.get("q") or [""])[0][:100]
        if method == "GET" and path == "/api/health":
            return self._json(200, {"status": "ok", "runtime": "python", "lawApi": "live" if config.law_access else "mock", "llm": config.llm["defaultProvider"], "time": datetime.now(timezone.utc).isoformat()})
        if method == "GET" and path == "/api/providers":
            return self._json(200, {"providers": list_providers(config.llm), "lawApi": "live" if config.law_access else "mock"})
        if method == "GET" and path == "/api/laws":
            svc = LawService(config.law_access)
            kind = (qs.get("kind") or ["law"])[0]
            laws = svc.list_laws(q, kind if kind in ("law", "admrul", "ordin") else "law")
            return self._json(200, {"laws": laws, "mode": svc.mode, "warnings": svc.warnings})
        m = re.fullmatch(r"/api/laws/([^/]+)", path)
        if method == "GET" and m:
            law_id = m.group(1)
            if not re.fullmatch(r"[a-z0-9-]{2,60}", law_id):
                raise ApiError(400, "잘못된 법령 식별자")
            svc = LawService(config.law_access)
            h = svc.get_hierarchy(law_id)
            if not h:
                raise ApiError(404, svc.warnings[0] if svc.warnings else "법령을 찾을 수 없습니다.")
            return self._json(200, {**h, "warnings": svc.warnings})
        if method == "GET" and path == "/api/cases":
            svc = LawService(config.law_access)
            try:
                limit = min(int((qs.get("limit") or ["5"])[0]), 20)
            except ValueError:
                limit = 5
            return self._json(200, {"cases": svc.search_cases(q, limit), "live": svc.mode == "live", "warnings": svc.warnings})
        if method == "GET" and path == "/api/cases/detail":
            kind = "법령해석례" if (qs.get("kind") or [""])[0] == "expc" else "판례"
            case_id = (qs.get("id") or [""])[0]
            if not re.fullmatch(r"\d{1,12}", case_id):
                raise ApiError(400, "잘못된 판례 식별자")
            svc = LawService(config.law_access)
            if svc.mode != "live":
                raise ApiError(503, "판례 보기는 법령 API 중계 서버(LAW_PROXY_URL) 또는 인증키(LAW_API_OC) 설정 시 제공됩니다.")
            detail = svc.get_case(kind, case_id)
            if not detail:
                raise ApiError(404, svc.warnings[0] if svc.warnings else "판례를 찾을 수 없습니다.")
            return self._json(200, {"detail": detail})
        if method == "POST" and path in ("/api/ask", "/api/analyze"):
            ok, retry = rate_limit(f"{path}:{self._client()}", 30 if path == "/api/ask" else 20)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            body = self._body()
            if path == "/api/ask":
                a = _validate_ask(body)
                return self._json(200, ask(a["query"], a["mode"], a["provider"]))
            a = _validate_analyze(body)
            return self._json(200, analyze(a["situation"], a["provider"]))
        raise ApiError(404, "존재하지 않는 API입니다.")

    def _static(self, path: str, head_only=False):
        if not WEB.is_dir():
            return self._send(503, "화면 파일(web/)이 없습니다. 배포판 zip을 다시 받거나 scripts/build-python.mjs 로 빌드하세요.".encode(), "text/plain; charset=utf-8")
        rel = path.lstrip("/")
        candidates = ["index.html"] if not rel else [rel, f"{rel}.html", f"{rel}/index.html"]
        # 내장되지 않은 법령(/laws/mst-…)은 공통 화면(placeholder) 사용 — 화면이 주소에서 id를 읽어 API로 조회
        if re.fullmatch(r"laws/[^/]+", rel.removesuffix(".html").removesuffix(".txt")):
            candidates.append("laws/_.txt" if rel.endswith(".txt") else "laws/_.html")
        for c in candidates:
            f = (WEB / c).resolve()
            if WEB in f.parents and f.is_file():
                ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
                    ctype += "; charset=utf-8"
                cache = "public, max-age=31536000, immutable" if rel.startswith("_next/static/") else "no-cache"
                return self._send(200, f.read_bytes(), ctype, {"Cache-Control": cache}, head_only)
        nf = WEB / "404.html"
        return self._send(404, nf.read_bytes() if nf.is_file() else b"Not Found", "text/html; charset=utf-8", None, head_only)


class _Server(ThreadingHTTPServer):
    daemon_threads = True


def make_server(host: str, port: int) -> ThreadingHTTPServer:
    return _Server((host, port), Handler)
