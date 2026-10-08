#!/usr/bin/env bash
# 업무바통 실행(macOS/Linux) – run.bat 과 같은 흐름
#   1) Python 3.10 이상 찾기  2) 전용 실행 환경(.venv) 준비  3) 라이브러리는 requirements.txt 가 바뀔 때만 설치  4) 실행
# 사용법: ./run.sh [--model 프로필] [--port 번호] [--check] [--reinstall]
set -u
cd "$(dirname "$0")"
VPY=".venv/bin/python"
CHK='import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'

echo
echo "  업무바통 - AI 인수인계 도우미"
echo "  -----------------------------------------"

if [ "${1:-}" = "--reinstall" ]; then
  echo "[1/3] 실행 환경을 지우고 다시 만듭니다..."
  rm -rf .venv
  shift
fi

if [ -x "$VPY" ] && ! "$VPY" -c "$CHK" 2>/dev/null; then
  echo "[1/3] 실행 환경이 손상되어 다시 만듭니다..."
  rm -rf .venv
fi

if [ ! -x "$VPY" ]; then
  rm -rf .venv  # 반쯤 지워진 실행 환경이 남아 있으면 새로 만들 수 없으므로 정리
  PY=""
  for c in python3 python3.13 python3.12 python3.11 python3.10 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c "$CHK" 2>/dev/null; then PY="$c"; break; fi
  done
  if [ -z "$PY" ]; then
    echo "  [오류] Python 3.10 이상을 찾지 못했습니다. https://www.python.org/downloads/ 에서 설치하세요."
    exit 1
  fi
  echo "[1/3] 처음 실행: 실행 환경을 준비합니다... (사용 파이썬: $PY)"
  if ! "$PY" -m venv .venv || [ ! -x "$VPY" ]; then
    echo "  [오류] 실행 환경을 만들지 못했습니다. (Ubuntu 등은 'sudo apt install python3-venv' 필요)"
    exit 1
  fi
fi

if ! cmp -s requirements.txt .venv/requirements.stamp; then
  echo "[2/3] 필요한 라이브러리를 설치합니다... (처음 1회, 1~2분)"
  if [ -d wheels ]; then
    echo "      wheels 폴더에서 설치합니다 (인터넷 불필요)"
    "$VPY" -m pip install -q --disable-pip-version-check --no-index --find-links wheels -r requirements.txt
  else
    "$VPY" -m pip install -q --disable-pip-version-check -r requirements.txt
  fi && cp requirements.txt .venv/requirements.stamp || {
    echo "  [주의] 라이브러리 설치에 실패했습니다. 인터넷 연결을 확인하세요(README의 '인터넷이 막힌 PC' 참고)."
    echo "         그래도 실행을 시도합니다."
  }
fi

echo "[3/3] 업무바통을 시작합니다. 잠시 후 브라우저가 열립니다."
exec "$VPY" run.py "$@"
