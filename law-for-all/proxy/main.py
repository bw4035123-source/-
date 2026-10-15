"""법이음 법령 API 중계 서버(FastAPI)

브라우저 → (이 서버) → 국가법령정보센터 Open API(DRF)

- 인증키(OC)는 .env.local 에서만 읽고, 응답·오류·로그 어디에도 내보내지 않는다.
- 국가법령정보센터는 '이 서버가 돌아가는 PC'의 IP만 보므로, 그 PC의 IP만 등록하면 된다.
  (Cloudflare Tunnel 로 외부에 공개해도 법령센터로 나가는 요청은 여전히 이 PC에서 출발)
- 요청 호스트는 www.law.go.kr 로 고정, target 은 허용 목록만 통과(임의 주소 중계 방지).

실행:  uvicorn main:app --host 0.0.0.0 --port 8787
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

HERE = Path(__file__).resolve().parent
DRF_BASE = "https://www.law.go.kr/DRF"


# ───────────────────────── 설정(.env.local)
def load_dotenv() -> list[str]:
    """현재 폴더 → proxy/ → 프로젝트 루트 → python/ 순으로 .env.local, .env 를 읽는다.
    이미 설정된 환경변수가 우선한다. 읽은 파일 경로를 돌려준다(키 값은 아님)."""
    loaded: list[str] = []
    dirs = [Path.cwd(), HERE, HERE.parent, HERE.parent / "python"]
    seen: set[Path] = set()
    for d in dirs:
        for name in (".env.local", ".env"):
            p = (d / name).resolve()
            if p in seen or not p.is_file():
                continue
            seen.add(p)
            for line in p.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
            loaded.append(str(p))
    return loaded


ENV_FILES = load_dotenv()


def env(k: str, d: str = "") -> str:
    return (os.environ.get(k) or d).strip()


OC = env("LAW_API_OC") or env("LAW_OC")
CORS_ORIGINS = [o.strip() for o in env("CORS_ORIGINS", "*").split(",") if o.strip()]
PROXY_TOKEN = env("PROXY_TOKEN")  # 설정하면 X-Proxy-Token 헤더(또는 ?token=)가 일치해야 호출 가능
RATE_PER_MIN = int(env("RATE_LIMIT_PER_MIN", "300") or 300)  # 앱 서버 한 대가 질문당 여러 건을 부르므로 넉넉히
CACHE_TTL = int(env("CACHE_TTL_SEC", str(60 * 60 * 6)) or 21600)
TIMEOUT = float(env("UPSTREAM_TIMEOUT_SEC", "15") or 15)
RETRIES = 2


def masked(v: str) -> str:
    return "" if not v else (v[:2] + "*" * max(len(v) - 2, 3))


# 검색 target → (응답 목록 키, 상세 조회 가능 여부)
SEARCH_TARGETS: dict[str, str] = {
    "law": "law",  # 현행 법령
    "prec": "prec",  # 판례
    "expc": "expc",  # 법령해석례
    "admrul": "admrul",  # 행정규칙(훈령·예규·고시)
    "ordin": "law",  # 자치법규(조례·규칙) — 목록 키가 law
    "detc": "Detc",  # 헌재결정례
}
DETAIL_TARGETS = {"law", "prec", "expc", "admrul", "ordin", "detc"}


# ───────────────────────── 앱
@asynccontextmanager
async def lifespan(_: FastAPI):
    global _client
    _client = httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": "law-on-proxy/1.0"}, follow_redirects=False)
    print(f"[법이음 프록시] 인증키(OC): {'설정됨 ' + masked(OC) if OC else '없음 — .env.local 에 LAW_API_OC=... 를 넣으세요'}")
    print(f"[법이음 프록시] 읽은 설정 파일: {', '.join(ENV_FILES) or '없음'}")
    print(f"[법이음 프록시] CORS 허용: {', '.join(CORS_ORIGINS)} · 접근 토큰: {'사용' if PROXY_TOKEN else '미사용'}")
    yield
    await _client.aclose()


_client: httpx.AsyncClient | None = None
_cache: dict[str, tuple[float, Any]] = {}
_hits: dict[str, deque] = defaultdict(deque)

app = FastAPI(
    lifespan=lifespan,
    title="법이음 법령 API 중계 서버",
    description="국가법령정보센터 Open API(DRF)를 실시간 조회해 JSON으로 돌려주는 백엔드 프록시. 인증키는 서버에만 보관됩니다.",
    version="1.0.0",
)

@app.middleware("http")
async def guard(request: Request, call_next):
    """/api/* 에 접근 토큰·분당 호출 제한 적용(공개 URL로 열었을 때 인증키 사용량 보호)"""
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        if PROXY_TOKEN and PROXY_TOKEN not in (request.headers.get("x-proxy-token"), request.query_params.get("token")):
            return JSONResponse({"ok": False, "error": "접근 토큰이 올바르지 않습니다."}, status_code=401)
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
        now, q = time.time(), _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_PER_MIN:
            return JSONResponse({"ok": False, "error": "요청이 너무 많습니다. 잠시 후 다시 시도하세요."}, status_code=429)
        q.append(now)
    return await call_next(request)


# CORS 는 가장 바깥에서 동작하도록 마지막에 등록(401·429 응답에도 CORS 헤더가 붙게)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


# ───────────────────────── 국가법령정보센터 호출
class UpstreamError(Exception):
    def __init__(self, msg: str, status: int = 502):
        super().__init__(msg)
        self.status = status


def _scrub(text: str) -> str:
    """오류 문구에 인증키가 섞여 나가지 않도록 제거"""
    return text.replace(OC, "***") if OC else text


async def drf_get(path: str, params: dict[str, Any]) -> Any:
    if not OC:
        raise UpstreamError("서버에 인증키(LAW_API_OC)가 설정되지 않았습니다. .env.local 을 확인하세요.", 503)
    params = {k: v for k, v in params.items() if v not in (None, "")}
    cache_key = path + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    assert _client is not None
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            r = await _client.get(f"{DRF_BASE}/{path}", params={"OC": OC, "type": "JSON", **params})
            break
        except httpx.HTTPError as e:  # 법령센터가 간헐적으로 연결을 끊음 → 짧게 재시도
            last = e
            if attempt < RETRIES:
                await asyncio.sleep(0.6 * (attempt + 1))
    else:
        if hit:
            return hit[1]
        raise UpstreamError(_scrub(f"국가법령정보센터 연결 실패: {type(last).__name__}"), 504)

    if r.status_code != 200:
        raise UpstreamError(f"국가법령정보센터 응답 오류(HTTP {r.status_code})")
    try:
        data = r.json()
    except ValueError:
        hint = re.sub(r"<[^>]+>|\s+", " ", r.text).strip()[:120]
        raise UpstreamError(_scrub(f"JSON이 아닌 응답입니다. OC 인증키와 등록 IP를 확인하세요. ({hint})"))
    # 미등록 IP·잘못된 키는 HTTP 200 + {"result": "...", "msg": "..."} 로 온다
    if isinstance(data, dict) and "result" in data and set(data) <= {"result", "msg"}:
        raise UpstreamError(_scrub(f"인증 실패: {data.get('result', '')} {data.get('msg', '')}".strip()) + " — 이 PC의 공인 IP가 open.law.go.kr 에 등록되어 있는지 확인하세요.", 403)
    _cache[cache_key] = (time.time(), data)
    if len(_cache) > 2000:  # 단순 상한
        for k in list(_cache)[:500]:
            _cache.pop(k, None)
    return data


# ───────────────────────── 응답 정리(키 이름 기준 탐색 — 응답 구조가 조금 달라도 동작)
def find_all(obj: Any, key: str) -> list:
    out: list = []

    def walk(o: Any) -> None:
        if isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, dict):
            for k, v in o.items():
                if k == key:
                    out.extend(v if isinstance(v, list) else [v])
                else:
                    walk(v)

    walk(obj)
    return out


def txt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return "\n".join(x for x in (txt(i) for i in v) if x)
    if isinstance(v, dict):
        return txt(v.get("content", ""))
    return str(v).strip()


def as_list(v: Any) -> list:
    return v if isinstance(v, list) else ([v] if v else [])


def rec(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def clean_html(raw: str) -> str:
    t = re.sub(r"<br\s*/?>", "\n", raw or "", flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    for a, b in (("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"), ("&amp;", "&")):
        t = t.replace(a, b)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+\n", "\n", t)).strip()


def first(it: dict, *keys: str) -> str:
    for k in keys:
        v = txt(it.get(k))
        if v:
            return v
    return ""


def normalize_item(target: str, it: dict) -> dict:
    """target 별 목록 항목을 공통 형태로(원본 필드는 raw 에 그대로)"""
    if target in ("law", "ordin"):
        base = {"id": first(it, "법령ID", "자치법규ID"), "mst": first(it, "법령일련번호", "자치법규일련번호"),
                "title": first(it, "법령명한글", "자치법규명"), "kind": first(it, "법령구분명", "자치법규종류"),
                "agency": first(it, "소관부처명", "지자체기관명"), "date": first(it, "시행일자"), "promulgated": first(it, "공포일자")}
    elif target == "prec":
        base = {"id": first(it, "판례일련번호"), "title": first(it, "사건명"), "caseNo": first(it, "사건번호"),
                "agency": first(it, "법원명"), "date": first(it, "선고일자"), "kind": first(it, "사건종류명", "판결유형")}
    elif target == "expc":
        base = {"id": first(it, "법령해석례일련번호"), "title": first(it, "안건명"), "caseNo": first(it, "안건번호"),
                "agency": first(it, "회신기관명", "질의기관명"), "date": first(it, "회신일자")}
    elif target == "admrul":
        base = {"id": first(it, "행정규칙일련번호"), "title": first(it, "행정규칙명"), "kind": first(it, "행정규칙종류"),
                "agency": first(it, "소관부처명"), "date": first(it, "시행일자", "발령일자")}
    else:  # detc
        base = {"id": first(it, "헌재결정례일련번호"), "title": first(it, "사건명"), "caseNo": first(it, "사건번호"), "date": first(it, "종국일자")}
    return {**base, "raw": it}


def parse_articles(data: Any) -> list[dict]:
    arts = []
    for u in map(rec, find_all(data, "조문단위")):
        if txt(u.get("조문여부")) not in ("", "조문"):
            continue
        lines = [txt(u.get("조문내용"))]
        for hang in map(rec, as_list(u.get("항"))):
            lines.append(txt(hang.get("항내용")))
            for ho in map(rec, as_list(hang.get("호"))):
                lines.append("  " + txt(ho.get("호내용")))
                for mok in map(rec, as_list(ho.get("목"))):
                    lines.append("    " + txt(mok.get("목내용")))
        no, branch = txt(u.get("조문번호")), txt(u.get("조문가지번호"))
        if not no:
            continue
        arts.append({"no": f"{no}의{branch}" if branch and branch != "0" else no, "title": txt(u.get("조문제목")),
                     "text": "\n".join(l for l in lines if l.strip())})
    return arts


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fail(e: UpstreamError) -> JSONResponse:
    return JSONResponse({"ok": False, "error": str(e), "fetchedAt": now_iso()}, status_code=e.status)


# ───────────────────────── 엔드포인트
@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(HERE / "static" / "index.html")


@app.get("/health", summary="서버 상태(인증키 설정 여부)")
async def health():
    return {"ok": True, "service": "law-on-proxy", "ocConfigured": bool(OC), "oc": masked(OC),
            "tokenRequired": bool(PROXY_TOKEN), "time": now_iso()}


@app.get("/api/health/live", summary="국가법령정보센터 실제 연결 확인")
async def health_live():
    t0 = time.perf_counter()
    try:
        data = await drf_get("lawSearch.do", {"target": "law", "query": "민법", "display": 1})
        n = len(find_all(data, "law"))
        return {"ok": n > 0, "message": "국가법령정보센터 실시간 연결 성공" if n else "응답은 왔지만 결과가 비었습니다.",
                "elapsedMs": round((time.perf_counter() - t0) * 1000)}
    except UpstreamError as e:
        return fail(e)


@app.get("/api/search", summary="법령·판례·해석례·행정규칙·자치법규 검색")
async def search(
    query: str = Query(..., min_length=1, max_length=100, description="검색어 (예: 주택임대차, 층간소음)"),
    target: str = Query("law", description="law | prec | expc | admrul | ordin | detc"),
    display: int = Query(20, ge=1, le=100),
    page: int = Query(1, ge=1, le=1000),
    search: int = Query(1, ge=1, le=2, description="1=제목 검색, 2=본문 검색"),
):
    if target not in SEARCH_TARGETS:
        raise HTTPException(400, f"지원하지 않는 target 입니다: {target}")
    try:
        data = await drf_get("lawSearch.do", {"target": target, "query": query, "display": display, "page": page, "search": search})
    except UpstreamError as e:
        return fail(e)
    items = [normalize_item(target, rec(x)) for x in find_all(data, SEARCH_TARGETS[target]) if isinstance(x, dict)]
    if not items and search == 1 and target in ("prec", "expc", "detc"):
        # 판례 제목에는 '층간소음' 같은 생활어가 잘 안 나옴 → 본문 검색으로 한 번 더
        search = 2
        try:
            data = await drf_get("lawSearch.do", {"target": target, "query": query, "display": display, "page": page, "search": 2})
        except UpstreamError as e:
            return fail(e)
        items = [normalize_item(target, rec(x)) for x in find_all(data, SEARCH_TARGETS[target]) if isinstance(x, dict)]
    total = next((txt(v) for v in find_all(data, "totalCnt")), str(len(items)))
    return {"ok": True, "source": "law.go.kr", "target": target, "query": query, "page": page,
            "searchMode": "본문" if search == 2 else "제목", "total": int(total) if total.isdigit() else len(items), "count": len(items), "items": items, "fetchedAt": now_iso()}


@app.get("/api/law", summary="법령 본문(조문) 조회")
async def law_detail(
    id: str | None = Query(None, pattern=r"^\d{1,20}$", description="법령ID"),
    mst: str | None = Query(None, pattern=r"^\d{1,20}$", description="법령일련번호(MST)"),
    article: str | None = Query(None, pattern=r"^\d{1,4}(의\d{1,3})?$", description="특정 조문만 (예: 3, 3의2)"),
):
    if not (id or mst):
        raise HTTPException(400, "id 또는 mst 중 하나가 필요합니다.")
    try:
        data = await drf_get("lawService.do", {"target": "law", "ID": id, "MST": mst})
    except UpstreamError as e:
        return fail(e)
    basic = rec((find_all(data, "기본정보") or [None])[0])
    arts = parse_articles(data)
    if article:
        arts = [a for a in arts if a["no"] == article]
    return {
        "ok": True, "source": "law.go.kr", "id": id, "mst": mst,
        "name": txt(basic.get("법령명_한글")), "kind": txt(basic.get("법종구분")), "ministry": txt(basic.get("소관부처")),
        "effectiveDate": txt(basic.get("시행일자")), "promulgationDate": txt(basic.get("공포일자")),
        "revisionReason": clean_html("\n".join(txt(x) for x in find_all(data, "제개정이유내용"))) or None,
        "articleCount": len(arts), "articles": arts, "fetchedAt": now_iso(),
    }


@app.get("/api/case", summary="판례·법령해석례·헌재결정례 상세")
async def case_detail(
    id: str = Query(..., pattern=r"^\d{1,20}$", description="판례일련번호 / 법령해석례일련번호"),
    target: str = Query("prec", description="prec | expc | detc"),
):
    if target not in ("prec", "expc", "detc"):
        raise HTTPException(400, "target 은 prec, expc, detc 중 하나입니다.")
    try:
        data = await drf_get("lawService.do", {"target": target, "ID": id})
    except UpstreamError as e:
        return fail(e)
    d = rec(data)
    body = rec(next(iter(d.values()), {})) if len(d) == 1 else d
    fields = {k: clean_html(txt(v)) for k, v in body.items() if not isinstance(v, (dict, list)) or txt(v)}
    return {"ok": True, "source": "law.go.kr", "target": target, "id": id,
            "title": fields.get("사건명") or fields.get("안건명") or "", "fields": fields, "fetchedAt": now_iso()}


@app.get("/api/raw/{path}", summary="원본 응답 그대로(개발·디버깅용)")
async def raw(path: str, request: Request):
    """lawSearch.do / lawService.do 만 허용. OC·type 은 서버가 붙인다."""
    if path not in ("lawSearch.do", "lawService.do"):
        raise HTTPException(400, "lawSearch.do 또는 lawService.do 만 허용됩니다.")
    params = {k: v for k, v in request.query_params.items() if k not in ("OC", "type", "token")}
    if params.get("target") not in SEARCH_TARGETS.keys() | DETAIL_TARGETS:
        raise HTTPException(400, "허용되지 않은 target 입니다.")
    try:
        return await drf_get(path, params)
    except UpstreamError as e:
        return fail(e)
