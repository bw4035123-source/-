"""업무바통 실행: python run.py  →  브라우저에서 http://127.0.0.1:8765 접속

옵션
  --port 8765          포트 변경
  --host 127.0.0.1     다른 PC에서 접속하게 하려면 0.0.0.0 (내부망에서만 권장)
  --model offline      사용할 LLM 프로필(config/settings.json 의 profiles 이름)
  --no-browser         브라우저 자동 열기 끄기
"""
import argparse
import os
import sys
import threading
import webbrowser


def main():
    ap = argparse.ArgumentParser(description="업무바통 – AI 인수인계 도우미")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--model", default=None, help="LLM 프로필 이름(예: offline, ollama-gemma, ollama-exaone)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if args.model:
        os.environ["BATON_LLM"] = args.model
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import uvicorn

    from baton.server import app

    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{args.port}"
    print(f"\n  업무바통 실행 중 → {url}\n  (종료: Ctrl+C)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
