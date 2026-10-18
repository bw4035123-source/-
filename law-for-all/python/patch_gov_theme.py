#!/usr/bin/env python3
"""2026 공공 AI 대전환 챌린지 테마 적용기 — law_for_all/web/ 의 모든 .html 에 테마 CSS·배너 JS 삽입

  python patch_gov_theme.py              # 적용(이미 적용된 파일은 건너뜀 — 여러 번 실행해도 안전)
  python patch_gov_theme.py --dry-run    # 바꿀 파일만 보여 주고 저장하지 않음
  python patch_gov_theme.py --revert     # 이 스크립트가 넣은 태그만 제거
  python patch_gov_theme.py --web 경로    # 다른 web 폴더 지정

- </head> 바로 앞에 <link rel="stylesheet" href="/gov-challenge-2026.css">
- </body> 바로 앞에 <script src="/gov-challenge-2026.js" defer></script>
- 넣는 태그에는 data-gov-challenge="2026" 표식을 달아 되돌릴 수 있게 하고, 파일은 임시 파일에 쓴 뒤 교체(중간에 끊겨도 원본 보존)
- 기존 내용(React 번들 스크립트·데이터)은 한 글자도 바꾸지 않는다
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

MARK = 'data-gov-challenge="2026"'
CSS_HREF = "/gov-challenge-2026.css"
JS_SRC = "/gov-challenge-2026.js"
CSS_TAG = f'<link rel="stylesheet" href="{CSS_HREF}" {MARK}/>'
JS_TAG = f'<script src="{JS_SRC}" defer {MARK}></script>'
ASSETS = ["gov-challenge-2026.css", "gov-challenge-2026.js", "fonts/pretendard-gov/pretendardvariable-gov-dynamic-subset.css"]

_HEAD_END = re.compile(r"</head\s*>", re.I)
_BODY_END = re.compile(r"</body\s*>", re.I)
_OURS = re.compile(r'\s*<(?:link|script)\b[^>]*' + re.escape(MARK) + r'[^>]*>(?:\s*</script>)?', re.I)


def _insert_before_last(text: str, pattern: re.Pattern, tag: str) -> str | None:
    """패턴의 마지막 위치 바로 앞에 tag 삽입(없으면 None)"""
    last = None
    for last in pattern.finditer(text):
        pass
    if last is None:
        return None
    return text[: last.start()] + tag + text[last.start():]


def patch_html(text: str) -> tuple[str, list[str]]:
    """(새 내용, 적용한 항목). 이미 있는 항목은 건너뜀"""
    done: list[str] = []
    if CSS_HREF not in text:
        # </head> 는 문서 앞부분의 첫 번째 것을 사용(본문 데이터 안 문자열과 혼동 방지)
        m = _HEAD_END.search(text)
        if m:
            text = text[: m.start()] + CSS_TAG + text[m.start():]
            done.append("css")
    if JS_SRC not in text:
        new = _insert_before_last(text, _BODY_END, JS_TAG)
        if new is not None:
            text = new
            done.append("js")
    return text, done


def revert_html(text: str) -> tuple[str, bool]:
    new = _OURS.sub("", text)
    return new, new != text


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".gov-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def run(web: Path, dry: bool = False, revert: bool = False, quiet: bool = False) -> dict:
    if not web.is_dir():
        raise SystemExit(f"web 폴더를 찾을 수 없습니다: {web}")
    stats = {"scanned": 0, "changed": 0, "skipped": 0, "no_tags": []}
    for path in sorted(web.rglob("*.html")):
        stats["scanned"] += 1
        text = path.read_text(encoding="utf-8")
        if revert:
            new, changed = revert_html(text)
            what = ["revert"] if changed else []
        else:
            new, what = patch_html(text)
            if not what and (CSS_HREF not in text or JS_SRC not in text):
                stats["no_tags"].append(str(path.relative_to(web)))
        if not what:
            stats["skipped"] += 1
            continue
        stats["changed"] += 1
        if not quiet:
            print(f"  {'(미리보기) ' if dry else ''}{path.relative_to(web)}: {', '.join(what)}")
        if not dry:
            _atomic_write(path, new)
    missing = [a for a in ASSETS if not (web / a).is_file()]
    stats["missing_assets"] = missing
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description="2026 공공 AI 대전환 챌린지 테마 적용기")
    ap.add_argument("--web", default=str(Path(__file__).resolve().parent / "law_for_all" / "web"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    s = run(Path(a.web), a.dry_run, a.revert)
    print(f"HTML {s['scanned']}개 확인 · {'되돌림' if a.revert else '적용'} {s['changed']}개 · 변경 없음 {s['skipped']}개")
    if s["no_tags"]:
        print("  ⚠ </head>·</body> 를 찾지 못해 건너뛴 파일:", ", ".join(s["no_tags"]))
    if s["missing_assets"] and not a.revert:
        print("  ⚠ web 폴더에 테마 파일이 없습니다:", ", ".join(s["missing_assets"]), "— 최신 법이음 압축본의 web 폴더에서 복사하세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
