"""엑셀·CSV: 행을 '머리글: 값' 형태 문장으로 바꿔 AI가 표를 이해하기 쉽게 한다."""
from __future__ import annotations

import csv
import datetime as dt

ROWS_PER_SEG = 15


def _fmt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        d = f"{v.year}. {v.month}. {v.day}."
        return d if (v.hour, v.minute) == (0, 0) else f"{d} {v:%H:%M}"
    if isinstance(v, dt.date):
        return f"{v.year}. {v.month}. {v.day}."
    if isinstance(v, float) and v.is_integer():
        return f"{int(v):,}" if abs(v) >= 10000 else str(int(v))
    if isinstance(v, int) and abs(v) >= 10000:
        return f"{v:,}"
    return str(v).strip()


def table_rows(rows: list[list[str]]) -> tuple[list[str], list[str], int, int]:
    """표의 머리글 행을 찾아 (앞쪽 제목 줄들, 행 문장들, 머리글 행 번호, 첫 자료 행 번호)를 돌려준다.

    '2026년 계약 현황' 같은 제목 행이 맨 위에 있어도, 칸이 가장 많이 채워진 앞쪽 행을 머리글로 본다.
    각 자료 행은 '머리글: 값 / 머리글: 값' 문장으로 바꿔 AI·규칙엔진이 표를 이해하기 쉽게 한다.
    """
    rows = [[(c or "").strip() for c in r] for r in rows]
    width = max((sum(1 for c in r if c) for r in rows), default=0)
    hi = None
    for i, r in enumerate(rows[:6]):
        filled = sum(1 for c in r if c)
        if filled >= max(2, round(width * 0.6)) and i + 1 < len(rows):
            hi = i
            break
    if hi is None:
        return [], [" | ".join(c for c in r if c) for r in rows if any(r)], 0, 1
    titles = [" ".join(c for c in r if c) for r in rows[:hi] if any(r)]
    header = rows[hi]
    lines = []
    for r in rows[hi + 1:]:
        if not any(r):
            continue
        pairs = [f"{header[j] if j < len(header) and header[j] else f'열{j + 1}'}: {c}" for j, c in enumerate(r) if c]
        lines.append(" / ".join(pairs))
    return titles, lines, hi + 1, hi + 2


def _rows_to_segments(rows: list[list[str]], label: str):
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return []
    titles, lines, _, first = table_rows(rows)
    segs = []
    for k in range(0, len(lines), ROWS_PER_SEG):
        part = lines[k:k + ROWS_PER_SEG]
        head = "\n".join(titles) + "\n" if titles and k == 0 else ""
        a, b = first + k, first + k + len(part) - 1
        segs.append((head + "\n".join(part), f"{label} {a}~{b}행", {}))
    return segs


def parse_xlsx(path: str):
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    segs = []
    for ws in wb.worksheets:
        rows = [[_fmt(v) for v in row] for row in ws.iter_rows(values_only=True)]
        segs += _rows_to_segments(rows, f"시트 '{ws.title}'")
    wb.close()
    return segs, {"format": "Excel"}


def parse_csv(path: str):
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(path, newline="", encoding=enc) as f:
                rows = [[c.strip() for c in r] for r in csv.reader(f)]
            break
        except UnicodeDecodeError:
            continue
    else:
        return [], {"format": "CSV", "note": "인코딩 판별 실패"}
    return _rows_to_segments(rows, "표"), {"format": "CSV"}
