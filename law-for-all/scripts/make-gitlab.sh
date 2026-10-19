#!/usr/bin/env bash
# 공공 GitLab 제출용 저장소 만들기 — 개발 이력 없이 현재 소스 한 커밋 + release/ 실행물
#   node scripts/build-python.mjs   # 먼저: dist/law-on-python.zip · dist/law-on-공유판.html
#   bash scripts/make-gitlab.sh     # → dist/gitlab/law-on (git 저장소, main 브랜치)
# GitLab 에 올리기: cd dist/gitlab/law-on && git remote add origin https://gitlab.aigov.go.kr/<아이디>/<프로젝트>.git && git push -u origin main
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/gitlab/law-on"
cd "$ROOT"
[ -f dist/law-on-python.zip ] && [ -f "dist/law-on-공유판.html" ] || { echo "먼저 node scripts/build-python.mjs 를 실행하세요"; exit 1; }
[ -z "$(git status --porcelain -- . ':!dist')" ] || { echo "커밋하지 않은 변경이 있습니다 — 커밋한 내용만 담습니다"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT/release"
git archive HEAD | tar -x -C "$OUT"
cp dist/law-on-python.zip "$OUT/release/law-on-python.zip"
cp "dist/law-on-공유판.html" "$OUT/release/LAW-ON_share.html"

# 인증키 점검: 키 값은 적지 않고 이 PC의 환경변수·.env.local 에서 읽어 비교
KEYS=()
for v in "${LAW_API_OC:-}" "${LAW_OC:-}"; do [ -n "$v" ] && KEYS+=("$v"); done
for f in .env.local python/.env.local; do
  [ -f "$f" ] || continue
  k=$(sed -nE 's/^[[:space:]]*LAW_API_OC[[:space:]]*=[[:space:]]*["'\'']?([^"'\''[:space:]#]+).*/\1/p' "$f" | head -1)
  [ -n "$k" ] && KEYS+=("$k")
done
for k in "${KEYS[@]}"; do
  if grep -rlaF "LAW_API_OC=$k" "$OUT" >/dev/null || (cd "$OUT/release" && unzip -p law-on-python.zip | grep -qaF "$k"); then
    echo "✗ 인증키가 포함되어 있습니다 — 중단"; rm -rf "$OUT"; exit 1
  fi
done
find "$OUT" -name ".env.local" -print -delete

cd "$OUT"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-법이음 개발팀}" -c user.email="${GIT_AUTHOR_EMAIL:-law-on@example.go.kr}" commit -q -m "법이음(LAW:ON) — 2026 공공 AI 대전환 챌린지 세션1 제출"
echo "✔ $OUT ($(git ls-files | wc -l)개 파일, 커밋 1개)"
