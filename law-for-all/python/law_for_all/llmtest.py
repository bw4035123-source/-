"""여러 LLM으로 같은 질문을 돌려 주요 기능이 정상 구동되는지 확인하고 결과 문서를 만든다(모델 비종속 입증용).

  python run.py --llm-test                                   # 설정된 모든 공급자
  python run.py --llm-test ollama:gemma3:4b,ollama:exaone3.5:7.8b
  python run.py --llm-test openai:gemma-3-27b-it             # OpenAI 호환 서버(vLLM 등)의 모델

대상 표기: 공급자[:모델] — 공급자는 mock · openai · anthropic · ollama, 모델을 적으면 그 모델로 바꿔 실행.
결과는 실행 폴더의 LLM_검증결과_날짜.md 로 저장한다(입력 자료는 건드리지 않음).
"""
from __future__ import annotations

import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from .analyze import analyze
from .ask import ask
from .config import config
from .llm import PROVIDER_IDS, create_providers, list_providers

MODEL_ENV = {"openai": "OPENAI_MODEL", "anthropic": "ANTHROPIC_MODEL", "ollama": "OLLAMA_MODEL"}

# 국민·공직자 질문과 상황 분석 — 내장 토픽과 근거 조문이 있는 대표 사례
CASES = [
    ("ask", "citizen", "윗집 층간소음 기준이 어떻게 되나요?"),
    ("ask", "citizen", "퇴사했는데 마지막 월급을 안 줘요"),
    ("ask", "officer", "청탁금지법상 외부강의 사례금 상한과 신고 기한은?"),
    ("analyze", "citizen", "전세 계약이 끝났는데 집주인이 두 달째 보증금 1억 원을 돌려주지 않고 연락도 잘 안 받아요."),
]


def parse_targets(spec: str | None) -> list[tuple[str, str | None]]:
    if not spec:
        return [(p["id"], None) for p in list_providers(config.llm) if p["configured"]]
    out = []
    for raw in spec.split(","):
        raw = raw.strip()
        if not raw:
            continue
        pid, _, model = raw.partition(":")
        if pid not in PROVIDER_IDS:
            raise SystemExit(f"알 수 없는 공급자: {pid} (mock · openai · anthropic · ollama 중 하나)")
        out.append((pid, model or None))
    return out


@contextmanager
def model_override(pid: str, model: str | None):
    key = MODEL_ENV.get(pid)
    if not (key and model):
        yield
        return
    old = os.environ.get(key)
    os.environ[key] = model
    try:
        yield
    finally:
        if old is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = old


def run_case(kind: str, mode: str, text: str, pid: str) -> dict:
    requested = config.llm.get(pid, {}).get("model") if pid != "mock" else None
    t = time.time()
    r = ask(text, mode, pid) if kind == "ask" else analyze(text, pid)
    guard = r.get("guard", {})
    used_llm = r["provider"]["kind"] == "llm" and not guard.get("fallbackReason")
    return {
        "kind": kind, "mode": mode, "text": text,
        "model": requested or r["provider"].get("model") or r["provider"]["label"],
        "used_llm": used_llm, "passed": bool(guard.get("passed")),
        "citations": len(r.get("citations", [])), "removed": len(guard.get("removedCitations", [])),
        "fallback": guard.get("fallbackReason", ""), "seconds": round(time.time() - t, 1),
        "preview": (r.get("summary") or (r.get("analyses") or [{}])[0].get("perspectives", {}).get("judge", {}).get("outlook", "")).replace("\n", " ")[:90],
    }


def run(spec: str | None, out_dir: Path) -> tuple[Path, bool]:
    targets = parse_targets(spec)
    if not targets:
        raise SystemExit("설정된 LLM이 없습니다. .env.local 에 LLM 설정을 넣거나 대상을 지정하세요(예: --llm-test ollama:gemma3:4b).")
    rows = []
    # 로컬 소형 모델은 첫 호출에 모델을 메모리에 올리느라 오래 걸린다 — 시험 동안만 제한시간을 넉넉히(직접 정했으면 그 값)
    timeout_set = "LLM_TIMEOUT_MS" in os.environ
    if not timeout_set:
        os.environ["LLM_TIMEOUT_MS"] = "120000"
    try:
        _run_targets(targets, rows)
    finally:
        if not timeout_set:
            os.environ.pop("LLM_TIMEOUT_MS", None)
    return _write_report(rows, out_dir)


def _run_targets(targets: list, rows: list) -> None:
    for pid, model in targets:
        with model_override(pid, model):
            label = f"{pid}:{model}" if model else pid
            print(f"▶ {label}")
            if pid == "ollama":  # 모델 적재(예열) — 결과·시간에 넣지 않음
                try:
                    create_providers(config.llm)["ollama"].generate(system="", messages=[{"role": "user", "content": "안녕"}], max_tokens=1)
                except Exception as e:  # 연결 실패는 아래 사례에서 그대로 기록된다
                    print(f"   (예열 실패: {e})")
            for kind, mode, text in CASES:
                try:
                    res = run_case(kind, mode, text, pid)
                except Exception as e:  # 한 모델 실패가 전체를 멈추지 않게
                    res = {"kind": kind, "mode": mode, "text": text, "model": model or pid, "used_llm": False, "passed": False, "citations": 0, "removed": 0, "fallback": f"오류: {e}", "seconds": 0, "preview": ""}
                res["target"] = label
                rows.append(res)
                mark = "✓" if (res["used_llm"] or pid == "mock") and res["passed"] else "✗"
                print(f"   {mark} {('질문' if kind == 'ask' else '상황 분석')} · {text[:24]}… — {res['seconds']}초, 근거 {res['citations']}건{', ' + res['fallback'] if res['fallback'] else ''}")


def _write_report(rows: list, out_dir: Path) -> tuple[Path, bool]:
    def ok(r: dict) -> bool:
        return (r["used_llm"] or r["target"].startswith("mock")) and r["passed"]

    stamp = datetime.now()
    lines = [
        "# 법이음 LLM 교체 구동 검증 결과", "",
        f"- 실행 일시: {stamp:%Y-%m-%d %H:%M}",
        f"- 법령 데이터: {'국가법령정보 실시간' if config.law_access else '내장 공식 원문'}",
        "- 판정 기준: 해당 모델이 실제로 답변을 만들었고(규칙기반 대체 없음), 인용 검증 가드를 통과(근거 목록 밖 조문 없음)", "",
        "## 모델별 요약", "", "| 대상 | 모델 | 통과 | 평균 응답(초) |", "|---|---|---|---|",
    ]
    for label in dict.fromkeys(r["target"] for r in rows):
        rs = [r for r in rows if r["target"] == label]
        lines.append(f"| {label} | {rs[0]['model']} | {sum(ok(r) for r in rs)}/{len(rs)} | {sum(r['seconds'] for r in rs) / len(rs):.1f} |")
    lines += ["", "## 상세", "", "| 대상 | 기능 | 질문 | 결과 | 근거 조문 | 제거된 인용 | 응답(초) | 답변 앞부분·비고 |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        fn = ("국민 질문" if r["mode"] == "citizen" else "공직자 질문") if r["kind"] == "ask" else "상황 분석"
        note = r["fallback"] or r["preview"]
        lines.append(f"| {r['target']} | {fn} | {r['text'][:30]} | {'통과' if ok(r) else '미통과'} | {r['citations']} | {r['removed']} | {r['seconds']} | {note.replace('|', '/')} |")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"LLM_검증결과_{stamp:%Y%m%d_%H%M%S}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    real = {r["target"] for r in rows if not r["target"].startswith("mock") and ok(r)}
    return path, len({t for t in real if all(ok(x) for x in rows if x["target"] == t)}) >= 2
