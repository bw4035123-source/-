"""작업 공간 저장소. 모든 산출물은 원본과 분리된 workspace/ 아래에만 만든다(원본 보호)."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import threading
import uuid

from .config import WORKSPACE

_locks: dict[str, threading.RLock] = {}
_glock = threading.Lock()


def lock(pid: str) -> threading.RLock:
    with _glock:
        return _locks.setdefault(pid, threading.RLock())


def _dir(pid: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{8}", pid):
        raise KeyError(pid)
    return os.path.join(WORKSPACE, "projects", pid)


def input_dir(pid: str) -> str:
    return os.path.join(_dir(pid), "input")


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def save(project: dict) -> None:
    d = _dir(project["id"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "project.json.tmp")
    with lock(project["id"]):
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(project, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(d, "project.json"))


def load(pid: str) -> dict:
    p = os.path.join(_dir(pid), "project.json")
    if not os.path.exists(p):
        raise KeyError(pid)
    with lock(pid):
        with open(p, encoding="utf-8") as f:
            return json.load(f)


def list_projects() -> list[dict]:
    root = os.path.join(WORKSPACE, "projects")
    out = []
    if not os.path.isdir(root):
        return out
    for pid in os.listdir(root):
        try:
            p = load(pid)
        except (KeyError, json.JSONDecodeError, OSError):
            continue
        out.append({k: p.get(k) for k in ("id", "name", "from_name", "to_name", "created", "stage", "base_date")}
                   | {"n_docs": len(p.get("docs", []))})
    out.sort(key=lambda x: x.get("created") or "", reverse=True)
    return out


def delete(pid: str) -> None:
    shutil.rmtree(_dir(pid), ignore_errors=True)


def audit(project: dict, who: str, action: str, detail: str = "") -> None:
    project.setdefault("audit", []).append(
        {"at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "who": who, "action": action, "detail": detail[:200]})
