#!/usr/bin/env bash
# 업무바통 실행(macOS/Linux) – 필요한 패키지는 run.py가 자동 설치
cd "$(dirname "$0")"
exec python3 run.py "$@"
