"""설정 파일 관리. 기관별로 config/ 폴더만 바꾸면 양식·모델·기관정보가 바뀐다.

- config/settings.json        : 기관 정보, LLM 프로필(교체 가능)
- config/settings.local.json  : 이 PC에서만 쓰는 API 키 등(저장소에 올리지 않음)
- config/template.json        : 인수인계서 양식(목차·순서·사용자 정의 항목)
- config/prompts/*.txt        : 프롬프트(기관이 문구를 직접 다듬을 수 있음)
"""
from __future__ import annotations

import copy
import json
import os
import threading

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.environ.get("BATON_CONFIG_DIR", os.path.join(BASE, "config"))
WORKSPACE = os.environ.get("BATON_WORKSPACE", os.path.join(BASE, "workspace"))
SAMPLE_DIR = os.path.join(BASE, "sample_data", "전임자_업무폴더")
# 체험용 모의자료(가상 기관·인물). key: (폴더, 업무명, 전임자, 후임자, 기준일, 기관, 부서)
SAMPLES = {
    "security": (SAMPLE_DIR, "정보보안·정보화예산 담당 인수인계(샘플)", "김바통 주무관", "이어달 주무관", "2026-05-11",
                 "가상시", "스마트정보과"),
    "facility": (os.path.join(BASE, "sample_data", "전임자_김도윤_업무폴더"), "체육센터 시설관리 담당 인수인계(샘플)",
                 "김도윤 주임", "이서연 주임", "2026-10-08", "공공기관", "시설운영팀"),
}

_lock = threading.Lock()


def _read(name: str, default=None):
    p = os.path.join(CONFIG_DIR, name)
    if not os.path.exists(p):
        return copy.deepcopy(default)
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _write(name: str, data) -> None:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    p = os.path.join(CONFIG_DIR, name)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def _deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_settings() -> dict:
    with _lock:
        base = _read("settings.json", {"org": {}, "llm": {"active": "offline", "profiles": {"offline": {"type": "offline"}}}})
        local = _read("settings.local.json", {})
    s = _deep_merge(base, local)
    if os.environ.get("BATON_LLM"):  # 실행 시 환경변수로 모델 교체 가능
        s["llm"]["active"] = os.environ["BATON_LLM"]
    return s


def save_settings(public: dict, secrets: dict | None = None) -> None:
    """공개 설정은 settings.json, API 키는 settings.local.json 에 나눠 저장."""
    with _lock:
        _write("settings.json", public)
        if secrets is not None:
            local = _read("settings.local.json", {}) or {}
            prof = local.setdefault("llm", {}).setdefault("profiles", {})
            for name, key in secrets.items():
                prof.setdefault(name, {})["api_key"] = key
            _write("settings.local.json", local)


def public_settings() -> dict:
    """화면에 내려줄 설정(키는 가림)."""
    s = load_settings()
    for name, p in s["llm"]["profiles"].items():
        key = p.pop("api_key", "")
        p["has_key"] = bool(key or (p.get("api_key_env") and os.environ.get(p["api_key_env"])))
    return s


def load_template() -> dict:
    with _lock:
        return _read("template.json", {"title": "업무 인수인계서", "sections": []})


def save_template(t: dict) -> None:
    with _lock:
        _write("template.json", t)


def prompt(name: str) -> str:
    p = os.path.join(CONFIG_DIR, "prompts", name + ".txt")
    with open(p, encoding="utf-8") as f:
        return f.read()
