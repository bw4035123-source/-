#!/usr/bin/env bash
# 법이음 법령 API 중계 서버 실행 (macOS/Linux)
cd "$(dirname "$0")"
python3 -m pip install -q -r requirements.txt
exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8787}"
