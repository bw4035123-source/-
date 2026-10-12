"""다이수 웹 서버(FastAPI). 화면은 static/ 의 순수 HTML·JS(외부 CDN 없음, 폐쇄망 동작)."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import threading
import urllib.parse
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, engine, llm, qa, reports, schedule
from .readers import SUPPORTED
from .render import FORMATS

app = FastAPI(title="다이수", docs_url=None, redoc_url=None, openapi_url=None)
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
PROJECTS = os.path.join(config.WORKSPACE, "projects")
LOCK = threading.Lock()
MAX_UPLOAD = 500 * 1024 * 1024


# ───────────── 보안: Host 허용 목록 + 다른 사이트에서 보낸 요청 차단 + JSON 형식 강제
def allowed_hosts() -> set[str]:
    extra = {h.strip().lower() for h in os.environ.get("DAISU_ALLOWED_HOSTS", "").split(",") if h.strip()}
    return {"127.0.0.1", "localhost", "[::1]", "::1", "testserver"} | extra


def _hostname(hostport: str) -> str:
    hostport = (hostport or "").strip().lower()
    if hostport.startswith("["):
        return hostport.split("]")[0] + "]"
    return hostport.rsplit(":", 1)[0] if hostport.count(":") == 1 else hostport


@app.middleware("http")
async def guard(request: Request, call_next):
    host = request.headers.get("host", "")
    if _hostname(host) not in allowed_hosts():  # DNS 리바인딩 방지
        return JSONResponse({"detail": "허용되지 않은 주소로 접속했습니다."}, status_code=403)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin and origin != "null":
            o = urllib.parse.urlparse(origin)
            if (o.netloc or "").lower() != host.lower():
                return JSONResponse({"detail": "다른 사이트에서 보낸 요청은 받지 않습니다."}, status_code=403)
        elif origin == "null" or request.headers.get("sec-fetch-site") in ("cross-site", "same-site"):
            return JSONResponse({"detail": "다른 사이트에서 보낸 요청은 받지 않습니다."}, status_code=403)
        ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
        has_body = request.headers.get("content-length", "0") not in ("", "0") or request.headers.get("transfer-encoding")
        if has_body and ctype not in ("application/json", "multipart/form-data"):
            return JSONResponse({"detail": "JSON 형식 요청만 받습니다."}, status_code=415)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


async def body(req: Request) -> dict:
    try:
        data = await req.json()
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        raise HTTPException(400, "요청 형식이 올바르지 않습니다.")
    if not isinstance(data, dict):
        raise HTTPException(400, "요청 형식이 올바르지 않습니다.")
    return data


# ───────────── 프로젝트 저장소
def _pdir(pid: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{8}", pid or ""):
        raise HTTPException(404, "없는 작업입니다.")
    return os.path.join(PROJECTS, pid)


def load(pid: str) -> dict:
    p = os.path.join(_pdir(pid), "project.json")
    if not os.path.exists(p):
        raise HTTPException(404, "없는 작업입니다.")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(project: dict) -> None:
    d = _pdir(project["id"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "project.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(d, "project.json"))


_RES: dict = {}


def result(project: dict) -> dict:
    key = (project["id"], project.get("version", 0), project.get("base_date"), project.get("year"), _rules_stamp())
    if key not in _RES:
        _RES.clear() if len(_RES) > 8 else None
        _RES[key] = engine.compute(project)
    return _RES[key]


def _rules_stamp():
    p = os.path.join(config.CONFIG, "rules.local.json")
    return os.path.getmtime(p) if os.path.exists(p) else 0


def bump(project: dict, what: str) -> None:
    project["version"] = project.get("version", 0) + 1
    project.setdefault("log", []).append({"at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "what": what})
    save(project)


def new_project(name: str, base_date: str | None) -> dict:
    pid = uuid.uuid4().hex[:8]
    return {"id": pid, "name": name or "법정의무교육 관리", "created": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "base_date": base_date or dt.date.today().isoformat(), "files": [], "overrides": {"person": {}, "course": {}},
            "version": 0, "log": []}


def _safe_rel(rel: str) -> str:
    parts = [p for p in re.split(r"[\\/]+", rel or "") if p not in ("", ".", "..")]
    return "/".join(re.sub(r'[<>:"|?*\x00-\x1f]', "_", p) for p in parts)[-240:]


def add_folder(project: dict, src_dir: str) -> int:
    dst_root = os.path.join(_pdir(project["id"]), "files")
    n = 0
    for root, _, names in os.walk(src_dir):
        for nm in sorted(names):
            if os.path.splitext(nm)[1].lower() not in SUPPORTED or nm.startswith(("~$", ".")):
                continue
            src = os.path.join(root, nm)
            rel = _safe_rel(os.path.relpath(src, src_dir))
            dst = os.path.join(dst_root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            project["files"].append(engine.file_entry(dst, rel) | {"origin_sha": engine.sha256(src)})
            n += 1
    return n


# ───────────── 화면·정보
@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-store"})


@app.get("/api/info")
def info():
    s = config.settings()
    prof = s["profiles"].get(s.get("active_profile"), {})
    return {"version": config.VERSION, "org": s["org"], "model": prof.get("label", "오프라인 규칙엔진"),
            "sample": os.path.isdir(config.SAMPLE), "sample_base": config.SAMPLE_BASE, "today": dt.date.today().isoformat(),
            "supported": list(SUPPORTED), "remind": s.get("remind", {"first_days": 30, "boss_days": 14})}


@app.get("/api/settings")
def get_settings():
    s = config.settings()
    profiles = {k: {kk: vv for kk, vv in v.items() if kk != "api_key"} | {"has_key": bool(v.get("api_key"))}
                for k, v in s["profiles"].items()}
    return {"org": s["org"], "schedule": s["schedule"], "active_profile": s.get("active_profile"), "profiles": profiles,
            "remind": s.get("remind", {})}


@app.post("/api/settings")
async def post_settings(req: Request):
    b = await body(req)
    s = config.settings()
    patch: dict = {}
    if isinstance(b.get("org"), dict):
        patch["org"] = {k: str(v)[:60] for k, v in b["org"].items() if k in ("name", "dept", "manager")}
    if isinstance(b.get("schedule"), dict):
        sc = {}
        for k in ("min_on_duty_ratio", "room_capacity", "max_sessions"):
            if k in b["schedule"]:
                try:
                    v = float(b["schedule"][k])
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} 값이 숫자가 아닙니다.")
                sc[k] = v if k == "min_on_duty_ratio" else int(v)
        if "min_on_duty_ratio" in sc and not 0 <= sc["min_on_duty_ratio"] <= 0.9:
            raise HTTPException(400, "현장 잔류 비율은 0~0.9 사이여야 합니다.")
        if isinstance(b["schedule"].get("holidays"), list):
            sc["holidays"] = [d for d in b["schedule"]["holidays"] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d))]
        patch["schedule"] = sc
    if b.get("active_profile"):
        if b["active_profile"] not in s["profiles"]:
            raise HTTPException(400, "없는 모델 프로필입니다.")
        patch["active_profile"] = b["active_profile"]
    if isinstance(b.get("profile"), dict) and b["profile"].get("name") in s["profiles"]:
        name, pr = b["profile"]["name"], b["profile"]
        cur = s["profiles"][name]
        upd = {}
        if "base_url" in pr:
            url = str(pr["base_url"]).strip()
            if url and not re.match(r"^https?://", url):
                raise HTTPException(400, "주소는 http:// 또는 https:// 로 시작해야 합니다.")
            upd["base_url"] = url
            if url != cur.get("base_url") and "api_key" not in pr:
                upd["api_key"] = ""  # 주소가 바뀌면 저장된 키를 새 주소로 보내지 않도록 지움
        if "model" in pr:
            upd["model"] = str(pr["model"])[:100]
        if pr.get("api_key"):
            upd["api_key"] = str(pr["api_key"])[:400]
        patch.setdefault("profiles", {})[name] = upd
    config.save_settings(patch)
    return get_settings()


@app.get("/api/llm/check")
def llm_check(profile: str):
    return llm.check(profile)


@app.get("/api/rules")
def get_rules():
    return config.rules()


@app.put("/api/rules")
async def put_rules(req: Request):
    b = await body(req)
    courses = b.get("courses")
    if not isinstance(courses, list) or not courses:
        raise HTTPException(400, "교육 목록이 비어 있습니다.")
    ids = set()
    for c in courses:
        if not isinstance(c, dict) or not re.fullmatch(r"[a-z0-9_]{1,20}", str(c.get("id", ""))) or not c.get("name"):
            raise HTTPException(400, "각 교육에는 영문 id와 이름이 있어야 합니다.")
        if c["id"] in ids:
            raise HTTPException(400, f"교육 id가 겹칩니다: {c['id']}")
        ids.add(c["id"])
        h = c.get("hours", 1)
        if not (isinstance(h, (int, float)) and h > 0) and not (isinstance(h, dict) and all(isinstance(v, (int, float)) and v > 0 for v in h.values())):
            raise HTTPException(400, f"{c['name']}: 시간은 0보다 큰 숫자여야 합니다.")
        if c.get("cycle", "year") not in ("year", "half", "hire"):
            raise HTTPException(400, f"{c['name']}: 주기는 year·half·hire 중 하나입니다.")
        if c.get("due") and not re.fullmatch(r"\d{2}-\d{2}", c["due"]):
            raise HTTPException(400, f"{c['name']}: 기한은 MM-DD 형식입니다.")
        if not isinstance(c.get("keywords", []), list):
            raise HTTPException(400, f"{c['name']}: 키워드는 목록이어야 합니다.")
    config.save_rules({k: v for k, v in b.items() if k in ("_안내", "courses", "not_mandatory_keywords")})
    return config.rules()


@app.post("/api/rules/reset")
def reset_rules():
    config.reset_rules()
    return config.rules()


# ───────────── 작업(프로젝트)
@app.get("/api/projects")
def list_projects():
    out = []
    if os.path.isdir(PROJECTS):
        for pid in os.listdir(PROJECTS):
            try:
                p = load(pid)
            except HTTPException:
                continue
            out.append({"id": p["id"], "name": p["name"], "created": p["created"], "base_date": p["base_date"], "files": len(p["files"])})
    return sorted(out, key=lambda x: x["created"], reverse=True)


@app.post("/api/projects/sample")
def create_sample():
    if not os.path.isdir(config.SAMPLE):
        raise HTTPException(404, "모의자료가 없습니다(python sample_data/make_samples.py 로 생성).")
    p = new_project(f"{config.settings()['org']['name']} 법정의무교육(샘플)", config.SAMPLE_BASE)
    with LOCK:
        add_folder(p, config.SAMPLE)
        bump(p, "모의자료로 시작")
    return {"id": p["id"]}


@app.post("/api/projects/path")
async def create_from_path(req: Request):
    b = await body(req)
    path = os.path.abspath(os.path.expanduser(str(b.get("path", "")).strip().strip('"')))
    if not os.path.isdir(path):
        raise HTTPException(400, "폴더를 찾을 수 없습니다.")
    p = new_project(b.get("name") or os.path.basename(path), b.get("base_date"))
    with LOCK:
        n = add_folder(p, path)
        if not n:
            raise HTTPException(400, "읽을 수 있는 자료(엑셀·한글·워드·PDF)가 없습니다.")
        bump(p, f"폴더에서 {n}개 자료 가져옴")
    return {"id": p["id"]}


@app.post("/api/projects/upload")
async def upload(req: Request):
    form = await req.form()
    files = form.getlist("files")
    if not files:
        raise HTTPException(400, "파일이 없습니다.")
    base = str(form.get("base_date") or "") or None
    if base and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", base):
        raise HTTPException(400, "기준일 형식이 올바르지 않습니다.")
    p = new_project(str(form.get("name") or "법정의무교육 관리"), base)
    root = os.path.join(_pdir(p["id"]), "files")
    total = 0
    for f in files:
        rel = _safe_rel(getattr(f, "filename", "") or "")
        if not rel or os.path.splitext(rel)[1].lower() not in SUPPORTED:
            continue
        data = await f.read()
        await f.close()
        total += len(data)
        if total > MAX_UPLOAD:
            shutil.rmtree(_pdir(p["id"]), ignore_errors=True)
            raise HTTPException(413, "자료가 너무 큽니다(최대 500MB).")
        dst = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as out:
            out.write(data)
        p["files"].append(engine.file_entry(dst, rel))
    if not p["files"]:
        raise HTTPException(400, "읽을 수 있는 자료(엑셀·한글·워드·PDF)가 없습니다.")
    with LOCK:
        bump(p, f"자료 {len(p['files'])}개 올림")
    return {"id": p["id"]}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    load(pid)
    shutil.rmtree(_pdir(pid), ignore_errors=True)
    return {"ok": True}


def _lean_people(res):
    return [{k: p[k] for k in ("id", "name", "dept", "title", "emp", "job", "shift", "team", "hired", "left", "leave", "flags")}
            for p in res["people"]]


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = load(pid)
    res = result(p)
    integrity = all(engine.sha256(f["path"]) == f["sha"] for f in p["files"] if os.path.exists(f["path"]))
    shifts = [{"month": s["month"], "file": s["file"], "people": len(s["people"])} for s in res["shifts"]]
    return {"project": {k: p.get(k) for k in ("id", "name", "created", "base_date", "year", "log", "overrides")},
            "base": res["base"], "year": res["year"], "files": res["files"], "summary": res["summary"], "columns": res["columns"],
            "people": _lean_people(res), "cells": res["cells"], "issues": res["issues"], "depts": res["depts"],
            "signs": res["signs"], "shifts": shifts, "has_survey": bool(res["survey"]), "has_guide": bool(res["texts"]),
            "integrity": integrity, "rules": [{"id": r["id"], "name": r["name"]} for r in res["rules"]["courses"]]}


@app.patch("/api/projects/{pid}")
async def patch_project(pid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        if "base_date" in b:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(b["base_date"])):
                raise HTTPException(400, "기준일 형식이 올바르지 않습니다.")
            try:
                dt.date.fromisoformat(b["base_date"])
            except ValueError:
                raise HTTPException(400, "없는 날짜입니다.")
            p["base_date"] = b["base_date"]
        if "year" in b:
            y = b["year"]
            if y not in (None, "") and (not str(y).isdigit() or not 2000 <= int(y) <= 2100):
                raise HTTPException(400, "판정 연도가 올바르지 않습니다.")
            p["year"] = int(y) if y not in (None, "") else None
        if b.get("name"):
            p["name"] = str(b["name"])[:80]
        bump(p, "기준일·이름 변경")
    return {"ok": True}


@app.get("/api/projects/{pid}/records")
def get_records(pid: str, ids: str = "", person: str = ""):
    res = result(load(pid))
    want = set(ids.split(",")) if ids else set()
    out = [r for r in res["records"] if (r["rid"] in want) or (person and r.get("pid") == person)]
    names = {r["id"]: r["name"] for r in res["rules"]["courses"]}
    return [dict({k: r.get(k) for k in ("rid", "kind", "title", "date", "hours", "done", "name", "dept", "file", "where", "note", "match")},
                 rules=[names.get(x, x) for x in r.get("rules", [])]) for r in out]


@app.post("/api/projects/{pid}/resolve")
async def resolve(pid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        res = result(p)
        ov = p.setdefault("overrides", {"person": {}, "course": {}})
        if b.get("type") == "person":
            key, val = str(b.get("key", "")), str(b.get("value", ""))
            if not any(r["key"] == key for r in res["records"]):
                raise HTTPException(400, "없는 기록입니다.")
            if val != "ignore" and val not in {x["id"] for x in res["people"]}:
                raise HTTPException(400, "명단에 없는 직원입니다.")
            ov["person"][key] = val
        elif b.get("type") == "course":
            key, val = str(b.get("key", "")), b.get("value")
            ids = {r["id"] for r in res["rules"]["courses"]}
            if not isinstance(val, list) or any(v not in ids for v in val):
                raise HTTPException(400, "교육 분류 값이 올바르지 않습니다.")
            ov["course"][key] = val
        else:
            raise HTTPException(400, "type은 person 또는 course 입니다.")
        bump(p, f"확인 처리: {b.get('type')}")
    return {"ok": True}


@app.delete("/api/projects/{pid}/resolve")
def unresolve(pid: str, type: str, key: str):
    with LOCK:
        p = load(pid)
        p.get("overrides", {}).get(type, {}).pop(key, None)
        bump(p, "확인 처리 되돌림")
    return {"ok": True}


def _col(res, col):
    if col not in {c["key"] for c in res["columns"]}:
        raise HTTPException(400, "없는 교육입니다.")
    return col


@app.get("/api/projects/{pid}/plan")
def get_plan(pid: str, col: str, hours: float | None = None, start: str = "", end: str = ""):
    res = result(load(pid))
    for d in (start, end):
        if d and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            raise HTTPException(400, "날짜 형식이 올바르지 않습니다.")
    if hours is not None and not 0.5 <= hours <= 8:
        raise HTTPException(400, "회차당 시간은 0.5~8시간입니다.")
    return schedule.plan(res, _col(res, col), hours, start or None, end or None)


@app.get("/api/projects/{pid}/reminders")
def get_reminders(pid: str, col: str = "", within: int | None = None):
    res = result(load(pid))
    org = config.settings()["org"]
    if col:
        _col(res, col)
    return {"people": reports.reminders(res, org, col or None, within), "boss": reports.boss_notes(res, org, col or None)}


@app.post("/api/projects/{pid}/ask")
async def ask(pid: str, req: Request):
    b = await body(req)
    q = str(b.get("q", "")).strip()
    if not q:
        raise HTTPException(400, "질문을 입력하세요.")
    return qa.ask(result(load(pid)), q[:300])


@app.get("/api/projects/{pid}/survey")
def survey(pid: str):
    res = result(load(pid))
    out = []
    for i, sg in enumerate(res["signs"]):
        sv = reports.survey_summary(reports.survey_for(res, sg["title"] + " " + sg.get("context", "")))
        out.append({"index": i, "title": sg["title"], "date": sg["date"], "hours": sg["hours"], "n": sg["n"], "attended": sg["attended"],
                    "file": sg["file"], "survey": sv, "improve": reports.improvements(sv)})
    return out


@app.get("/api/projects/{pid}/export")
def export(pid: str, doc: str = "status", fmt: str = "hwpx", col: str = "", sign: int = -1, within: int | None = None):
    p = load(pid)
    res = result(p)
    org = config.settings()["org"]
    stamp = res["base"].replace("-", "")
    if doc == "excel":
        return _file(reports.excel(res), f"이수현황_{stamp}.xlsx",
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if doc == "evidence":
        return _file(reports.evidence_zip(res, {f["rel"]: f["path"] for f in p["files"]}), f"법정의무교육_증빙_{stamp}.zip",
                     "application/zip")
    if doc == "reminders":
        return _file(reports.reminders_excel(reports.reminders(res, org, col or None, within)), f"미이수자_안내문_{stamp}.xlsx",
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if fmt not in FORMATS:
        raise HTTPException(400, "형식은 hwpx·docx·md 중 하나입니다.")
    if doc == "status":
        pl = schedule.plan(res, _col(res, col)) if col else None
        blocks, name = reports.status_blocks(res, org, pl), f"법정의무교육_이수현황_보고_{stamp}"
    elif doc == "result":
        if not 0 <= sign < len(res["signs"]):
            raise HTTPException(400, "없는 집합교육입니다.")
        sg = res["signs"][sign]
        blocks, name = reports.result_blocks(res, org, sg), f"교육결과보고_{re.sub(r'[^가-힣A-Za-z0-9]+', '_', sg['title'])[:40]}"
    elif doc == "plan":
        blocks, name = reports.plan_blocks(res, org, schedule.plan(res, _col(res, col))), f"집합교육_일정안내_{stamp}"
    else:
        raise HTTPException(400, "없는 문서 종류입니다.")
    fn, mime = FORMATS[fmt]
    return _file(fn(blocks), f"{name}.{fmt}", mime)


def _file(data: bytes, filename: str, mime: str) -> Response:
    q = urllib.parse.quote(filename)
    return Response(data, media_type=mime, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{q}"})
