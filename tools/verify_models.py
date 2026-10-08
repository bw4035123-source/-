"""모델 교체 검증: 같은 기능을 여러 모델로 돌려 정상 동작하는지 확인하고 보고서(verify_report.md)를 남긴다.

예)
  # Ollama 에 모델 두 개를 받아 둔 경우
  python tools/verify_models.py --base-url http://localhost:11434/v1 --models gemma3:4b exaone3.5:7.8b
  # 행정안전부 AI 공통기반·vLLM 등 OpenAI 호환 주소(키는 환경변수 LLM_API_KEY)
  python tools/verify_models.py --base-url https://…/v1 --models 모델A 모델B
  # 모델 없이 연결 경로만 시험(가짜 모델 서버 자동 실행 – 실제 모델 성능 검증이 아님)
  python tools/verify_models.py --mock

'통과'는 오류 없이 응답했다는 뜻만이 아니라, 결과가 모의자료의 정답(기한 날짜, 원문 전화번호, 출처 표시,
자료에 없는 질문에 '찾을 수 없음')과 맞는다는 뜻이다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("BATON_WORKSPACE", tempfile.mkdtemp(prefix="baton_verify_"))

from baton.draft import build_draft  # noqa: E402
from baton.ingest import ingest_folder  # noqa: E402
from baton.llm import OpenAICompatClient, family_of, self_check  # noqa: E402
from baton.qa import ask  # noqa: E402

SAMPLE = os.path.join(ROOT, "sample_data", "전임자_업무폴더")


def make_client(provider: str, base: str, model: str) -> OpenAICompatClient:
    return OpenAICompatClient(model, {"type": provider, "base_url": base, "model": model, "label": model,
                                      "api_key_env": "LLM_API_KEY"}, timeout=600)


def _project():
    r = ingest_folder(SAMPLE)
    return {"id": "verify", "docs": r["docs"], "chunks": r["chunks"], "from_name": "김바통 주무관",
            "base_date": "2026-05-11", "source_path": SAMPLE}


def run_checks(client) -> list[tuple[str, bool, float, str]]:
    res = []
    # 1) 기본 응답 시험(한국어·JSON·출처 인용)
    t = time.time()
    import baton.llm as L

    orig = L.get_client
    L.get_client = lambda name=None: client  # self_check 가 이 클라이언트를 쓰도록
    try:
        sc = self_check(client.name)
    finally:
        L.get_client = orig
    res.append(("기본 응답(한국어·JSON·출처 인용)", sc["ok"], time.time() - t,
                " / ".join(f"{'✔' if x['ok'] else '✖'}{x['name']}" for x in sc["tests"])))

    # 2) 인수인계서 초안: 모델이 쓴 항목이 있고, 근거 없는 문장은 걸러졌는가
    p = _project()
    t = time.time()
    d = build_draft(p, client)
    llm_secs = [s for s in d["sections"] if s["mode"] == "llm"]
    items = [i for s in llm_secs for i in s["items"]]
    unsupported = sum(1 for i in items if i["status"] == "unsupported")
    ok = bool(llm_secs) and not d["warnings"]
    res.append(("인수인계서 초안(모델 작성 + 근거 검증)", ok, time.time() - t,
                f"모델이 쓴 항목 {len(items)}개(근거 없어 보류 {unsupported}개), 경고 {len(d['warnings'])}건"
                + (f": {d['warnings'][0][:80]}" if d["warnings"] else "")))
    p["draft"] = d

    # 3) 후임자 질문: 답에 나온 날짜가 원문과 맞고 출처가 붙는가
    t = time.time()
    a = ask(p, "개인정보 수준진단 증빙자료는 도에 언제까지 보내야 해?", client)
    ok = a["mode"] == "llm" and "22" in a["answer"] and bool(a["sources"])
    res.append(("후임자 질문 답변(날짜가 원문과 일치·출처 표시)", ok, time.time() - t, a["answer"][:70].replace("\n", " ")))

    t = time.time()
    a = ask(p, "홈페이지 장애가 나면 어디로 연락해야 해?", client)
    phones = set(re.findall(r"0\d{1,2}-\d{3,4}-\d{4}", a["answer"]))
    real = {ph for c in p["chunks"] for ph in re.findall(r"0\d{1,2}-\d{3,4}-\d{4}", c["text"])}
    ok = a["mode"] == "llm" and bool(phones) and phones <= real
    res.append(("후임자 질문 답변(전화번호가 원문에 실제로 있음)", ok, time.time() - t,
                a["answer"][:70].replace("\n", " ") + ("" if ok else f" / 답의 번호 {sorted(phones) or '없음'}")))

    # 4) 자료에 없는 질문에 지어내지 않는가
    t = time.time()
    a = ask(p, "청사 주차장 정기권은 어떻게 신청해?", client)
    ok = not a["found"]
    res.append(("자료에 없는 질문은 '찾을 수 없음'", ok, time.time() - t, a["answer"][:60].replace("\n", " ")))
    return res


def main():
    ap = argparse.ArgumentParser(description="업무바통 모델 교체 검증")
    ap.add_argument("--base-url", default="http://localhost:11434/v1")
    ap.add_argument("--provider", default="openai", choices=["openai", "ollama"])
    ap.add_argument("--models", nargs="*", default=[])
    ap.add_argument("--mock", action="store_true", help="가짜 모델 서버로 연결 경로만 시험")
    ap.add_argument("--out", default=os.path.join(ROOT, "verify_report.md"))
    args = ap.parse_args()

    srv = None
    if args.mock:
        from tests import mock_llm

        srv, port = mock_llm.start()
        args.base_url = f"http://127.0.0.1:{port}/v1"
        args.models = args.models or ["gemma3:4b", "exaone3.5:7.8b", "gpt-oss:20b"]
    if not args.models:
        ap.error("--models 로 모델 이름을 하나 이상 주세요(예: gemma3:4b exaone3.5:7.8b)")

    lines = ["# 업무바통 모델 교체 검증 보고서", "",
             f"- 실행 시각: {dt.datetime.now():%Y-%m-%d %H:%M}",
             f"- 모델 서버: {args.base_url} ({args.provider})" + ("  ※ 가짜 모델 서버(연결 경로 시험용, 실제 성능 아님)" if args.mock else ""),
             f"- 시험 자료: sample_data/전임자_업무폴더 (모의데이터)", ""]
    summary = []
    for m in args.models:
        fam = family_of(m)
        print(f"\n▶ {m} ({fam['name'] if fam else '계열 미상'}) 검증 중…", flush=True)
        try:
            res = run_checks(make_client(args.provider, args.base_url, m))
        except Exception as e:  # 한 모델 실패가 전체를 멈추지 않도록
            res = [("실행", False, 0.0, f"{type(e).__name__}: {e}"[:200])]
        passed = sum(1 for r in res if r[1])
        summary.append((m, fam, passed, len(res), sum(r[2] for r in res)))
        lines += [f"## {m}" + (f" – {fam['name']} · {fam['maker']}" if fam else ""), "",
                  "| 기능 | 결과 | 시간(초) | 세부 |", "|---|---|---|---|"]
        for name, ok, sec, detail in res:
            lines.append(f"| {name} | {'✔ 통과' if ok else '✖ 실패'} | {sec:.1f} | {detail.replace('|', '/')} |")
            print(f"  {'✔' if ok else '✖'} {name} ({sec:.1f}초) {detail[:70]}")
        lines.append("")
    lines[6:6] = ["## 요약", "", "| 모델 | 계열 | 통과 | 걸린 시간(초) |", "|---|---|---|---|"] + [
        f"| {m} | {f['name'] if f else '-'} | {p}/{n} | {t:.0f} |" for m, f, p, n, t in summary] + [""]
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n보고서: {args.out}")
    if srv:
        srv.shutdown()
    ok_models = [m for m, _, p, n, _ in summary if p == n]
    print(f"모든 시험을 통과한 모델: {len(ok_models)}종 {ok_models}")
    sys.exit(0 if len(ok_models) == len(summary) else 1)


if __name__ == "__main__":
    main()
