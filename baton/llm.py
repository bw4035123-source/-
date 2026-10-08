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


# 행정안전부 AI 공통기반 지원(예정) 모델 계열. 앱 기능은 계열과 무관하고, 아래는 응답 차이를 흡수하기 위한 정보다.
FAMILIES = [
    {"key": "gemma", "name": "젬마(Gemma)", "maker": "Google", "match": r"gemma"},
    {"key": "llama", "name": "라마(Llama)", "maker": "Meta", "match": r"llama"},
    {"key": "gpt-oss", "name": "GPT-OSS", "maker": "OpenAI", "match": r"gpt-oss|gpt_oss", "reasoning": True},
    {"key": "exaone", "name": "엑사원(EXAONE)", "maker": "LG AI연구원", "match": r"exaone"},
    {"key": "hyperclovax", "name": "하이퍼클로바X(HyperCLOVA X)", "maker": "네이버", "match": r"hyperclova|hcx"},
    {"key": "solar", "name": "솔라(Solar)", "maker": "업스테이지", "match": r"solar"},
    {"key": "qwen", "name": "큐원(Qwen)", "maker": "Alibaba", "match": r"qwen", "reasoning": True},
]
RX_THINK = re.compile(r"<(think|thought|reasoning)>.*?</\1>\s*", re.S | re.I)
RX_THINK_OPEN = re.compile(r"<(think|thought|reasoning)>.*\Z", re.S | re.I)  # 길이 제한으로 닫히지 않은 생각 과정


def strip_think(text: str) -> str:
    """추론형 모델의 생각 과정을 지운다. 닫히지 않은 생각 과정은 답이 아니므로 통째로 버린다."""
    return RX_THINK_OPEN.sub("", RX_THINK.sub("", text or "")).strip()


def family_of(model: str) -> dict | None:
    m = (model or "").lower()
    return next((f for f in FAMILIES if re.search(f["match"], m)), None)


def _merge_system(messages: list[dict]) -> list[dict]:
    """system 역할을 받지 않는 서버(일부 젬마 등): 지시문을 첫 사용자 메시지 앞에 합친다."""
    sys_text = "\n".join(m["content"] for m in messages if m["role"] == "system")
    rest = [dict(m) for m in messages if m["role"] != "system"]
    for m in rest:
        if m["role"] == "user":
            m["content"] = sys_text + "\n\n" + m["content"]
            break
    else:
        rest.insert(0, {"role": "user", "content": sys_text})
    return rest


class OpenAICompatClient:
    """OpenAI 호환(/v1/chat/completions) 또는 Ollama 기본 API(/api/chat)."""

    available = True

    def __init__(self, name: str, profile: dict, timeout: int = 180):
        self.name = name
        self.label = profile.get("label") or profile.get("model", name)
        self.base_url = profile["base_url"].rstrip("/")
        self.model = profile["model"]
        self.api_key = profile.get("api_key") or (os.environ.get(profile.get("api_key_env") or "", ""))
        self.timeout = timeout
        self.extra = profile.get("extra_body", {})
        self.native_ollama = profile.get("type") == "ollama"
        self.family = family_of(self.model)

    def _post(self, url: str, body: dict) -> dict:
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=ssl.create_default_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")[:300]
            raise LLMError(f"HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise LLMError(f"연결 실패({self.base_url}): {getattr(e, 'reason', e)}") from e

    def _once(self, messages: list[dict], max_tokens: int, temperature: float) -> tuple[str, str]:
        if self.native_ollama:
            data = self._post(self.base_url.removesuffix("/v1") + "/api/chat",
                              {"model": self.model, "messages": messages, "stream": False,
                               "options": {"temperature": temperature, "num_predict": max_tokens}})
            return (data.get("message") or {}).get("content") or "", data.get("done_reason", "")
        data = self._post(self.base_url + "/chat/completions",
                          {"model": self.model, "messages": messages, "temperature": temperature,
                           "max_tokens": max_tokens, "stream": False, **self.extra})
        try:
            ch = data["choices"][0]
            return ch["message"].get("content") or "", ch.get("finish_reason") or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError(f"응답 형식 오류: {str(data)[:200]}") from e

    def chat(self, messages: list[dict], max_tokens: int = 2048, temperature: float = 0.2) -> str:
        if self.family and self.family.get("reasoning"):
            max_tokens = max(max_tokens, 1536)  # 추론형 모델은 생각 과정에도 토큰을 쓴다
        try:
            text, finish = self._once(messages, max_tokens, temperature)
        except LLMError as e:
            msg = str(e).lower()
            if any(m["role"] == "system" for m in messages) and ("system" in msg or "http 400" in msg or "http 422" in msg):
                messages = _merge_system(messages)
                text, finish = self._once(messages, max_tokens, temperature)
            else:
                raise
        if not strip_think(text) and (finish == "length" or text.strip()):
            # 생각만 하다 길이 제한에 걸려 답이 빈 경우: 한도를 늘려 한 번 더
            text, finish = self._once(messages, min(max_tokens * 4, 8192), temperature)
        return strip_think(text)

    def models(self) -> list[str]:
        """서버에 실제 등록된 모델 이름(OpenAI 호환 /models, Ollama /api/tags)."""
        urls = ([] if self.native_ollama else [self.base_url + "/models"]) + [self.base_url.removesuffix("/v1") + "/api/tags"]
        last = ""
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})
                with urllib.request.urlopen(req, timeout=15) as r:
                    data = json.loads(r.read().decode("utf-8"))
                names = [m.get("id") for m in data.get("data", [])] or [m.get("name") for m in data.get("models", [])]
                return [n for n in names if n]
            except Exception as e:  # 다음 경로 시도
                last = str(e)
        raise LLMError(f"모델 목록을 받지 못했습니다({self.base_url}): {last}")


def get_client(name: str | None = None):
    s = load_settings()
    name = name or s["llm"].get("active", "offline")
    prof = s["llm"]["profiles"].get(name)
    if not prof or prof.get("type") not in ("openai", "ollama"):
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
    fam = getattr(client, "family", None)
    res["family"] = f"{fam['name']} · {fam['maker']}" if fam else ""
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
