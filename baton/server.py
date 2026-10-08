"""업무바통 웹 서버(FastAPI). 기본은 이 PC(127.0.0.1)에서만 접속 가능."""
from __future__ import annotations

import datetime as dt
import os
import threading
import traceback
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, config, store
from .draft import add_item, answer_question, build_draft, now, update_item
from .export import handover_blocks, manual_blocks, to_baton, to_html, to_ics
from .render import FORMATS
from .ingest import ingest_folder, verify_originals
from .llm import get_client, self_check
from .parsers import SUPPORTED
from .plan import make_plan
from .qa import ask

app = FastAPI(title="업무바통", version=__version__)
STATIC = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

JOBS: dict[str, dict] = {}
MAX_UPLOAD = 500 * 1024 * 1024


def _job(pid: str, **kw):
    JOBS.setdefault(pid, {}).update(kw)


def _load(pid: str) -> dict:
    try:
        return store.load(pid)
    except KeyError:
        raise HTTPException(404, "인수인계 건을 찾을 수 없습니다")


def _source_root(p: dict) -> str:
    return p["source_path"] if p.get("source_mode") == "path" else store.input_dir(p["id"])


def _view(p: dict) -> dict:
    """화면용: 근거조각 본문은 빼고 위치 정보만."""
    v = {k: val for k, val in p.items() if k not in ("chunks",)}
    v["chunk_index"] = {c["id"]: [c["file"], c["where"], c["kind"]] for c in p["chunks"]}
    v["job"] = JOBS.get(p["id"], {})
    return v


# ───────────── 기본
@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))


@app.get("/api/info")
def info():
    s = config.load_settings()
    active = s["llm"]["active"]
    return {"version": __version__, "supported": SUPPORTED, "active_model": active,
            "active_label": s["llm"]["profiles"].get(active, {}).get("label", active),
            "sample_available": os.path.isdir(config.SAMPLE_DIR), "org": s.get("org", {}),
            "samples": {k: {"name": v[1], "from": v[2], "to": v[3], "base": v[4]} for k, v in config.SAMPLES.items() if os.path.isdir(v[0])}}


# ───────────── 설정·모델
@app.get("/api/settings")
def get_settings():
    return {"settings": config.public_settings(), "template": config.load_template()}


@app.post("/api/settings")
async def post_settings(req: Request):
    body = await req.json()
    cur = config.load_settings()
    base = config._read("settings.json", cur)
    if "org" in body:
        base["org"] = body["org"]
    if "llm" in body:
        llm = body["llm"]
        base["llm"]["active"] = llm.get("active", base["llm"]["active"])
        os.environ.pop("BATON_LLM", None)  # 화면에서 고른 모델이 실행 옵션보다 우선
        profiles = {}
        for name, p in llm.get("profiles", {}).items():
            profiles[name] = {k: v for k, v in p.items() if k not in ("api_key", "has_key")}
        if profiles:
            base["llm"]["profiles"] = profiles
        for k in ("timeout_sec", "max_context_chars"):
            if k in llm:
                base["llm"][k] = llm[k]
    secrets = {n: p["api_key"] for n, p in body.get("llm", {}).get("profiles", {}).items() if p.get("api_key")}
    config.save_settings(base, secrets or None)
    if "template" in body:
        config.save_template(body["template"])
    return get_settings()


@app.post("/api/llm/models")
async def llm_models(req: Request):
    """연결한 서버에 실제 등록된 모델 이름 목록(저장 전 주소로도 조회 가능, 키는 보내지 않음)."""
    from .llm import LLMError, OpenAICompatClient

    b = await req.json()
    base = (b.get("base_url") or "").strip()
    if not base:
        raise HTTPException(400, "서버 주소를 입력하세요")
    client = OpenAICompatClient("list", {"type": b.get("type", "openai"), "base_url": base, "model": ""}, timeout=15)
    try:
        return {"models": client.models()}
    except LLMError as e:
        raise HTTPException(502, str(e))


@app.post("/api/llm/check")
async def llm_check(req: Request):
    body = await req.json()
    names = body.get("profiles") or [config.load_settings()["llm"]["active"]]
    results = []
    for n in names:
        try:
            results.append(self_check(n))
        except Exception as e:  # 진단은 실패해도 화면에 결과로 보여준다
            results.append({"profile": n, "ok": False, "tests": [{"name": "오류", "ok": False, "detail": str(e)}]})
    return {"results": results, "at": now()}


# ───────────── 인수인계 건(프로젝트)
@app.get("/api/projects")
def projects():
    return store.list_projects()


def _new_project(name, from_name, to_name, base_date, mode, path="") -> dict:
    s = config.load_settings()
    pid = store.new_id()
    p = {"id": pid, "name": name or "업무 인수인계", "from_name": from_name, "to_name": to_name,
         "base_date": base_date or dt.date.today().isoformat(), "org": s["org"].get("name", ""),
         "dept": s["org"].get("dept", ""), "title": config.load_template().get("title", "업무 인수인계서"),
         "created": now(), "stage": "ingesting", "source_mode": mode, "source_path": path,
         "docs": [], "chunks": [], "skipped": [], "draft": None, "handover": {}, "audit": [], "qa_log": []}
    store.audit(p, "시스템", "인수인계 건 생성", f"{mode}:{path}")
    store.save(p)
    return p


def _run_ingest(pid: str, then_draft: bool = True):
    try:
        p = store.load(pid)
        root = _source_root(p)
        _job(pid, state="running", step="자료 읽는 중", frac=0.0, error="")
        res = ingest_folder(root, progress=lambda i, n, f: _job(pid, step=f"자료 읽는 중 ({i}/{n}) {f}", frac=0.3 * i / max(n, 1)))
        p.update(docs=res["docs"], chunks=res["chunks"], skipped=res["skipped"], stage="ingested")
        p["integrity"] = verify_originals(root, res["docs"])
        # 지식 릴레이: 자료 속 바통 파일의 계보를 이어받는다
        lineage = []
        for d in res["docs"]:
            for g in d.get("info", {}).get("lineage", []):
                if g not in lineage:
                    lineage.append(g)
        p["lineage"] = lineage
        store.audit(p, "시스템", "자료 투입", f"{len(res['docs'])}개 파일, 근거조각 {len(res['chunks'])}개")
        store.save(p)
        if then_draft and res["chunks"]:
            _run_draft(pid, offset=0.3)
        else:
            _job(pid, state="done", step="완료", frac=1.0)
    except Exception as e:
        traceback.print_exc()
        _job(pid, state="error", error=f"{type(e).__name__}: {e}")


def _run_draft(pid: str, offset: float = 0.0, profile: str | None = None):
    try:
        p = store.load(pid)
        client = get_client(profile)
        _job(pid, state="running", step="초안 준비", frac=offset, error="", model=client.label)
        draft = build_draft(p, client, progress=lambda m, f: _job(pid, step=m, frac=offset + (1 - offset) * f))
        with store.lock(pid):
            p = store.load(pid)
            p["draft"], p["stage"] = draft, "review"
            p["integrity"] = verify_originals(_source_root(p), p["docs"])
            store.audit(p, "시스템", "초안 생성", f"{draft['generated_by']} / 항목 {sum(len(s['items']) for s in draft['sections'])}개")
            store.save(p)
        _job(pid, state="done", step="완료", frac=1.0)
    except Exception as e:
        traceback.print_exc()
        _job(pid, state="error", error=f"{type(e).__name__}: {e}")


def _start(target, *args):
    threading.Thread(target=target, args=args, daemon=True).start()


@app.post("/api/projects/path")
async def create_from_path(req: Request):
    b = await req.json()
    path = os.path.abspath(os.path.expanduser(b.get("path", "").strip().strip('"')))
    if not os.path.isdir(path):
        raise HTTPException(400, "폴더를 찾을 수 없습니다: " + path)
    p = _new_project(b.get("name"), b.get("from_name", ""), b.get("to_name", ""), b.get("base_date"), "path", path)
    _start(_run_ingest, p["id"])
    return {"id": p["id"]}


@app.post("/api/projects/demo")
async def create_demo(req: Request):
    b = await req.json() if (await req.body()) else {}
    sample = config.SAMPLES.get(b.get("sample") or "security")
    if not sample or not os.path.isdir(sample[0]):
        raise HTTPException(404, "샘플 폴더가 없습니다(python sample_data/make_samples.py 실행)")
    folder, name, frm, to, base, org, dept = sample
    p = _new_project(name, frm, to, base, "path", folder)
    p.update(org=org, dept=dept)
    store.save(p)
    _start(_run_ingest, p["id"])
    return {"id": p["id"]}


# ───────────── 문서시스템 연계(모의 API)
# 실제 구축 시 기관 문서관리시스템(온나라 등) API로 바꾸는 자리. 목록 조회 → 본문 내려받기 두 단계만 쓴다.
def _mock_docs():
    import hashlib

    root = config.SAMPLES["facility"][0]
    out = []
    for d, _, files in os.walk(root):
        for fn in sorted(files):
            full = os.path.join(d, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            out.append({"id": hashlib.sha1(rel.encode()).hexdigest()[:12], "title": fn, "folder": os.path.dirname(rel),
                        "owner": "김도윤", "modified": dt.datetime.fromtimestamp(os.path.getmtime(full)).strftime("%Y-%m-%d %H:%M"),
                        "size": os.path.getsize(full), "_path": full})
    return out


@app.get("/mock-docsystem/documents")
def mock_doc_list(owner: str = ""):
    docs = [d for d in _mock_docs() if not owner or owner in d["owner"]]
    return {"documents": [{k: v for k, v in d.items() if not k.startswith("_")} for d in docs]}


@app.get("/mock-docsystem/documents/{doc_id}/content")
def mock_doc_content(doc_id: str):
    import base64

    d = next((x for x in _mock_docs() if x["id"] == doc_id), None)
    if not d:
        raise HTTPException(404, "문서 없음")
    with open(d["_path"], "rb") as f:
        return {"title": d["title"], "folder": d["folder"], "content_b64": base64.b64encode(f.read()).decode()}


def _run_docsystem(pid: str, base: str, owner: str):
    """문서시스템 API에서 목록을 받아 사본을 작업 폴더에 내려받은 뒤 일반 자료처럼 분석한다(원본 시스템은 읽기만)."""
    import base64
    import json as _json
    import urllib.parse
    import urllib.request

    try:
        _job(pid, state="running", step="문서시스템에서 목록 조회", frac=0.02, error="")
        q = urllib.parse.urlencode({"owner": owner}) if owner else ""
        with urllib.request.urlopen(f"{base.rstrip('/')}/documents?{q}", timeout=30) as r:
            docs = _json.loads(r.read().decode("utf-8"))["documents"]
        root = store.input_dir(pid)
        for i, d in enumerate(docs, 1):
            _job(pid, step=f"문서시스템에서 내려받는 중 ({i}/{len(docs)}) {d['title']}", frac=0.02 + 0.2 * i / max(1, len(docs)))
            with urllib.request.urlopen(f"{base.rstrip('/')}/documents/{d['id']}/content", timeout=60) as r:
                body = _json.loads(r.read().decode("utf-8"))
            parts = [x for x in (d.get("folder", "") + "/" + d["title"]).replace("\\", "/").split("/") if x not in ("", ".", "..")]
            dest = os.path.join(root, *parts)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(base64.b64decode(body["content_b64"]))
        p = store.load(pid)
        store.audit(p, "시스템", "문서시스템 연계", f"{base} · {owner or '전체'} · {len(docs)}건")
        store.save(p)
        _run_ingest(pid)
    except Exception as e:
        traceback.print_exc()
        _job(pid, state="error", error=f"문서시스템 연계 실패: {type(e).__name__}: {e}")


@app.post("/api/projects/docsystem")
async def create_from_docsystem(req: Request):
    b = await req.json()
    base = (b.get("base_url") or "").strip() or str(req.base_url).rstrip("/") + "/mock-docsystem"
    owner = (b.get("owner") or "").strip()
    p = _new_project(b.get("name") or f"{owner or '전임자'} 업무 인수인계", b.get("from_name") or owner, b.get("to_name", ""),
                     b.get("base_date"), "upload")
    p["source_desc"] = f"문서시스템 연계: {base}"
    store.save(p)
    _start(_run_docsystem, p["id"], base, owner)
    return {"id": p["id"]}


@app.post("/api/projects/upload")
async def create_from_upload(files: list[UploadFile] = File(...), paths: list[str] = Form(...),
                             name: str = Form(""), from_name: str = Form(""), to_name: str = Form(""),
                             base_date: str = Form("")):
    p = _new_project(name, from_name, to_name, base_date, "upload")
    root = store.input_dir(p["id"])
    total = 0
    for f, rel in zip(files, paths):
        parts = [x for x in rel.replace("\\", "/").split("/") if x not in ("", ".", "..")]
        if not parts:
            continue
        dest = os.path.join(root, *parts)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        data = await f.read()
        total += len(data)
        if total > MAX_UPLOAD:
            store.delete(p["id"])
            raise HTTPException(413, "자료가 너무 큽니다(최대 500MB)")
        with open(dest, "wb") as out:
            out.write(data)
    _start(_run_ingest, p["id"])
    return {"id": p["id"]}


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _view(_load(pid))


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    _load(pid)
    store.delete(pid)
    return {"ok": True}


@app.get("/api/projects/{pid}/job")
def job(pid: str):
    return JOBS.get(pid, {"state": "idle"})


@app.post("/api/projects/{pid}/draft")
async def redraft(pid: str, req: Request):
    b = await req.json() if (await req.body()) else {}
    _load(pid)
    if JOBS.get(pid, {}).get("state") == "running":
        raise HTTPException(409, "이미 작업 중입니다")
    _job(pid, state="running", step="초안 준비", frac=0.0)
    _start(_run_draft, pid, 0.0, b.get("profile"))
    return {"ok": True}


@app.get("/api/projects/{pid}/chunks/{cid}")
def chunk(pid: str, cid: str):
    p = _load(pid)
    if cid.startswith("Q") and p.get("draft"):
        q = next((x for x in p["draft"]["questions"] if x["id"] == cid), None)
        if q:
            return {"id": cid, "file": "전임자 인터뷰", "where": q.get("answered_at", ""), "kind": "oral",
                    "text": f"질문: {q['q']}\n\n답변: {q.get('answer') or '(미답변)'}"}
    c = next((x for x in p["chunks"] if x["id"] == cid), None)
    if not c:
        raise HTTPException(404, "근거를 찾을 수 없습니다")
    doc = next((d for d in p["docs"] if d["id"] == c["doc_id"]), {})
    return {**c, "doc": {k: doc.get(k) for k in ("file", "kind_label", "mtime", "sha256", "info")}}


@app.get("/api/projects/{pid}/docs/{doc_id}")
def doc_content(pid: str, doc_id: str):
    """자료 목록의 '내용 보기': 그 파일에서 읽어 낸 근거조각 전체(민감정보 가림 후)."""
    p = _load(pid)
    d = next((x for x in p["docs"] if x["id"] == doc_id), None)
    if not d:
        raise HTTPException(404, "자료를 찾을 수 없습니다")
    return {"doc": {k: d.get(k) for k in ("file", "kind_label", "mtime", "sha256", "masked", "info")},
            "chunks": [{"id": c["id"], "where": c["where"], "text": c["text"]} for c in p["chunks"] if c["doc_id"] == doc_id]}


# ───────────── 전임자 검수
@app.patch("/api/projects/{pid}/items/{item_id}")
async def patch_item(pid: str, item_id: str, req: Request):
    b = await req.json()
    with store.lock(pid):
        p = _load(pid)
        try:
            it = update_item(p["draft"], item_id, b.get("text"), b.get("status"), b.get("who", "전임자"), b.get("resolved"),
                             bool(b.get("unresolve")))
        except KeyError:
            raise HTTPException(404, "항목 없음")
        store.audit(p, b.get("who", "전임자"), f"항목 {b.get('status') or '수정'}", item_id)
        store.save(p)
    return it


@app.post("/api/projects/{pid}/sections/{sid}/items")
async def post_item(pid: str, sid: str, req: Request):
    b = await req.json()
    if not b.get("text", "").strip():
        raise HTTPException(400, "내용을 입력하세요")
    with store.lock(pid):
        p = _load(pid)
        it = add_item(p["draft"], sid, b["text"])
        store.audit(p, "전임자", "항목 추가", it["id"])
        store.save(p)
    return it


@app.post("/api/projects/{pid}/questions/{qid}/answer")
async def post_answer(pid: str, qid: str, req: Request):
    b = await req.json()
    if not b.get("answer", "").strip():
        raise HTTPException(400, "답변을 입력하세요")
    with store.lock(pid):
        p = _load(pid)
        q = answer_question(p["draft"], qid, b["answer"])
        store.audit(p, "전임자", "인터뷰 답변", qid)
        store.save(p)
    return q


@app.post("/api/projects/{pid}/questions")
async def post_question(pid: str, req: Request):
    """후임자가 자료로 답을 못 찾은 질문을 전임자에게 보낸다(질문 바구니)."""
    b = await req.json()
    if not b.get("q", "").strip():
        raise HTTPException(400, "질문을 입력하세요")
    with store.lock(pid):
        p = _load(pid)
        qs = p["draft"]["questions"]
        q = {"id": f"Q{len(qs) + 1:03d}", "q": b["q"].strip(), "why": "후임자 질문", "section": b.get("section", "tips"),
             "sources": [], "type": "successor", "origin": "successor", "answer": "", "status": "open",
             "asked_by": "successor", "created": now()}
        qs.append(q)
        store.audit(p, "후임자", "전임자에게 질문", q["id"])
        store.save(p)
    return q


# ───────────── 후임자
@app.post("/api/projects/{pid}/ask")
async def post_ask(pid: str, req: Request):
    b = await req.json()
    question = b.get("question", "").strip()
    if not question:
        raise HTTPException(400, "질문을 입력하세요")
    p = _load(pid)
    res = ask(p, question, get_client())
    with store.lock(pid):
        p = _load(pid)
        p.setdefault("qa_log", []).append({"at": now(), "q": question, **res})
        store.save(p)
    return res


@app.get("/api/projects/{pid}/plan")
def get_plan(pid: str):
    p = _load(pid)
    if not p.get("draft"):
        raise HTTPException(400, "초안이 아직 없습니다")
    base = dt.date.fromisoformat(p.get("base_date") or dt.date.today().isoformat())
    return make_plan(p["draft"], p["docs"], base)


@app.post("/api/projects/{pid}/handover")
async def handover(pid: str, req: Request):
    b = await req.json()
    role = b.get("role")
    if role not in ("from", "to"):
        raise HTTPException(400, "role은 from/to")
    with store.lock(pid):
        p = _load(pid)
        h = p.setdefault("handover", {})
        if b.get("cancel"):
            h.pop(f"{role}_signed_at", None)
        else:
            if role == "to" and not h.get("from_signed_at"):
                raise HTTPException(400, "전임자 확인이 먼저 필요합니다")
            h[f"{role}_signed_at"] = now()
            h[f"{role}_name"] = b.get("name") or p.get(f"{role}_name", "")
            p["integrity"] = verify_originals(_source_root(p), p["docs"])
        if h.get("from_signed_at") and h.get("to_signed_at"):
            p["stage"] = "done"
        store.audit(p, "전임자" if role == "from" else "후임자", "바통 터치" + (" 취소" if b.get("cancel") else ""), "")
        store.save(p)
    return p["handover"]


@app.get("/api/projects/{pid}/export")
def export(pid: str, fmt: str = "docx", doc: str = "handover", start: str = "", level: str = "new"):
    """doc: handover(인수인계서) | manual(후임자 업무매뉴얼), fmt: hwpx | docx | md | html | ics | baton"""
    p = _load(pid)
    if not p.get("draft"):
        raise HTTPException(400, "초안이 아직 없습니다")
    name = p.get("name", "")
    if fmt == "ics":
        data, mt, fname = to_ics(p).encode("utf-8"), "text/calendar; charset=utf-8", f"업무달력_{name}.ics"
    elif fmt == "baton":
        data, mt, fname = to_baton(p).encode("utf-8"), "application/json; charset=utf-8", f"{name}_{p.get('from_name', '')}.baton"
    elif fmt == "html":
        return Response(to_html(p), media_type="text/html; charset=utf-8")
    elif fmt in FORMATS:
        blocks = manual_blocks(p, start or None, level) if doc == "manual" else handover_blocks(p)
        fn, mt = FORMATS[fmt]
        try:
            data = fn(blocks)
        except ImportError:
            raise HTTPException(500, "한글(hwpx) 저장에 필요한 python-hwpx 가 설치되지 않았습니다. run.bat --reinstall 을 실행하거나 Word로 내려받으세요.")
        fname = f"{'후임자_업무매뉴얼' if doc == 'manual' else '인수인계서'}_{name}.{fmt}"
    else:
        raise HTTPException(400, f"지원하지 않는 형식: {fmt}")
    store_audit = f"{doc}.{fmt}"
    with store.lock(pid):
        q = store.load(pid)
        store.audit(q, "사용자", "내보내기", store_audit)
        store.save(q)
    return Response(data, media_type=mt,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"})


@app.exception_handler(Exception)
async def on_error(req: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse({"detail": f"서버 오류: {type(exc).__name__}: {exc}"}, status_code=500)
