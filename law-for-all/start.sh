#!/usr/bin/env bash
# 법이음 — 원클릭 실행(macOS/Linux). 필요: Node.js 18.18 이상
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js가 필요합니다: https://nodejs.org (LTS)"; exit 1; }
[ -f .env.local ] || cp .env.example .env.local
[ -d node_modules ] || npm ci --no-audit --no-fund
# 기관망 프록시(HTTPS_PROXY) 환경에서도 국가법령정보 API 호출이 되도록(Node 22.21+)
export NODE_USE_ENV_PROXY=1
echo "▶ http://localhost:3000 에서 실행됩니다 (종료: Ctrl+C)"
npm run dev
