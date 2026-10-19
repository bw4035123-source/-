#!/usr/bin/env python3
"""법이음(LAW:ON) — Python 실행기

  python run.py                 # http://127.0.0.1:8000 에서 실행 + 브라우저 자동 열기
  python run.py --port 9000     # 포트 변경(사용 중이면 다음 빈 포트 자동 선택)
  python run.py --host 0.0.0.0  # 같은 네트워크의 다른 PC에서 접속 허용
  python run.py --no-browser    # 브라우저 자동 열기 끔
  python run.py --check         # 환경·데이터·LLM 설정 + 국가법령정보 실제 연결 점검 후 종료
  python run.py --setup-key     # 국가법령정보 API 인증키(OC) 입력 → .env.local 자동 생성 → 연결 확인
  python run.py --llm-test ollama:gemma3:4b,ollama:exaone3.5:7.8b   # 여러 LLM 구동 검증 → LLM_검증결과_날짜.md

외부 라이브러리 설치가 필요 없습니다(Python 3.9 이상 표준 라이브러리만 사용).
"""
from __future__ import annotations

import argparse
import os
import re
import socket
import sys
import threading
import webbrowser
from pathlib import Path

if sys.version_info < (3, 9):
    sys.exit(f"Python 3.9 이상이 필요합니다(현재 {sys.version.split()[0]}). https://www.python.org/downloads/")

# Windows 콘솔 한글 출력
for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from law_for_all.config import load_dotenv  # noqa: E402

load_dotenv()

from law_for_all import __version__  # noqa: E402
from law_for_all.config import config  # noqa: E402
from law_for_all.data import DATASET_DATE, LAWS, TOPICS  # noqa: E402
from law_for_all.llm import list_providers  # noqa: E402
from law_for_all.server import WEB, make_server  # noqa: E402

ROOT = Path(__file__).resolve().parent
ENV_LOCAL = ROOT / ".env.local"


def test_live(oc: str) -> tuple[bool, str]:
    """국가법령정보센터(기본: 중계 서버 경유)에 실제로 한 번 질의해 연결 상태를 확인"""
    from law_for_all.drf import LawApiError, drf_get, parse_law_list
    try:
        items = parse_law_list(drf_get("lawSearch.do", {"target": "law", "query": "형법", "display": "3"}, oc, 70 if config.law_proxy else 15, 2))
        if items:
            return True, f"연결 성공 — 실제 법령 데이터 수신(예: {items[0]['name']}, 시행 {items[0]['effective']})"
        return False, "응답은 왔지만 법령 목록이 비어 있습니다."
    except LawApiError as e:
        msg = str(e)
        if config.law_proxy:
            msg += f"\n    → 중계 서버({config.law_proxy['url']})의 Render 환경변수 LAW_API_OC 와, open.law.go.kr 에 Render 의 Outbound IP 가 등록됐는지 확인하세요."
            msg += "\n      (무료 Render 는 잠들어 있다가 첫 요청에 30~60초 걸릴 수 있습니다 — 잠시 후 다시 확인)"
        elif "인증 실패" in msg or "검증" in msg:
            msg += "\n    → open.law.go.kr 로그인 → [OPEN API] → 인증키의 서버 IP/도메인 등록에 이 PC의 공인 IP를 추가하세요."
            msg += "\n      (현재 공인 IP 확인: https://checkip.amazonaws.com)"
        return False, msg


def setup_key(optional: bool = False) -> int:
    """인증키를 입력받아 .env.local 에 LAW_API_OC 로 저장(다른 설정은 유지). optional: Enter 로 건너뛰기 허용"""
    print("━" * 56)
    print("  국가법령정보 Open API 인증키(OC) 설정")
    print("  (open.law.go.kr 에서 신청한 OC 값 — 보통 가입한 이메일의 @ 앞부분)")
    if optional:
        print("  인증키가 없으면 판례 보기·전체 법령 검색이 꺼지고 내장 원문만 표시됩니다.")
    print("━" * 56)
    try:
        oc = input("  인증키(OC)를 입력하고 Enter" + (" (건너뛰려면 그냥 Enter)" if optional else "") + ": ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n취소했습니다.")
        return 1
    if optional and not oc:
        print("  → 내장 원문 모드로 시작합니다. 나중에 키설정.bat 으로 설정할 수 있습니다.")
        return 1
    if not re.fullmatch(r"[A-Za-z0-9_.@-]{2,64}", oc):
        print("  ✗ 인증키 형식이 올바르지 않습니다(영문·숫자만, 공백 없이).")
        return 1
    if ENV_LOCAL.is_file():
        text = ENV_LOCAL.read_text(encoding="utf-8")
    elif (ROOT / ".env.example").is_file():
        text = (ROOT / ".env.example").read_text(encoding="utf-8")
    else:
        text = ""
    if re.search(r"^LAW_API_OC=.*$", text, flags=re.M):
        text = re.sub(r"^LAW_API_OC=.*$", "LAW_API_OC=" + oc, text, count=1, flags=re.M)
    else:
        text = text.rstrip("\n") + ("\n" if text else "") + "LAW_API_OC=" + oc + "\n"
    ENV_LOCAL.write_text(text, encoding="utf-8")
    os.environ["LAW_API_OC"] = oc  # 이번 실행에도 바로 적용
    print(f"  ✓ 저장했습니다: {ENV_LOCAL}")
    print("  … 국가법령정보센터 연결을 확인하는 중")
    ok, msg = test_live(oc)
    print(f"  {'✓' if ok else '✗'} {msg}")
    if ok:
        print("\n  이제 실행.bat(또는 python run.py)으로 실행하면 실시간 원문·판례가 표시됩니다.")
    return 0 if ok else 2


def free_port(host: str, start: int) -> int:
    for p in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host if host != "0.0.0.0" else "", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"{start}~{start + 49} 포트가 모두 사용 중입니다. --port 로 다른 포트를 지정하세요.")


def law_mode() -> str:
    if config.law_proxy:
        return f"실시간 — 법령 API 중계 서버 경유({config.law_proxy['url']})"
    if config.law_api_oc:
        return "실시간 — 국가법령정보센터 직접 호출(인증키 설정됨)"
    return "내장 원문(LAW_PROXY_URL=off 이고 인증키 없음)"


def check() -> bool:
    ok = True
    print(f"법이음 v{__version__} · Python {sys.version.split()[0]}")
    print(f"  화면 파일(web/)   : {'있음' if (WEB / 'index.html').is_file() else '없음 ⚠'}")
    ok &= (WEB / "index.html").is_file()
    print(f"  내장 법령         : {sum(l['kind'] == '법률' for l in LAWS)}개 법률 + 하위법령 {sum(l['kind'] != '법률' for l in LAWS)}개 · 토픽 {len(TOPICS)}개 (기준 {DATASET_DATE})")
    print(f"  설정 파일         : {'.env.local 있음' if ENV_LOCAL.is_file() else '.env.local 없음 — 인증키 설정: 키설정.bat 또는 python run.py --setup-key'}")
    print(f"  국가법령정보 API  : {law_mode()}")
    if config.law_access:
        live_ok, msg = test_live(config.law_api_oc)
        print(f"  실제 연결 확인    : {'✓' if live_ok else '✗'} {msg}")
    print("  LLM 공급자        :")
    for p in list_providers(config.llm):
        mark = "●" if p["configured"] else "○"
        print(f"    {mark} {p['label']:<24} {p['model'] if p['kind'] == 'llm' else ''}{'  (기본)' if p['isDefault'] else ''}{'' if p['configured'] else '  — ' + p['hint']}")
    return ok


def main():
    ap = argparse.ArgumentParser(description="법이음 — AI 법률 지능형 포털(Python 서버)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--setup-key", action="store_true")
    ap.add_argument("--llm-test", nargs="?", const="", metavar="대상", help="여러 LLM으로 같은 질문을 돌려 결과 문서 작성(예: ollama:gemma3:4b,ollama:exaone3.5:7.8b)")
    a = ap.parse_args()

    if a.llm_test is not None:
        from law_for_all.llmtest import run as llm_test
        path, two = llm_test(a.llm_test or None, ROOT)
        print(f"\n결과 문서: {path}")
        print("✓ 2종 이상 모델에서 주요 기능 정상 구동" if two else "※ 실제 LLM 2종 이상이 모두 통과해야 '모델 비종속 입증'이 됩니다 — 대상을 추가해 다시 실행하세요.")
        sys.exit(0)

    if a.setup_key:
        sys.exit(setup_key())
    if a.check:
        sys.exit(0 if check() else 1)

    # 인증키가 없으면(새 폴더에 압축을 푼 경우 등) 첫 실행 때 바로 물어봄 — 창이 있는 실행에서만
    if not config.law_access and not a.no_browser and sys.stdin and sys.stdin.isatty():
        setup_key(optional=True)

    port = free_port(a.host, a.port)
    httpd = make_server(a.host, port)
    url = f"http://{'127.0.0.1' if a.host in ('0.0.0.0', '') else a.host}:{port}"
    print("━" * 56)
    print(f"  법이음 (LAW:ON) v{__version__}")
    print(f"  ▶ {url}")
    print(f"  법령: {law_mode()} · 기본 AI: {config.llm['defaultProvider']}")
    print("  종료: Ctrl+C")
    print("━" * 56)
    if config.law_access:
        # 실행 직후 실제 연결을 한 번 확인해 콘솔에 결과 표시(화면 사용은 바로 가능)
        def report():
            ok, msg = test_live(config.law_api_oc)
            # print(f"  [국가법령정보] {'✓' if ok else '✗'} {msg}")

        threading.Thread(target=report, daemon=True).start()
    if not a.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
