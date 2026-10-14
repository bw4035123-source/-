"""LLM 비종속 계층(Adapter Pattern) — 모든 공급자가 같은 generate() 인터페이스를 구현한다.
표준 라이브러리 urllib 만 사용(외부 SDK 불필요)."""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

PROVIDER_IDS = ["mock", "openai", "anthropic", "ollama"]
HINTS = {
    "mock": "설정 불필요 · 내장 법령 토픽으로 즉시 답변",
    "openai": "OPENAI_API_KEY 필요(OPENAI_BASE_URL로 Solar·vLLM 등 호환 서버 사용 가능)",
    "anthropic": "ANTHROPIC_API_KEY 필요",
    "ollama": "로컬 Ollama 실행 + OLLAMA_MODEL 내려받기 필요",
}


class LLMError(Exception):
    def __init__(self, message: str, provider: str, status: int | None = None):
        super().__init__(message)
        self.provider = provider
        self.status = status


def post_json(provider: str, url: str, body: dict, headers: dict, timeout_ms: int) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout_ms / 1000) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        detail = raw[:300]
        try:
            j = json.loads(raw)
            err = j.get("error")
            detail = (err.get("message") if isinstance(err, dict) else err) or detail
        except ValueError:
            pass
        raise LLMError(f"{provider} API 오류({e.code}): {detail}", provider, e.code) from e
    except (socket.timeout, TimeoutError) as e:
        raise LLMError(f"{provider} 연결 실패: 응답 제한시간({round(timeout_ms / 1000)}초) 초과", provider) from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise LLMError(f"{provider} 연결 실패: {getattr(e, 'reason', e)}", provider) from e


class MockProvider:
    """규칙기반 엔진(No-LLM) — 생성형 문장을 만들지 않아 환각이 원천적으로 없음"""
    id, kind, label, model = "mock", "rule", "규칙기반 엔진(LLM 없음)", "law-rule-engine-v1"

    def is_configured(self) -> bool:
        return True

    def generate(self, **_):
        raise RuntimeError("규칙기반 엔진은 generate()를 사용하지 않습니다.")


class OpenAIProvider:
    """OpenAI Chat Completions — OPENAI_BASE_URL 로 Upstage Solar·vLLM·LM Studio 등 호환 서버 사용"""
    id, kind = "openai", "llm"

    def __init__(self, cfg: dict, timeout_ms: int):
        self.cfg, self.timeout_ms = cfg, timeout_ms
        self.official = "api.openai.com" in cfg["baseUrl"]
        self.label = "OpenAI" if self.official else "OpenAI 호환(Solar·vLLM 등)"
        self.model = cfg["model"]

    def is_configured(self) -> bool:
        return bool(self.cfg["apiKey"]) or not self.official

    def generate(self, system: str, messages: list, json_mode: bool = False, temperature: float = 0.2, max_tokens: int = 2000) -> dict:
        body = {"model": self.model, "temperature": temperature, "max_tokens": max_tokens, "messages": [{"role": "system", "content": system}, *messages]}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"authorization": f"Bearer {self.cfg['apiKey']}"} if self.cfg["apiKey"] else {}
        res = post_json(self.id, self.cfg["baseUrl"].rstrip("/") + "/chat/completions", body, headers, self.timeout_ms)
        return {"text": ((res.get("choices") or [{}])[0].get("message") or {}).get("content") or "", "model": res.get("model") or self.model}


class AnthropicProvider:
    """Anthropic Messages API"""
    id, kind, label = "anthropic", "llm", "Anthropic Claude"

    def __init__(self, cfg: dict, timeout_ms: int):
        self.cfg, self.timeout_ms, self.model = cfg, timeout_ms, cfg["model"]

    def is_configured(self) -> bool:
        return bool(self.cfg["apiKey"])

    def generate(self, system: str, messages: list, json_mode: bool = False, temperature: float = 0.2, max_tokens: int = 2000) -> dict:
        if json_mode:
            system += "\n\n반드시 하나의 JSON 객체만 출력하고, 코드블록 표시나 설명 문장을 덧붙이지 마세요."
        body = {"model": self.model, "max_tokens": max_tokens, "temperature": temperature, "system": system, "messages": messages}
        res = post_json(self.id, self.cfg["baseUrl"].rstrip("/") + "/v1/messages", body, {"x-api-key": self.cfg["apiKey"], "anthropic-version": "2023-06-01"}, self.timeout_ms)
        text = "".join(c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text")
        return {"text": text, "model": res.get("model") or self.model}


class OllamaProvider:
    """Ollama — 폐쇄망·온프레미스 로컬 LLM(EXAONE, Gemma, Llama, Solar 등)"""
    id, kind, label = "ollama", "llm", "Ollama(로컬 LLM)"

    def __init__(self, cfg: dict, timeout_ms: int):
        self.cfg, self.timeout_ms, self.model = cfg, timeout_ms, cfg["model"]

    def is_configured(self) -> bool:
        return bool(self.cfg["baseUrl"] and self.model)

    def health_check(self) -> bool:
        try:
            with urllib.request.urlopen(self.cfg["baseUrl"].rstrip("/") + "/api/tags", timeout=1.5) as r:
                j = json.loads(r.read().decode("utf-8"))
            want = self.model if ":" in self.model else f"{self.model}:latest"
            return any(m.get("name") in (want, self.model) for m in j.get("models") or [])
        except Exception:  # noqa: BLE001 — 연결 불가 = 미설정
            return False

    def generate(self, system: str, messages: list, json_mode: bool = False, temperature: float = 0.2, max_tokens: int = 2000) -> dict:
        body = {"model": self.model, "stream": False, "options": {"temperature": temperature, "num_predict": max_tokens}, "messages": [{"role": "system", "content": system}, *messages]}
        if json_mode:
            body["format"] = "json"
        res = post_json(self.id, self.cfg["baseUrl"].rstrip("/") + "/api/chat", body, {}, self.timeout_ms)
        return {"text": (res.get("message") or {}).get("content") or "", "model": res.get("model") or self.model}


def create_providers(cfg: dict) -> dict:
    t = cfg["timeoutMs"]
    return {"mock": MockProvider(), "openai": OpenAIProvider(cfg["openai"], t), "anthropic": AnthropicProvider(cfg["anthropic"], t), "ollama": OllamaProvider(cfg["ollama"], t)}


def default_provider_id(cfg: dict) -> str:
    return cfg["defaultProvider"] if cfg["defaultProvider"] in PROVIDER_IDS else "mock"


def resolve_provider(cfg: dict, requested: str | None = None):
    """요청값 → 환경변수 기본값 → mock. 미설정 공급자는 규칙엔진으로 안전 대체"""
    allp = create_providers(cfg)
    pid = requested if requested in PROVIDER_IDS else default_provider_id(cfg)
    p = allp[pid]
    if p.is_configured():
        return p, None
    return allp["mock"], f"{p.label} 설정(API 키 등)이 없어 규칙기반 엔진으로 답변했습니다."


def list_providers(cfg: dict, probe: bool = True) -> list[dict]:
    allp = create_providers(cfg)
    d = default_provider_id(cfg)
    out = []
    for pid in PROVIDER_IDS:
        p = allp[pid]
        configured = p.is_configured()
        if configured and probe and hasattr(p, "health_check"):
            configured = p.health_check()
        out.append({"id": pid, "label": p.label, "model": p.model, "kind": p.kind, "configured": configured, "isDefault": pid == d, "hint": HINTS[pid]})
    return out
