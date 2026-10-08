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


def _rows_to_segments(rows: list[list[str]], label: str):
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return []
    header = rows[0]
    has_header = sum(1 for c in header if c) >= max(2, len(header) // 2) and len(rows) > 1
    body = rows[1:] if has_header else rows
    segs = []
    start_no = 2 if has_header else 1
    for k in range(0, len(body), ROWS_PER_SEG):
        chunk = body[k:k + ROWS_PER_SEG]
        lines = []
        for r in chunk:
            if has_header:
                pairs = [f"{h or f'열{j + 1}'}: {c}" for j, (h, c) in enumerate(zip(header + [""] * len(r), r)) if c]
                lines.append(" / ".join(pairs))
            else:
                lines.append(" | ".join(c for c in r if c))
        a, b = start_no + k, start_no + k + len(chunk) - 1
        segs.append(("\n".join(lines), f"{label} {a}~{b}행", {}))
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
