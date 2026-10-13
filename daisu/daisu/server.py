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

from . import annual, config, costs, engine, kpi, lawapi, llm, planning, qa, reports, schedule, sessions, work
from . import fees as fees_mod
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


def fee_config(res: dict) -> dict:
    """강사수당 기준: 넣은 규정 문서(강사수당 지급기준)가 있으면 그 등급표, 없으면 설정값. 세금 기준은 설정값."""
    cfg = dict(config.settings().get("fees", {}))
    fee = (res.get("regs") or {}).get("fee")
    if fee and fee.get("tiers"):
        cfg["tiers"] = [{k: t[k] for k in ("grade", "desc", "first", "extra")} for t in fee["tiers"]]
        cfg["from_doc"] = fee.get("file")
        if fee.get("manuscript_per_page"):
            cfg["manuscript_per_page"] = fee["manuscript_per_page"]
    return cfg


def bump(project: dict, what: str) -> None:
    project["version"] = project.get("version", 0) + 1
    project.setdefault("log", []).append({"at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "what": what})
    save(project)


def new_project(name: str, base_date: str | None) -> dict:
    pid = uuid.uuid4().hex[:8]
    return {"id": pid, "name": name or "교육훈련 관리", "created": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "base_date": base_date or dt.date.today().isoformat(), "files": [], "overrides": {"person": {}, "course": {}},
            "version": 0, "log": []}


def _safe_rel(rel: str) -> str:
    """올린 파일의 상대 경로 정리: '..'·드라이브(C:)·절대 경로를 없애고, 너무 길면 뒤쪽 폴더만 남긴다(항상 상대 경로)."""
    parts = [re.sub(r'[<>:"|?*\x00-\x1f]', "_", p)[:120] for p in re.split(r"[\\/]+", rel or "") if p not in ("", ".", "..")]
    while len("/".join(parts)) > 240 and len(parts) > 1:
        parts.pop(0)
    return "/".join(parts)[-240:].lstrip("/")


def _inside(root: str, path: str) -> bool:
    root = os.path.realpath(root)
    return os.path.commonpath([root, os.path.realpath(path)]) == root


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
            if not rel or not _inside(dst_root, dst):
                continue
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
            "remind": s.get("remind", {}), "fees": s.get("fees", {}),
            "law": {"has_oc": bool(lawapi.oc()), "checked": lawapi.last_status().get("checked")}}


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
    if isinstance(b.get("org"), dict) and isinstance(b["org"].get("signers"), dict):
        patch.setdefault("org", {})["signers"] = {k: str(v)[:40] for k, v in b["org"]["signers"].items() if k in ("drafter", "reviewer", "approver")}
    if isinstance(b.get("fees"), dict):
        f = b["fees"]
        fp = {}
        if isinstance(f.get("tiers"), list):
            tiers = []
            for t in f["tiers"]:
                try:
                    tiers.append({"grade": str(t["grade"])[:20], "desc": str(t.get("desc", ""))[:60],
                                  "first": int(t["first"]), "extra": int(t["extra"])})
                except (KeyError, TypeError, ValueError):
                    raise HTTPException(400, "강사료 기준은 등급·첫 1시간·추가 1시간 금액이 필요합니다.")
                if tiers[-1]["first"] < 0 or tiers[-1]["extra"] < 0:
                    raise HTTPException(400, "강사료는 0 이상입니다.")
            if not tiers:
                raise HTTPException(400, "강사료 등급이 하나 이상 있어야 합니다.")
            fp["tiers"] = tiers
        if "manuscript_per_page" in f:
            try:
                fp["manuscript_per_page"] = max(0, int(f["manuscript_per_page"]))
            except (TypeError, ValueError):
                raise HTTPException(400, "원고료가 숫자가 아닙니다.")
        patch["fees"] = fp
    if isinstance(b.get("law"), dict) and "oc" in b["law"]:
        v = str(b["law"]["oc"] or "").strip()
        if v and not re.fullmatch(r"[A-Za-z0-9_.@-]{2,60}", v):
            raise HTTPException(400, "인증키(OC) 형식이 올바르지 않습니다.")
        patch["law"] = {"oc": v}
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


# ───────────── 국가법령정보 연동
def _law(fn, *a, **k):
    try:
        return fn(*a, **k)
    except lawapi.LawError as e:
        raise HTTPException(502, str(e))


@app.get("/api/law/check")
def law_check():
    found = _law(lawapi.search, "산업안전보건법")
    if not found:
        raise HTTPException(502, "응답은 받았지만 ‘산업안전보건법’ 검색 결과가 없습니다.")
    f = found[0]
    return {"ok": True, "detail": f"연결 성공: {f['name']}(시행 {f['effective']}) 등 {len(found)}건 검색됨"}


@app.get("/api/law/article")
def law_article(name: str, jo: str, branch: str = "0", cache_only: bool = False):
    if not re.fullmatch(r"\d{1,4}", jo or "") or not re.fullmatch(r"\d{1,3}", branch or "0"):
        raise HTTPException(400, "조문 번호가 올바르지 않습니다.")
    return _law(lawapi.article, name[:80], jo, branch, cache_only=cache_only)


@app.get("/api/law/rule/{rule_id}")
def law_for_rule(rule_id: str, cache_only: bool = True):
    rule = next((r for r in config.rules()["courses"] if r["id"] == rule_id), None)
    if not rule:
        raise HTTPException(404, "없는 교육입니다.")
    out = []
    for r in lawapi.refs(rule.get("law", "")):
        try:
            out.append(dict(lawapi.article(r["name"], r["jo"], r["branch"], cache_only=cache_only), ok=True))
        except lawapi.LawError as e:
            out.append({"ok": False, "law": r["name"], "jo": r["jo"], "error": str(e), "url": lawapi.link(r["name"], r["jo"], r["branch"])})
    return {"law": rule.get("law", ""), "items": out, "has_oc": bool(lawapi.oc())}


@app.post("/api/law/rules-check")
def law_rules_check():
    if not lawapi.oc():
        raise HTTPException(400, "국가법령정보 인증키(OC)를 먼저 설정하세요.")
    return lawapi.check_rules(config.rules())


@app.get("/api/law/status")
def law_status():
    return lawapi.last_status()


@app.post("/api/law/ack")
async def law_ack(req: Request):
    b = await body(req)
    return lawapi.acknowledge(b.get("ref"))


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
    p = new_project(f"{config.settings()['org']['name']} 교육훈련(샘플)", config.SAMPLE_BASE)
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
    p = new_project(str(form.get("name") or "교육훈련 관리"), base)
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
        if not _inside(root, dst):  # 작업 폴더 밖으로는 절대 쓰지 않음
            continue
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


# ───────────── 집합교육 회차 운영
def _sess(p: dict, sid: str) -> dict:
    s = next((x for x in p.get("sessions", []) if x["id"] == sid), None)
    if not s:
        raise HTTPException(404, "없는 회차입니다.")
    return s


def _people_by_id(res):
    return {x["id"]: x for x in res["people"]}


@app.get("/api/projects/{pid}/sessions")
def list_sessions(pid: str):
    p = load(pid)
    res = result(p)
    fee_cfg = fee_config(res)
    pb = _people_by_id(res)
    return sorted((sessions.view(s, pb, fee_cfg) for s in p.get("sessions", [])), key=lambda x: (x["date"], x["start"]))


@app.get("/api/projects/{pid}/sessions/{sid}")
def get_session(pid: str, sid: str):
    p = load(pid)
    res = result(p)
    v = sessions.view(_sess(p, sid), _people_by_id(res), fee_config(res))
    v["tiers"] = fee_config(res).get("tiers", [])
    v["everyone"] = [{"id": x["id"], "name": x["name"], "dept": x["dept"], "team": x.get("team", "")} for x in res["people"]
                     if not (x.get("left") and x["left"] <= res["base"])]
    v["survey_items"] = sessions.SURVEY_ITEMS
    return v


@app.post("/api/projects/{pid}/sessions")
async def create_sessions(pid: str, req: Request):
    """일정 짜기 결과로 회차 만들기({col, hours}) 또는 빈 회차 하나 만들기({manual: true, col, date})."""
    b = await body(req)
    with LOCK:
        p = load(pid)
        res = result(p)
        col = _col(res, str(b.get("col", "")))
        c = next(x for x in res["columns"] if x["key"] == col)
        if b.get("manual"):
            d = str(b.get("date") or res["base"])
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                raise HTTPException(400, "날짜 형식이 올바르지 않습니다.")
            made = [{"id": sessions.new_id(), "col": col, "rule": c["rule"], "law": c["law"], "title": c["label"], "date": d,
                     "start": "14:00", "end": "16:00", "hours": 2, "place": "", "targets": [],
                     "instructor": {"name": "", "org": "", "grade": "", "income": "기타소득", "pages": 0, "travel": 0},
                     "attend": {}, "survey": [], "created": dt.datetime.now().strftime("%Y-%m-%d %H:%M")}]
        else:
            hours = b.get("hours")
            try:
                ok = hours in (None, "") or (not isinstance(hours, bool) and 0.5 <= float(hours) <= 8)
            except (TypeError, ValueError):
                ok = False
            if not ok:
                raise HTTPException(400, "회차당 시간은 0.5~8시간입니다.")
            pl = schedule.plan(res, col, float(hours) if hours not in (None, "") else None)
            if not pl["sessions"]:
                raise HTTPException(400, "만들 회차가 없습니다.")
            made = sessions.from_plan(pl, c["law"], str(b.get("place", ""))[:60])
        p.setdefault("sessions", []).extend(made)
        bump(p, f"집합교육 {len(made)}회차 등록")
    return {"ids": [m["id"] for m in made]}


@app.patch("/api/projects/{pid}/sessions/{sid}")
async def patch_session(pid: str, sid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        s = _sess(p, sid)
        for k in ("title", "place"):
            if k in b:
                s[k] = str(b[k])[:80]
        for k in ("start", "end"):
            if k in b:
                if not re.fullmatch(r"\d{1,2}:\d{2}", str(b[k])):
                    raise HTTPException(400, "시각은 09:00 형식입니다.")
                s[k] = b[k]
        if "date" in b:
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(b["date"])):
                    raise ValueError
                dt.date.fromisoformat(str(b["date"]))
            except ValueError:
                raise HTTPException(400, "날짜 형식이 올바르지 않습니다(YYYY-MM-DD).")
            s["date"] = b["date"]
        if "hours" in b:
            try:
                h = float(b["hours"])
            except (TypeError, ValueError):
                raise HTTPException(400, "교육 시간이 숫자가 아닙니다.")
            if not 0.5 <= h <= 16:
                raise HTTPException(400, "교육 시간은 0.5~16시간입니다.")
            s["hours"] = h
        if isinstance(b.get("instructor"), dict):
            i = b["instructor"]
            grades = {t["grade"] for t in fee_config(result(p)).get("tiers", [])}
            if i.get("grade") and i["grade"] not in grades:
                raise HTTPException(400, "없는 강사 등급입니다.")
            if i.get("income") and i["income"] not in ("기타소득", "사업소득", "근로"):
                raise HTTPException(400, "소득 구분이 올바르지 않습니다.")
            for k in ("pages", "travel"):
                if k in i:
                    try:
                        i[k] = max(0, int(i[k] or 0))
                    except (TypeError, ValueError):
                        raise HTTPException(400, "원고 매수·교통비는 숫자입니다.")
            s["instructor"].update({k: (str(v)[:60] if isinstance(v, str) else v) for k, v in i.items()
                                    if k in ("name", "org", "grade", "income", "pages", "travel")})
        bump(p, f"회차 수정: {s['title']}")
    return {"ok": True}


@app.delete("/api/projects/{pid}/sessions/{sid}")
def delete_session(pid: str, sid: str):
    with LOCK:
        p = load(pid)
        s = _sess(p, sid)
        p["sessions"].remove(s)
        bump(p, f"회차 삭제: {s['title']}")
    return {"ok": True}


@app.post("/api/projects/{pid}/sessions/{sid}/attend")
async def attend(pid: str, sid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        s = _sess(p, sid)
        res = result(p)
        person = str(b.get("person", ""))
        if person not in {x["id"] for x in res["people"]}:
            raise HTTPException(400, "명단에 없는 직원입니다.")
        sign = b.get("sign")
        if sign:
            try:
                sessions.check_sign(sign)
            except ValueError as e:
                raise HTTPException(400, str(e))
        elif not b.get("manual"):
            raise HTTPException(400, "서명이 없습니다.")
        if person in s["attend"] and not b.get("replace"):
            return {"ok": True, "already": True, "at": s["attend"][person]["at"]}
        s["attend"][person] = {"at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "sign": sign or "", "manual": bool(b.get("manual"))}
        bump(p, "출석")
    return {"ok": True, "count": len(s["attend"])}


@app.delete("/api/projects/{pid}/sessions/{sid}/attend/{person}")
def unattend(pid: str, sid: str, person: str):
    with LOCK:
        p = load(pid)
        s = _sess(p, sid)
        s["attend"].pop(person, None)
        bump(p, "출석 취소")
    return {"ok": True}


@app.post("/api/projects/{pid}/sessions/{sid}/survey")
async def session_survey(pid: str, sid: str, req: Request):
    b = await body(req)
    scores = b.get("scores")
    if not isinstance(scores, dict) or set(scores) != set(sessions.SURVEY_ITEMS) or \
            any(not isinstance(v, (int, float)) or not 1 <= v <= 5 for v in scores.values()):
        raise HTTPException(400, "만족도는 문항마다 1~5점입니다.")
    with LOCK:
        p = load(pid)
        s = _sess(p, sid)
        s["survey"].append({"scores": scores, "comment": str(b.get("comment", ""))[:300], "at": dt.datetime.now().strftime("%Y-%m-%d %H:%M")})
        bump(p, "만족도 응답")
    return {"ok": True, "n": len(s["survey"])}


# ───────────── 규정 해석·종합 실적
def _overview(p: dict, res: dict) -> tuple[dict, dict]:
    ex = costs.external(res)
    return kpi.compute(res, p, ex, fee_config(res)), ex


@app.get("/api/projects/{pid}/regs")
def get_regs(pid: str):
    res = result(load(pid))
    rg = res["regs"]
    tg, gov = rg.get("training", {}).get("annual_hours"), rg.get("gov", {}).get("rec_hours")
    warn = []
    if tg and gov and tg["value"] < gov["value"]:
        warn.append(f"내규 목표({tg['value']}시간)가 정부 권장({gov['value']}시간)보다 낮습니다.")
    if not rg.get("travel"):
        warn.append("여비규정을 찾지 못해 외부교육 여비를 산정할 수 없습니다.")
    if not rg.get("kpis"):
        warn.append("경영평가 편람(지표·산식 표)을 찾지 못해 기본 지표만 계산합니다.")
    return {"docs": rg.get("docs", []), "items": rg.get("items", []), "warnings": warn,
            "fee_from_doc": bool(rg.get("fee")), "required": len(rg.get("required", []))}


@app.get("/api/projects/{pid}/overview")
def get_overview(pid: str):
    p = load(pid)
    res = result(p)
    k, ex = _overview(p, res)
    pb = _people_by_id(res)
    per = [{"id": pid_, "name": pb[pid_]["name"], "dept": pb[pid_]["dept"], "job": pb[pid_]["job"], "grade": pb[pid_].get("grade", ""),
            **{c: round(v[c], 1) for c in kpi.CATS}, "total": round(sum(v.values()), 1)} for pid_, v in k["hours"]["per"].items()]
    return {"kpis": k["kpis"], "totals": k["totals"], "total_hours": k["total_hours"], "per_capita": k["per_capita"], "people": k["people"],
            "target_hours": k["target_hours"], "gov_hours": k["gov_hours"], "below": len(k["below"]), "spend": k["spend"], "budget": k["budget"],
            "legal": k["legal"], "required": k["required"], "satisfaction": k["satisfaction"], "per_person": per,
            "courses": {c: len(v) for c, v in k["hours"]["courses"].items()}, "priorities": annual.priorities_check(res, k),
            "external": {kk: ex[kk] for kk in ("total_cost", "total_travel", "hours", "report_days", "limit", "has_travel_rule")} |
                        {"rows": ex["rows"], "late": len(ex["late"]), "missing": len(ex["missing"]), "over_limit": ex["over_limit"]}}


# ───────────── 할 일·실적
@app.get("/api/projects/{pid}/tasks")
def get_tasks(pid: str):
    p = load(pid)
    return planning.tasks(p, result(p), config.settings().get("remind", {}))


@app.post("/api/projects/{pid}/tasks/{key}")
def toggle_task(pid: str, key: str):
    with LOCK:
        p = load(pid)
        done = set(p.get("done_tasks", []))
        done.symmetric_difference_update({key[:80]})
        p["done_tasks"] = sorted(done)
        save(p)
    return {"done": key in done}


# ───────────── 업무 일정(간트)·체크리스트
def _work(p: dict, res: dict) -> list[dict]:
    k, ex = _overview(p, res)
    return work.analyze(p, res, ex, config.settings().get("remind", {}), k["spend"])


def _work_item(p: dict, iid: str) -> dict:
    for it in _work(p, result(p)):
        if it["id"] == iid:
            return it
    raise HTTPException(404, "없는 업무입니다.")


def _lean_item(it: dict) -> dict:
    return {k: v for k, v in it.items() if k not in ("ctx", "base")}


def _date_ok(x) -> str:
    x = str(x or "")
    try:
        dt.date.fromisoformat(x)
    except ValueError:
        raise HTTPException(400, "날짜 형식이 올바르지 않습니다(YYYY-MM-DD).")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", x):
        raise HTTPException(400, "날짜 형식이 올바르지 않습니다(YYYY-MM-DD).")
    return x


@app.get("/api/projects/{pid}/work")
def get_work(pid: str):
    p = load(pid)
    res = result(p)
    return {"year": res["year"], "base": res["base"], "lanes": work.LANES, "status": work.STATUS,
            "items": [_lean_item(it) for it in _work(p, res)]}


@app.get("/api/projects/{pid}/work/{iid}/checklist")
def get_checklist(pid: str, iid: str):
    p = load(pid)
    it = _work_item(p, iid)
    ck = p.get("work", {}).get("checks", {}).get(iid)
    return {"item": _lean_item(it), "created": ck["created"] if ck else None, "items": work.checklist_view(it, ck) if ck else None}


@app.post("/api/projects/{pid}/work/{iid}/checklist")
def make_checklist(pid: str, iid: str):
    with LOCK:
        p = load(pid)
        it = _work_item(p, iid)
        p.setdefault("work", {}).setdefault("checks", {})[iid] = work.build_checklist(it)
        save(p)
    return get_checklist(pid, iid)


@app.patch("/api/projects/{pid}/work/{iid}/checklist")
async def edit_checklist(pid: str, iid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        ck = p.get("work", {}).get("checks", {}).get(iid)
        if not ck:
            raise HTTPException(404, "체크리스트를 먼저 만드세요.")
        items = ck["items"]
        if "toggle" in b:
            x = next((x for x in items if x["id"] == b["toggle"]), None)
            if not x:
                raise HTTPException(400, "없는 항목입니다.")
            x["checked"] = not x.get("checked")
        elif "add" in b:
            text = str(b["add"]).strip()[:120]
            if not text:
                raise HTTPException(400, "항목 내용을 입력하세요.")
            n = max([int(x["id"][1:]) for x in items if x["id"].startswith("u")] + [0]) + 1
            items.append({"id": f"u{n}", "text": text, "hint": "", "link": "", "auto": False, "checked": False, "mine": True})
        elif "remove" in b:
            ck["items"] = [x for x in items if x["id"] != b["remove"]]
        elif b.get("delete"):
            p["work"]["checks"].pop(iid)
        else:
            raise HTTPException(400, "toggle·add·remove·delete 중 하나를 보내세요.")
        save(p)
    return get_checklist(pid, iid)


@app.patch("/api/projects/{pid}/work/{iid}")
async def edit_work(pid: str, iid: str, req: Request):
    b = await body(req)
    with LOCK:
        p = load(pid)
        _work_item(p, iid)
        w = p.setdefault("work", {})
        if b.get("reset"):
            w.get("dates", {}).pop(iid, None)
        else:
            s, e = _date_ok(b.get("start")), _date_ok(b.get("end"))
            if e < s:
                raise HTTPException(400, "끝나는 날이 시작일보다 빠릅니다.")
            w.setdefault("dates", {})[iid] = [s, e]
        save(p)
    return {"ok": True}


@app.post("/api/projects/{pid}/work")
async def add_work(pid: str, req: Request):
    b = await body(req)
    title = str(b.get("title", "")).strip()[:80]
    if not title:
        raise HTTPException(400, "업무 이름을 입력하세요.")
    s, e = _date_ok(b.get("start")), _date_ok(b.get("end"))
    if e < s:
        raise HTTPException(400, "끝나는 날이 시작일보다 빠릅니다.")
    with LOCK:
        p = load(pid)
        iid = "custom:" + uuid.uuid4().hex[:6]
        p.setdefault("work", {}).setdefault("custom", []).append({"id": iid, "title": title, "start": s, "end": e})
        save(p)
    return {"id": iid}


@app.delete("/api/projects/{pid}/work/{iid}")
def delete_work(pid: str, iid: str):
    if not iid.startswith("custom:"):
        raise HTTPException(400, "직접 추가한 업무만 지울 수 있습니다.")
    with LOCK:
        p = load(pid)
        w = p.setdefault("work", {})
        w["custom"] = [c for c in w.get("custom", []) if c["id"] != iid]
        w.get("checks", {}).pop(iid, None)
        w.get("dates", {}).pop(iid, None)
        save(p)
    return {"ok": True}


@app.get("/api/projects/{pid}/stats")
def get_stats(pid: str):
    p = load(pid)
    res = result(p)
    st = planning.stats(p, res, fee_config(res))
    st.pop("hours")
    return st


def _mark_export(p: dict, key: str):
    with LOCK:
        cur = load(p["id"])
        cur.setdefault("exported", {})[key] = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        save(cur)


@app.get("/api/projects/{pid}/export")
def export(pid: str, doc: str = "status", fmt: str = "hwpx", col: str = "", sign: int = -1, within: int | None = None,
           session: str = "", person: str = ""):
    p = load(pid)
    res = result(p)
    st_all = config.settings()
    org = st_all["org"]
    fee_cfg = fee_config(res)
    stamp = res["base"].replace("-", "")
    if doc in ("annual", "kpi", "criteria"):
        k, ex = _overview(p, res)
        blocks = {"annual": lambda: annual.annual_blocks(res, k, ex, org), "kpi": lambda: annual.kpi_blocks(res, k, org),
                  "criteria": lambda: annual.criteria_blocks(res, org)}[doc]()
        name = {"annual": f"{res['year']}년_교육훈련_실적보고", "kpi": f"{res['year']}년_경영평가_교육훈련지표_실적", "criteria": "교육훈련_산정기준표"}[doc]
        fmt = fmt if fmt in FORMATS else "hwpx"
        fn, mime = FORMATS[fmt]
        return _file(fn(blocks), f"{name}.{fmt if fmt in FORMATS else 'hwpx'}", mime)
    if doc == "settle":
        return _file(costs.settle_excel(costs.external(res)), f"외부교육_정산내역_{stamp}.xlsx",
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if doc == "gantt":
        return _file(work.excel(_work(p, res), p.get("work", {}).get("checks", {}), res["year"], res["base"]),
                     f"교육훈련_업무일정_체크리스트_{stamp}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if doc == "stats":
        return _file(kpi.hours_excel(res, _overview(p, res)[0]), f"교육훈련_실적집계_{stamp}.xlsx",
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if doc in ("session_plan", "session_result", "session_fee", "signsheet"):
        s = _sess(p, session)
        pb = _people_by_id(res)
        safe = re.sub(r"[^가-힣A-Za-z0-9]+", "_", s["title"])[:40]
        if doc == "signsheet" and fmt == "docx":
            _mark_export(p, f"{s['id']}:sign")
            return _file(sessions.signsheet_docx(s, pb, org), f"서명부_{safe}.docx", FORMATS["docx"][1])
        if doc == "session_fee" and not s["instructor"].get("name"):
            raise HTTPException(400, "강사 정보를 먼저 입력하세요.")
        if doc == "session_result" and not s["attend"]:
            raise HTTPException(400, "출석 기록이 없습니다. 교육을 실시하고 출석(키오스크·수기)을 받은 뒤 결과 보고를 만드세요.")
        if doc == "session_fee" and fees_mod.compute(s["instructor"], s["hours"], fee_cfg)["grade_missing"]:
            raise HTTPException(400, "강사 등급을 먼저 고르세요(등급표 기준). 등급이 없으면 강사료를 산정할 수 없습니다.")
        blocks = {"session_plan": lambda: sessions.plan_doc(s, pb, org, fee_cfg), "session_result": lambda: sessions.result_doc(s, pb, org),
                  "session_fee": lambda: sessions.fee_doc(s, org, fee_cfg), "signsheet": lambda: sessions.signsheet_blocks(s, pb, org)}[doc]()
        name = {"session_plan": "실시계획", "session_result": "결과보고", "session_fee": "강사료지급", "signsheet": "서명부"}[doc]
        if fmt not in FORMATS:
            raise HTTPException(400, "형식은 hwpx·docx·md 중 하나입니다.")
        _mark_export(p, f"{s['id']}:{doc.replace('session_', '')}")
        fn, mime = FORMATS[fmt]
        return _file(fn(blocks), f"{name}_{safe}.{fmt}", mime)
    if doc == "nextplan":
        fmt = fmt if fmt in FORMATS else "hwpx"
        fn, mime = FORMATS[fmt]
        return _file(fn(planning.next_plan_blocks(p, res, org, fee_cfg)), f"{res['year'] + 1}년_법정의무교육_운영계획(안).{fmt}", mime)
    if doc == "card":
        if person not in {x["id"] for x in res["people"]}:
            raise HTTPException(400, "없는 직원입니다.")
        fmt = fmt if fmt in FORMATS else "hwpx"
        fn, mime = FORMATS[fmt]
        nm = next(x["name"] for x in res["people"] if x["id"] == person)
        return _file(fn(planning.card_blocks(res, person, org)), f"교육이력카드_{nm}.{fmt}", mime)
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
