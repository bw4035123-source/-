#!/usr/bin/env bash
# 법이음 — Python 실행기(macOS/Linux). 외부 라이브러리 설치 불필요
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python) || { echo "Python 3.9 이상이 필요합니다: https://www.python.org/downloads/"; exit 1; }
exec "$PY" run.py "$@"
