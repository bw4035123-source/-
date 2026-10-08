#!/usr/bin/env bash
# 업무바통 실행(macOS/Linux)
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
if [ -d wheels ]; then pip install --no-index --find-links wheels -r requirements.txt -q; else pip install -r requirements.txt -q; fi
python run.py "$@"
