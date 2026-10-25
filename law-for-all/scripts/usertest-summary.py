#!/usr/bin/env python3
"""실사용 검증 집계 — submission/실사용검증/기록표.csv → 결과 요약(마크다운)

  python3 scripts/usertest-summary.py submission/실사용검증/기록표.csv [결과.md]

방법(평소 / 법이음)별 평균·중앙 소요시간, 정답률, 이해도·신뢰도·재사용 의향 평균을 내고,
구동안내서에 옮길 한 줄 요약을 출력한다. 빈 칸(아직 측정하지 않은 줄)은 건너뛴다.
"""
from __future__ import annotations

import csv
import statistics
import sys
from datetime import date
from pathlib import Path

METHODS = ("평소", "법이음")


def num(v: str) -> float | None:
    try:
        return float(v.strip())
    except (ValueError, AttributeError):
        return None


def mmss(sec: float) -> str:
    m, s = divmod(round(sec), 60)
    return f"{m}분 {s}초" if m else f"{s}초"


def summarize(rows: list[dict]) -> dict:
    out = {}
    for m in METHODS:
        rs = [r for r in rows if r["방법"].strip() == m and num(r["소요시간(초)"]) is not None]
        times = [min(num(r["소요시간(초)"]), 300.0) for r in rs]
        mean = lambda k: (statistics.mean(v) if (v := [num(r[k]) for r in rs if num(r[k]) is not None]) else None)  # noqa: E731
        out[m] = {
            "n": len(rs),
            "mean": statistics.mean(times) if times else None,
            "median": statistics.median(times) if times else None,
            "acc": (sum(1 for r in rs if num(r["정답여부"]) == 1) / len(rs)) if rs else None,
            "understand": mean("이해도"),
            "trust": mean("신뢰도"),
            "reuse": mean("재사용의향"),
        }
    out["participants"] = len({r["참가자"].strip() for r in rows if num(r["소요시간(초)"]) is not None})
    out["groups"] = sorted({r["유형"].strip() for r in rows if num(r["소요시간(초)"]) is not None})
    return out


def fmt(v, kind):
    if v is None:
        return "-"
    return {"t": mmss, "p": lambda x: f"{x * 100:.0f}%", "s": lambda x: f"{x:.1f}점"}[kind](v)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    rows = list(csv.DictReader(src.open(encoding="utf-8-sig")))
    s = summarize(rows)
    a, b = s["평소"], s["법이음"]
    if not a["n"] or not b["n"]:
        print("두 방법 모두 측정값이 있어야 집계할 수 있습니다(소요시간 칸을 채워 주세요).")
        return 1
    cut = (1 - b["mean"] / a["mean"]) * 100 if a["mean"] else 0
    change = f"{cut:.0f}% 단축" if cut >= 0 else f"{-cut:.0f}% 증가"
    line = (
        f"실사용 검증({s['participants']}명·{'/'.join(s['groups'])}, 문항 {a['n'] + b['n']}건): "
        f"근거 찾기 평균 {fmt(a['mean'], 't')} → {fmt(b['mean'], 't')}({change}), "
        f"정답률 {fmt(a['acc'], 'p')} → {fmt(b['acc'], 'p')}, 이해도 {fmt(a['understand'], 's')} → {fmt(b['understand'], 's')}"
    )
    md = f"""# 법이음 실사용 검증 결과

- 집계일: {date.today().isoformat()} · 원자료: `{src.as_posix()}` · 집계: `python3 scripts/usertest-summary.py`
- 참가자 {s['participants']}명({', '.join(s['groups'])}) · 한 세트는 평소 방법, 다른 세트는 법이음(참가자 번호 홀짝으로 순서 교차)
- 소요시간은 질문을 들은 때부터 근거 조문과 답을 말할 때까지(최대 300초)

| 항목 | 평소 방법 | 법이음 |
|---|---|---|
| 문항 수 | {a['n']} | {b['n']} |
| 평균 소요시간 | {fmt(a['mean'], 't')} | {fmt(b['mean'], 't')} |
| 중앙 소요시간 | {fmt(a['median'], 't')} | {fmt(b['median'], 't')} |
| 정답률(근거 조문+답) | {fmt(a['acc'], 'p')} | {fmt(b['acc'], 'p')} |
| 이해도(5점) | {fmt(a['understand'], 's')} | {fmt(b['understand'], 's')} |
| 신뢰도(5점) | {fmt(a['trust'], 's')} | {fmt(b['trust'], 's')} |
| 재사용 의향(5점) | {fmt(a['reuse'], 's')} | {fmt(b['reuse'], 's')} |

요약: {line}

※ 소규모 표본의 참고 결과이며 통계적 일반화를 뜻하지 않습니다.
"""
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name("결과.md")
    out.write_text(md, encoding="utf-8")
    print(md)
    print(f"저장: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
