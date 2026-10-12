"""AI 모델 연결(선택). 다이수의 모든 판정은 규칙과 계산으로 하고, 모델은 질문 답변 문장 다듬기에만 쓴다.

- OpenAI 호환 Chat Completions API(Ollama·vLLM·HyperCLOVA X 등) 또는 오프라인(모델 없음)
- 내 PC(127.0.0.1·localhost) 주소는 프록시를 거치지 않고 바로 연결(기관 프록시 환경에서 시간 초과 방지)
- 표준 라이브러리만 사용
"""
from __future__ import annotations

import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

from . import config


class LLMError(Exception):
    pass


RX_THINK = re.compile(r"<(think|thought|reasoning)>.*?</\1>\s*", re.S | re.I)
RX_THINK_OPEN = re.compile(r"<(think|thought|reasoning)>.*\Z", re.S | re.I)
LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def strip_think(text: str) -> str:
    return RX_THINK_OPEN.sub("", RX_THINK.sub("", text or "")).strip()


def opener_for(url: str):
    """loopback 주소는 프록시 설정(HTTP_PROXY 등)을 무시하고 직접 연결."""
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host in LOOPBACK:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()))


class Offline:
    available = False
    label = "오프라인 규칙엔진"

    def chat(self, *a, **k):
        raise LLMError("오프라인 모드")


class Client:
    available = True

    def __init__(self, profile: dict):
        self.label = profile.get("label") or profile.get("model", "")
        self.base_url = profile["base_url"].rstrip("/")
        self.model = profile["model"]
        env = profile.get("api_key_env") or ""
        self.api_key = profile.get("api_key") or (os.environ.get(env, "") if re.fullmatch(r"[A-Z0-9_]*API_KEY", env) else "")
        self.timeout = int(profile.get("timeout", 120))

    def _post(self, body: dict) -> dict:
        url = self.base_url + "/chat/completions"
        req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})})
        try:
            with opener_for(url).open(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise LLMError(f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:200]}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise LLMError(f"연결 실패({self.base_url}): {getattr(e, 'reason', e)}") from e

    def chat(self, messages: list[dict], max_tokens: int = 800) -> str:
        body = {"model": self.model, "messages": messages, "temperature": 0.2, "max_tokens": max_tokens, "stream": False}
        try:
            data = self._post(body)
        except LLMError as e:  # system 역할을 받지 않는 모델(일부 Gemma 등)
            if "400" not in str(e) and "422" not in str(e):
                raise
            sys_t = "\n".join(m["content"] for m in messages if m["role"] == "system")
            rest = [dict(m) for m in messages if m["role"] != "system"]
            rest[0]["content"] = sys_t + "\n\n" + rest[0]["content"]
            data = self._post(dict(body, messages=rest))
        try:
            text = data["choices"][0]["message"].get("content") or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError("응답 형식 오류") from e
        out = strip_think(text)
        if not out:
            raise LLMError("빈 응답")
        return out


def get_client():
    s = config.settings()
    prof = s["profiles"].get(s.get("active_profile", "offline"), {})
    if prof.get("kind") != "openai" or not prof.get("base_url") or not prof.get("model"):
        return Offline()
    return Client(prof)


def check(profile_name: str) -> dict:
    s = config.settings()
    prof = s["profiles"].get(profile_name)
    if not prof:
        return {"ok": False, "detail": "없는 프로필"}
    if prof.get("kind") != "openai":
        return {"ok": True, "detail": "AI 모델 없이 규칙엔진으로 동작합니다."}
    try:
        out = Client(prof).chat([{"role": "user", "content": "한 단어로만 답하세요: 대한민국의 수도는?"}], max_tokens=200)
        return {"ok": "서울" in out, "detail": out[:80]}
    except LLMError as e:
        return {"ok": False, "detail": str(e)[:200]}
