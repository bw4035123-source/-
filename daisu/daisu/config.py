"""설정·규칙표 읽기/쓰기. 기관별 수정분은 *.local.json 에 따로 저장해 원본 설정을 보존한다."""
from __future__ import annotations

import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config")
WORKSPACE = os.environ.get("DAISU_WORKSPACE", os.path.join(ROOT, "workspace"))
SAMPLE = os.path.join(ROOT, "sample_data", "가상구시설관리공단_교육자료")
SAMPLE_BASE = "2026-10-12"
VERSION = "1.0.0"


def _load(name: str) -> dict:
    with open(os.path.join(CONFIG, name), encoding="utf-8") as f:
        return json.load(f)


def _merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in b.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def settings() -> dict:
    s = _load("settings.json")
    local = os.path.join(CONFIG, "settings.local.json")
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            s = _merge(s, json.load(f))
    if os.environ.get("DAISU_LLM"):
        s["active_profile"] = os.environ["DAISU_LLM"]
    return s


def save_settings(patch: dict) -> None:
    local = os.path.join(CONFIG, "settings.local.json")
    cur = {}
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            cur = json.load(f)
    with open(local, "w", encoding="utf-8") as f:
        json.dump(_merge(cur, patch), f, ensure_ascii=False, indent=2)


def rules() -> dict:
    local = os.path.join(CONFIG, "rules.local.json")
    return _load_path(local) if os.path.exists(local) else _load("rules.json")


def _load_path(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_rules(data: dict) -> None:
    with open(os.path.join(CONFIG, "rules.local.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def reset_rules() -> None:
    p = os.path.join(CONFIG, "rules.local.json")
    if os.path.exists(p):
        os.remove(p)
