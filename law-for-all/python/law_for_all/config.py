"""환경설정 — .env.local → .env 순으로 읽고, 이미 설정된 환경변수가 우선한다."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # python/ (run.py 위치)


def load_dotenv() -> None:
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def env(k: str, d: str = "") -> str:
    return (os.environ.get(k) or d).strip()


DEFAULT_LAW_PROXY_URL = ""  # 기본: 중계 서버 없이 LAW_API_OC 로 law.go.kr 직접 호출
_OFF = {"off", "none", "direct", "false", "0"}


def law_proxy() -> dict | None:
    """법령 API 중계 서버(선택). LAW_PROXY_URL 이 비어 있거나 off 면 None → LAW_API_OC 로 law.go.kr 직접 호출"""
    raw = os.environ.get("LAW_PROXY_URL", DEFAULT_LAW_PROXY_URL).strip()
    if not raw or raw.lower() in _OFF:
        return None
    return {"url": raw.rstrip("/"), "token": env("LAW_PROXY_TOKEN")}


class Config:
    """요청 시점마다 환경변수를 읽어 재시작 없이 테스트에서 바꿀 수 있게 함"""

    @property
    def law_api_oc(self) -> str:
        return env("LAW_API_OC") or env("LAW_OC")

    @property
    def law_proxy(self) -> dict | None:
        return law_proxy()

    @property
    def law_access(self) -> str:
        """실시간 조회 가능 여부 겸 LawService 인자: 중계 서버가 있으면 그것으로, 없으면 OC 로"""
        return "proxy" if law_proxy() else self.law_api_oc

    @property
    def llm(self) -> dict:
        return {
            "defaultProvider": env("LLM_PROVIDER", "mock"),
            "timeoutMs": int(env("LLM_TIMEOUT_MS", "45000") or 45000),
            "openai": {"apiKey": env("OPENAI_API_KEY"), "model": env("OPENAI_MODEL", "gpt-4o-mini"), "baseUrl": env("OPENAI_BASE_URL", "https://api.openai.com/v1")},
            "anthropic": {"apiKey": env("ANTHROPIC_API_KEY"), "model": env("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "baseUrl": env("ANTHROPIC_BASE_URL", "https://api.anthropic.com")},
            "ollama": {"baseUrl": env("OLLAMA_BASE_URL", "http://localhost:11434"), "model": env("OLLAMA_MODEL", "exaone3.5:7.8b")},
        }


config = Config()
