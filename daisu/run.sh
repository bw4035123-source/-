#!/usr/bin/env bash
# 다이수 실행(macOS/Linux): 파이썬 3.10 이상을 찾아 run.py 실행(실행 환경·설치·기록은 run.py 가 맡음)
cd "$(dirname "$0")"
CHK='import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
for c in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "$CHK" 2>/dev/null; then exec "$c" run.py "$@"; fi
done
echo "  [오류] Python 3.10 이상을 찾지 못했습니다. https://www.python.org/downloads/ 에서 설치하세요."
exit 1
