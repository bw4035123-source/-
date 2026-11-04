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
from .ask import ask, gather_evidence
from .compliance_ai import COMPLIANCE_SYSTEM, GENERIC_ARTICLE, build_compliance_prompt, guard_compliance
from .data import article_label
from .privacy import mask_pii
from .llm import LLMError
from .config import config
from .drf import RELAY_PATHS, RELAY_TARGETS, LawApiError, relay_raw
from .followup import followup
from .amend_ai import AMEND_SYSTEM, amend_retry, build_amend_prompt, guard_amend
from .enact_fill import FILL_SYSTEM, build_fill_prompt, guard_fill
from .upper_change import parse_old_and_new
from .guard import parse_loose_json
from .llm import list_providers, resolve_provider
from .service import LawService

WEB = Path(__file__).resolve().parent / "web"
MAX_BODY = 64 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
# 내려받기 파일의 저장 이름 — 한글 이름은 일부 브라우저가 "download" 로 바꿔 저장하므로 영문으로
DOWNLOAD_NAMES = {"law-on-share.html": "LAW-ON_share.html"}
# /api/* 는 단일 파일 공유판(다른 출처·파일로 연 HTML)에서도 부를 수 있게 허용 — 인증키는 서버에만 있고 응답에 담기지 않는다
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
}
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")
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


def _validate_followup(body: dict) -> dict:
    q = body.get("question")
    q = q.strip() if isinstance(q, str) else ""
    if len(q) < 2:
        raise ApiError(400, "질문을 2자 이상 입력해 주세요.")
    if len(q) > 300:
        raise ApiError(400, "질문은 300자 이내로 입력해 주세요.")
    prev = body.get("prevQuery")
    prev = prev.strip() if isinstance(prev, str) else ""
    if not prev or len(prev) > 500:
        raise ApiError(400, "이전 질문이 올바르지 않습니다.")
    mode = body.get("mode") or "citizen"
    if mode not in ("citizen", "officer"):
        raise ApiError(400, "mode 값이 올바르지 않습니다.")
    prov = body.get("provider")
    return {"question": q, "prevQuery": prev, "mode": mode, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def _validate_analyze(body: dict) -> dict:
    s = body.get("situation")
    s = s.strip() if isinstance(s, str) else ""
    if len(s) < 10:
        raise ApiError(400, "상황을 10자 이상 구체적으로 적어 주세요.")
    if len(s) > 2000:
        raise ApiError(400, "상황 설명은 2,000자 이내로 적어 주세요.")
    prov = body.get("provider")
    return {"situation": s, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def _validate_enact_fill(body: dict) -> dict:
    """제정안 AI 채우기 입력 — 조문·근거는 {label, text} 목록(크기 제한)"""

    def items(v, limit):
        if not isinstance(v, list) or len(v) > limit:
            raise ApiError(400, "요청 형식이 올바르지 않습니다.")
        out = []
        for x in v:
            if not isinstance(x, dict) or not isinstance(x.get("label"), str) or not isinstance(x.get("text"), str) or len(x["label"]) > 80 or len(x["text"]) > 3000:
                raise ApiError(400, "요청 형식이 올바르지 않습니다.")
            out.append({"label": x["label"], "text": x["text"]})
        return out

    arts = items(body.get("articles"), 40)
    if not arts:
        raise ApiError(400, "채울 조문이 없습니다.")
    s = lambda k, n: (body.get(k) if isinstance(body.get(k), str) else "")[:n]  # noqa: E731
    prov = body.get("provider")
    return {"name": s("name", 100), "kind": s("kind", 20) or "행정규칙", "org": s("org", 60), "purpose": s("purpose", 500), "articles": arts, "basis": items(body.get("basis") or [], 10), "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def _validate_amend_ai(body: dict) -> dict:
    """개정안 AI 작성 입력(크기 제한) — app/api/amend-ai/route.ts 와 같은 한도"""
    bad = ApiError(400, "요청 형식이 올바르지 않습니다.")
    s = lambda k, n: (body.get(k) if isinstance(body.get(k), str) else "")[:n]  # noqa: E731
    cur, ins = body.get("current"), body.get("instruction")
    if not isinstance(cur, str) or not cur.strip() or len(cur) > 4000 or not isinstance(ins, str) or not ins.strip() or len(ins) > 1000:
        raise bad
    up = body.get("upper") or []
    if not isinstance(up, list) or len(up) > 6:
        raise bad
    upper = []
    for x in up:
        if not isinstance(x, dict) or not isinstance(x.get("label"), str) or not isinstance(x.get("text"), str) or len(x["label"]) > 120 or len(x["text"]) > 4000:
            raise bad
        upper.append({"label": x["label"], "text": x["text"]})
    orig = body.get("original")
    if orig is not None and (not isinstance(orig, str) or len(orig) > 4000):
        raise bad
    prov = body.get("provider")
    return {"lawName": s("lawName", 100), "kind": s("kind", 20) or "행정규칙", "label": s("label", 120), "current": cur, "original": orig, "instruction": ins, "upper": upper, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def _validate_compliance_ai(body: dict) -> dict:
    """자체규정 AI 검토 입력(크기 제한) — app/api/compliance-ai/route.ts 와 같은 한도"""
    bad = ApiError(400, "요청 형식이 올바르지 않습니다.")
    arts = body.get("articles")
    if not isinstance(arts, list) or not 1 <= len(arts) <= 40:
        raise bad
    out = []
    for a in arts:
        if not isinstance(a, dict) or not isinstance(a.get("no"), str) or not isinstance(a.get("text"), str) or not a["text"].strip() or len(a["no"]) > 12 or len(a["text"]) > 3000:
            raise bad
        t = a.get("title") if isinstance(a.get("title"), str) else ""
        hints = a.get("hints") or []
        if not isinstance(hints, list) or len(hints) > 6 or not all(isinstance(h, str) and re.fullmatch(r"[\w.-]{1,40}:[0-9]{1,4}(?:의[0-9]{1,3})?", h) for h in hints):
            raise bad
        out.append({"no": a["no"], "title": t[:80], "text": a["text"], "hints": hints})
    s = lambda k, n: (body.get(k) if isinstance(body.get(k), str) else "")[:n]  # noqa: E731
    prov = body.get("provider")
    return {"regName": s("regName", 100), "orgType": s("orgType", 30), "articles": out, "provider": prov if isinstance(prov, str) and len(prov) <= 20 else None}


def compliance_ai(inp: dict) -> tuple[int, dict]:
    """조문마다 국가법령정보(실시간)에서 상위 조문을 찾아 붙이고 AI가 대조 → 가드 검증(lib/compliance-ai.ts)"""
    import concurrent.futures as cf

    started = time.time()
    p, _ = resolve_provider(config.llm, inp["provider"])
    if p.kind == "rule":
        return 503, {"error": "생성형 AI가 연결되어 있지 않아 AI 검토를 할 수 없어요. 기준 규칙 점검 결과를 참고하세요."}
    arts = [{**a, "text": mask_pii(a["text"])[0]} for a in inp["articles"]]
    warnings: list[str] = []

    def find(a):
        svc = LawService(config.law_access)
        q = re.sub(r"\s+", " ", f"{a['title']} {a['text']}")[:300]
        # 기준 규칙이 연결한 상위 조문을 앞에, 국가법령정보 검색으로 찾은 조문을 뒤에
        try:
            hinted = svc.get_citations(a["hints"]) if a["hints"] else []
        except Exception:  # noqa: BLE001
            hinted = []
        try:
            found = [] if GENERIC_ARTICLE.match(a["title"].strip()) else gather_evidence(q, svc)[1]
        except Exception:  # noqa: BLE001 — 근거 검색 실패는 '상위조문 없음'으로
            found = []
        warnings.extend(svc.warnings)
        keys = {h["key"] for h in hinted}
        return (hinted + [c for c in found if c["key"] not in keys])[:5]

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        uppers = list(ex.map(find, arts))

    def label(a):
        if a["no"] == "전문":
            return "(조문 구분 없음)"
        return f"제{a['no'].replace('의', '조의')}{'' if '의' in a['no'] else '조'}" + (f"({a['title']})" if a["title"] else "")

    items = [{"no": a["no"], "label": label(a), "text": a["text"][:1500], "upper": [{"key": c["key"], "label": f"「{c['lawName']}」 {article_label(c['articleNo'])}({c['title']})", "text": c["text"]} for c in uppers[i]]} for i, a in enumerate(arts)]
    chunks = [items[i:i + 5] for i in range(0, len(items), 5)]
    model = [p.model]

    def review(ch):
        messages = [{"role": "user", "content": build_compliance_prompt(inp["regName"], inp["orgType"], ch)}]
        for _ in range(2):
            res = p.generate(system=COMPLIANCE_SYSTEM, messages=messages, json_mode=True, temperature=0.1, max_tokens=3000, timeout_ms=70000)
            model[0] = res.get("model") or model[0]
            try:
                return guard_compliance(parse_loose_json(res["text"]), ch)
            except Exception:  # noqa: BLE001 — 형식이 깨지면 한 번 다시
                messages += [{"role": "assistant", "content": res["text"]}, {"role": "user", "content": "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라."}]
        return guard_compliance(None, ch)

    try:
        with cf.ThreadPoolExecutor(max_workers=4) as ex:
            flat = [r for rs in ex.map(review, chunks) for r in rs]
    except LLMError as e:
        return 502, {"error": f"AI({p.label})에 연결하지 못했어요. 기준 규칙 점검 결과를 참고하거나 잠시 후 다시 시도하세요.", "detail": str(e)}
    return 200, {"articles": [{**r, "upper": uppers[i]} for i, r in enumerate(flat)], "label": p.label, "model": model[0], "elapsedMs": int((time.time() - started) * 1000), "warnings": list(dict.fromkeys(warnings))[:3]}


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
        cors = CORS_HEADERS if self.path.startswith("/api/") else {}
        for k, v in {**SECURITY_HEADERS, **cors, **(extra or {})}.items():
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

    def do_OPTIONS(self):  # 다른 출처의 POST 사전 확인(preflight)
        self._send(204 if self.path.startswith("/api/") else 404, b"", "text/plain; charset=utf-8")

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
                raise ApiError(503, "판례 보기는 법제처 국가법령정보 인증키(LAW_API_OC)를 설정하면 제공됩니다.")
            detail = svc.get_case(kind, case_id)
            if not detail:
                raise ApiError(404, svc.warnings[0] if svc.warnings else "판례를 찾을 수 없습니다.")
            return self._json(200, {"detail": detail})
        if method == "GET" and path == "/api/law-changes":
            name = (qs.get("name") or [""])[0].strip()[:60]
            if not name:
                raise ApiError(400, "법령명을 입력하세요.")
            svc = LawService(config.law_access)
            got = svc.get_old_and_new(name)
            change = parse_old_and_new(got["data"]) if got else None
            if not change:
                return self._json(404, {"error": f"「{name}」의 개정 전후 비교 자료를 찾지 못했어요. 법령명을 정확히 적었는지 확인하세요.", "warnings": svc.warnings})
            return self._json(200, {"change": change, "source": got["source"], "warnings": svc.warnings})
        m = re.fullmatch(r"/api/raw/([A-Za-z]+\.do)", path)
        if method in ("GET", "HEAD") and m:  # 법령 API 중계: 인증키·등록 IP가 있는 이 서버가 대신 조회(실행판·다른 PC용)
            ok, retry = rate_limit(f"raw:{self._client()}", 120)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            params = {k: v[0][:200] for k, v in qs.items() if v}
            if m.group(1) not in RELAY_PATHS or params.get("target") not in RELAY_TARGETS:
                return self._json(400, {"ok": False, "error": "허용되지 않은 요청입니다."})
            if not config.law_api_oc:
                return self._json(503, {"ok": False, "error": "중계 서버에 인증키(LAW_API_OC)가 설정되어 있지 않습니다."})
            try:
                return self._send(200, relay_raw(m.group(1), params, config.law_api_oc), "application/json; charset=utf-8", None, method == "HEAD")
            except LawApiError as e:
                return self._json(502, {"ok": False, "error": str(e)})
        if method == "POST" and path == "/api/compliance-ai":
            ok, retry = rate_limit(f"{path}:{self._client()}", 5)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            code, payload = compliance_ai(_validate_compliance_ai(self._body()))
            return self._json(code, payload)
        if method == "POST" and path == "/api/amend-ai":
            ok, retry = rate_limit(f"{path}:{self._client()}", 10)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            inp = _validate_amend_ai(self._body())
            p, _ = resolve_provider(config.llm, inp["provider"])
            if p.kind == "rule":
                return self._json(503, {"error": "생성형 AI가 연결되어 있지 않아 개정안을 쓸 수 없어요. ‘A에서 B로’처럼 적거나 개정안을 직접 고쳐 주세요."})
            messages = [{"role": "user", "content": build_amend_prompt(inp)}]
            result, model = {"ok": False, "reason": "응답 없음"}, p.model
            try:
                for attempt in range(2):
                    res = p.generate(system=AMEND_SYSTEM, messages=messages, json_mode=True, temperature=0.1, max_tokens=2000)
                    model = res.get("model") or model
                    try:
                        raw = parse_loose_json(res["text"])
                    except Exception:  # noqa: BLE001 — 형식이 깨진 응답 → 가드에서 '비어 있음'
                        raw = None
                    result = guard_amend(raw, inp)
                    if result["ok"]:
                        return self._json(200, {**result, "retried": attempt > 0, "model": model, "label": p.label})
                    messages += [{"role": "assistant", "content": res["text"]}, {"role": "user", "content": amend_retry(result["reason"])}]
            except Exception as e:  # noqa: BLE001 — 연결 실패는 안내로
                return self._json(502, {"error": f"AI({p.label})에 연결하지 못했어요. 개정안을 직접 고치거나 잠시 후 다시 시도하세요.", "detail": str(e)})
            return self._json(200, {**result, "retried": True, "model": model, "label": p.label})
        if method == "POST" and path == "/api/enact-fill":
            ok, retry = rate_limit(f"{path}:{self._client()}", 10)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            inp = _validate_enact_fill(self._body())
            p, _ = resolve_provider(config.llm, inp["provider"])
            if p.kind == "rule":
                return self._json(503, {"error": "생성형 AI가 연결되어 있지 않아 빈칸을 채울 수 없어요. 표준 문형 초안을 그대로 쓰세요."})
            try:
                res = p.generate(system=FILL_SYSTEM, messages=[{"role": "user", "content": build_fill_prompt(inp)}], json_mode=True, temperature=0.1, max_tokens=3000)
            except Exception as e:  # noqa: BLE001 — 연결 실패는 안내로
                return self._json(502, {"error": f"AI({p.label})에 연결하지 못했어요. 표준 문형 초안을 그대로 쓰거나 잠시 후 다시 시도하세요.", "detail": str(e)})
            try:
                raw = parse_loose_json(res["text"])
            except Exception:  # noqa: BLE001 — 형식이 깨진 응답은 쓰지 않음
                return self._json(502, {"error": f"AI({p.label}) 응답 형식이 올바르지 않아 쓰지 않았어요. 다시 시도하거나 표준 문형 초안을 쓰세요."})
            return self._json(200, {**guard_fill(raw, inp), "model": res.get("model") or p.model, "label": p.label})
        if method == "POST" and path in ("/api/ask", "/api/analyze", "/api/followup"):
            ok, retry = rate_limit(f"{path}:{self._client()}", 20 if path == "/api/analyze" else 30)
            if not ok:
                raise ApiError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {"Retry-After": str(retry)})
            body = self._body()
            if path == "/api/ask":
                a = _validate_ask(body)
                return self._json(200, ask(a["query"], a["mode"], a["provider"]))
            if path == "/api/followup":
                a = _validate_followup(body)
                return self._json(200, followup(a["question"], a["prevQuery"], a["mode"], a["provider"]))
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
                extra = {"Cache-Control": cache}
                if rel.startswith("downloads/"):  # 내려받기 파일은 열지 않고 저장
                    extra["Content-Disposition"] = f'attachment; filename="{DOWNLOAD_NAMES.get(f.name, f.name)}"'
                return self._send(200, f.read_bytes(), ctype, extra, head_only)
        nf = WEB / "404.html"
        return self._send(404, nf.read_bytes() if nf.is_file() else b"Not Found", "text/html; charset=utf-8", None, head_only)


class _Server(ThreadingHTTPServer):
    daemon_threads = True


def make_server(host: str, port: int) -> ThreadingHTTPServer:
    return _Server((host, port), Handler)
