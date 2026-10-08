"""LLM 연결 계층 – 특정 모델에 종속되지 않는 구조.

- 'openai' 형식: OpenAI 호환 Chat Completions API(/v1/chat/completions)를 쓰는 모든 모델
  (Ollama·vLLM·llama.cpp 서버로 띄운 Gemma/Llama/EXAONE/GPT-OSS, HyperCLOVA X, Solar 등)
- 'offline' 형식: LLM 없이 규칙엔진만 사용(폐쇄망·심사 환경에서도 반드시 동작)

표준 라이브러리(urllib)만 사용하므로 별도 SDK 설치가 필요 없다.
"""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request

from .config import load_settings


class LLMError(Exception):
    pass


class OfflineClient:
    available = False

    def __init__(self, name="offline", profile=None):
        self.name = name
        self.label = (profile or {}).get("label", "오프라인 규칙엔진")

    def chat(self, *a, **k):
        raise LLMError("오프라인 모드에서는 LLM을 호출하지 않습니다")


class OpenAICompatClient:
    available = True

    def __init__(self, name: str, profile: dict, timeout: int = 180):
        self.name = name
        self.label = profile.get("label") or profile.get("model", name)
        self.base_url = profile["base_url"].rstrip("/")
        self.model = profile["model"]
        self.api_key = profile.get("api_key") or (os.environ.get(profile.get("api_key_env") or "", ""))
        self.timeout = timeout
        self.extra = profile.get("extra_body", {})

    def chat(self, messages: list[dict], max_tokens: int = 2048, temperature: float = 0.2) -> str:
        body = {"model": self.model, "messages": messages, "temperature": temperature,
                "max_tokens": max_tokens, "stream": False, **self.extra}
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})},
            method="POST",
        )
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=ctx) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")[:300]
            raise LLMError(f"HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise LLMError(f"연결 실패: {getattr(e, 'reason', e)}") from e
        try:
            msg = data["choices"][0]["message"]
            text = msg.get("content") or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError(f"응답 형식 오류: {str(data)[:200]}") from e
        # 추론형 모델(<think>…</think>)의 생각 과정은 제거
        return re.sub(r"(?s)<think>.*?</think>", "", text).strip()


def get_client(name: str | None = None):
    s = load_settings()
    name = name or s["llm"].get("active", "offline")
    prof = s["llm"]["profiles"].get(name)
    if not prof or prof.get("type") == "offline":
        return OfflineClient(name, prof)
    return OpenAICompatClient(name, prof, timeout=int(s["llm"].get("timeout_sec", 180)))


# ───────────── 작은 모델도 견딜 수 있는 JSON 파싱
def parse_json(text: str):
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    starts = [i for i in (t.find("["), t.find("{")) if i >= 0]
    if not starts:
        raise ValueError("JSON 없음")
    t = t[min(starts):]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    t2 = re.sub(r",\s*([\]}])", r"\1", t)  # 끝 쉼표 제거
    for end in range(len(t2), 0, -1):  # 뒤쪽 잡음/잘림 대응: 가장 긴 유효 접두부
        if t2[end - 1] in "]}":
            try:
                return json.loads(t2[:end])
            except json.JSONDecodeError:
                continue
    # 잘린 배열: 마지막 완결 객체까지만 살린다
    if t2.startswith("["):
        cut = t2.rfind("}")
        while cut > 0:
            try:
                return json.loads(t2[:cut + 1] + "]")
            except json.JSONDecodeError:
                cut = t2.rfind("}", 0, cut)
    raise ValueError("JSON 해석 실패")


def chat_json(client, system: str, user: str, max_tokens: int = 2048, retries: int = 1):
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    last = None
    for attempt in range(retries + 1):
        out = client.chat(msgs, max_tokens=max_tokens, temperature=0.1 if attempt else 0.2)
        try:
            return parse_json(out)
        except ValueError as e:
            last = e
            msgs = msgs + [{"role": "assistant", "content": out[:2000]},
                           {"role": "user", "content": "형식 오류입니다. 설명 없이 올바른 JSON만 다시 출력하세요."}]
    raise LLMError(f"JSON 형식 응답을 받지 못함: {last}")


# ───────────── 모델 자가진단: '2종 이상 모델 정상 구동' 입증용
SELF_TEST_DOCS = [
    ("S1", "[메일] 증빙자료는 5월 22일까지 도로 먼저 보내주셔야 합니다."),
    ("S2", "[공문] 제출 기한: 2026. 5. 29.(금)까지 관리수준진단 실적 제출"),
]


def self_check(name: str) -> dict:
    res = {"profile": name, "tests": [], "ok": False}
    client = get_client(name)
    res["label"] = client.label
    if not client.available:
        res["tests"].append({"name": "규칙엔진", "ok": True, "detail": "LLM 없이 동작(기본 기능 보장)"})
        res["ok"] = True
        return res
    t0 = time.time()
    try:
        out = client.chat([{"role": "user", "content": "한 단어로만 답하세요: 대한민국의 수도는?"}], max_tokens=200)
        res["tests"].append({"name": "연결·한국어 응답", "ok": "서울" in out, "detail": out[:60],
                             "sec": round(time.time() - t0, 1)})
    except LLMError as e:
        res["tests"].append({"name": "연결·한국어 응답", "ok": False, "detail": str(e)[:200]})
        return res
    t0 = time.time()
    try:
        data = chat_json(client, "JSON만 출력하는 도우미입니다.",
                         '다음 정보를 JSON 객체로 출력: {"task": "수준진단 제출", "month": 5, "day": 29}')
        ok = isinstance(data, dict) and int(data.get("month", 0)) == 5
        res["tests"].append({"name": "JSON 구조화 출력", "ok": ok, "detail": json.dumps(data, ensure_ascii=False)[:80],
                             "sec": round(time.time() - t0, 1)})
    except (LLMError, ValueError, TypeError) as e:
        res["tests"].append({"name": "JSON 구조화 출력", "ok": False, "detail": str(e)[:200]})
    t0 = time.time()
    try:
        ctx = "\n".join(f"[{i}] {t}" for i, t in SELF_TEST_DOCS)
        out = client.chat([{"role": "system", "content": "근거 자료만 사용하고 문장 끝에 [근거ID]를 붙이세요."},
                           {"role": "user", "content": f"{ctx}\n\n질문: 도에 먼저 보내야 하는 기한은?"}], max_tokens=300)
        ok = "S1" in out and "22" in out
        res["tests"].append({"name": "출처 인용 준수", "ok": ok, "detail": out[:80], "sec": round(time.time() - t0, 1)})
    except LLMError as e:
        res["tests"].append({"name": "출처 인용 준수", "ok": False, "detail": str(e)[:200]})
    res["ok"] = all(t["ok"] for t in res["tests"])
    return res
