#!/usr/bin/env python3
"""Render/Cloud 환경 전용 진입점
- 환경변수 PORT를 읽어 바인딩
- 0.0.0.0으로 외부 접속 허용
- 브라우저 자동 실행 비활성화
"""
import os
import sys
import urllib.request

# Render 서버의 공인 IP를 확인하여 로그에 출력
try:
    current_ip = urllib.request.urlopen("https://api.ipify.org", timeout=5).read().decode("utf-8")
    print("=" * 50)
    print(f"[MY_RENDER_SERVER_IP] >>> {current_ip} <<<")
    print("=" * 50)
except Exception as e:
    print(f"IP 확인 실패: {e}")

port = os.environ.get("PORT", "8000")
try:
    port = int(port)
except ValueError:
    port = 8000

# run.py의 main 실행 함수를 인자와 함께 호출
sys.argv = ["run.py", "--host", "0.0.0.0", "--port", str(port), "--no-browser"]

import run
run.main()