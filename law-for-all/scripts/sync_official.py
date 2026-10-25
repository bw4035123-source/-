#!/usr/bin/env python3
"""국가법령정보센터 원문 동기화 — 내장 법령의 모든 조문을 공식 현행 원문으로 갱신.

  LAW_API_OC=발급키 python3 scripts/sync_official.py          # 스냅샷 갱신
  LAW_API_OC=발급키 python3 scripts/sync_official.py --check  # 변경 여부만 점검(변경 시 종료코드 1)

결과: lib/law-api/mock/official-snapshot.json (Next.js 판과 Python 판이 함께 사용)
내장 문장(쉬운 설명·3관점 지식베이스)에 쓰인 기간·금액이 바뀌면 사람이 다시 검토해야 하므로,
--check 결과를 CI나 정기 점검에 활용한다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
from law_for_all.drf import LawApiError  # noqa: E402
from law_for_all.service import LawService  # noqa: E402

SNAPSHOT = ROOT / "lib/law-api/mock/official-snapshot.json"


def load_mock_laws() -> list[dict]:
    """TS 원천(lib/law-api/mock)에서 법령 목록을 읽음(스냅샷 적용 전 원본)"""
    out = subprocess.run(
        ["npx", "tsx", "-e", "import { RAW_LAWS } from './lib/law-api/mock/raw'; process.stdout.write(JSON.stringify(RAW_LAWS))"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    oc = os.environ.get("LAW_API_OC") or os.environ.get("LAW_OC")
    if not oc:
        print("LAW_API_OC 환경변수(국가법령정보 Open API 인증키)가 필요합니다.")
        return 2

    laws = load_mock_laws()
    snap = {"source": "국가법령정보센터 공동활용 Open API(lawService.do)", "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "laws": {}}
    problems: list[str] = []
    for mock in laws:
        live = None
        for attempt in range(4):
            svc = LawService(oc)
            try:
                live = svc._fetch_by_name(mock["name"], mock["id"])
                break
            except LawApiError as e:
                if attempt == 3:
                    problems.append(f"{mock['name']}: {e}")
                time.sleep(1.5)
        if not live:
            continue
        by_no = {x["no"]: x for x in live["articles"]}
        arts = {}
        for art in mock["articles"]:
            la = by_no.get(art["no"])
            if not la:
                problems.append(f"{mock['name']} 제{art['no']}조: 현행 법령에 없음")
                continue
            text = la["text"]
            # 조문 본문에 없는 별표 요지(내장 데이터에 사람이 적은 줄: 첫 "[별표" 줄부터 끝까지)는 유지 — 별표 원문과 대조해 검증한 값만 둠
            lines = art["text"].split("\n")
            first = next((i for i, l in enumerate(lines) if l.startswith("[별표")), -1)
            if first >= 0 and "[별표" not in text:
                text = text + "\n" + "\n".join(lines[first:])
            arts[art["no"]] = {"title": la["title"], "text": text}
            if la["title"] != art["title"]:
                print(f"  · 제목 변경: {mock['name']} 제{art['no']}조 '{art['title']}' → '{la['title']}'")
        snap["laws"][mock["id"]] = {"name": live["name"], "effectiveDate": live.get("effectiveDate"), "mst": live.get("mst"), "articles": arts}
        print(f"✓ {mock['name']} — 조문 {len(arts)}/{len(mock['articles'])}개 (시행 {live.get('effectiveDate')})")

    for p in problems:
        print("✗", p)
    if a.check:
        old = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.exists() else {"laws": {}}
        changed = [f"{lid}:{no}" for lid, l in snap["laws"].items() for no, x in l["articles"].items() if old["laws"].get(lid, {}).get("articles", {}).get(no) != x]
        print("변경 없음" if not changed else f"원문 변경 {len(changed)}건: {', '.join(changed)}")
        return 1 if changed or problems else 0
    if problems:
        print("일부 조문을 가져오지 못해 스냅샷을 갱신하지 않았습니다.")
        return 1
    SNAPSHOT.write_text(json.dumps(snap, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (ROOT / "lib/law-api/mock/dataset-date.ts").write_text(
        f'/** 내장 법령 원문 수집일 — scripts/sync_official.py 가 갱신(클라이언트 번들용 경량 상수) */\nexport const MOCK_DATASET_DATE = "{snap['fetchedAt']}";\n', encoding="utf-8")
    print(f"\n저장: {SNAPSHOT.relative_to(ROOT)} ({snap['fetchedAt']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
