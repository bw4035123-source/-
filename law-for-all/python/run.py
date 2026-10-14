#!/usr/bin/env python3
"""법이음(LAW:ON) — Python 실행기

  python run.py                 # http://127.0.0.1:8000 에서 실행 + 브라우저 자동 열기
  python run.py --port 9000     # 포트 변경(사용 중이면 다음 빈 포트 자동 선택)
  python run.py --host 0.0.0.0  # 같은 네트워크의 다른 PC에서 접속 허용
  python run.py --no-browser    # 브라우저 자동 열기 끔
  python run.py --check         # 환경·데이터·LLM 설정 점검만 하고 종료

외부 라이브러리 설치가 필요 없습니다(Python 3.9 이상 표준 라이브러리만 사용).
"""
from __future__ import annotations

import argparse
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


def free_port(host: str, start: int) -> int:
    for p in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host if host != "0.0.0.0" else "", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"{start}~{start + 49} 포트가 모두 사용 중입니다. --port 로 다른 포트를 지정하세요.")


def check() -> bool:
    ok = True
    print(f"법이음 v{__version__} · Python {sys.version.split()[0]}")
    print(f"  화면 파일(web/)   : {'있음' if (WEB / 'index.html').is_file() else '없음 ⚠'}")
    ok &= (WEB / "index.html").is_file()
    print(f"  내장 법령         : {sum(l['kind'] == '법률' for l in LAWS)}개 법률 + 하위법령 {sum(l['kind'] != '법률' for l in LAWS)}개 · 토픽 {len(TOPICS)}개 (기준 {DATASET_DATE})")
    print(f"  국가법령정보 API  : {'실시간(LAW_API_OC 설정됨)' if config.law_api_oc else '내장 데이터 모드'}")
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
    a = ap.parse_args()

    if a.check:
        sys.exit(0 if check() else 1)

    port = free_port(a.host, a.port)
    httpd = make_server(a.host, port)
    url = f"http://{'127.0.0.1' if a.host in ('0.0.0.0', '') else a.host}:{port}"
    print("━" * 56)
    print(f"  법이음 (LAW:ON) v{__version__}")
    print(f"  ▶ {url}")
    print(f"  법령: {'국가법령정보 실시간' if config.law_api_oc else '내장 데이터'} · 기본 AI: {config.llm['defaultProvider']}")
    print("  종료: Ctrl+C")
    print("━" * 56)
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
