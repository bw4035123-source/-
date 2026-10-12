"""날짜·시간·이름 등 공용 도구."""
from __future__ import annotations

import datetime as dt
import re

WEEK = "월화수목금토일"

_FULL = re.compile(r"(20\d{2}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?")
_MD = re.compile(r"(?<![\d.])(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\(\s*[월화수목금토일]\s*\))?")


def parse_date(s, year: int | None = None) -> dt.date | None:
    """'2026-06-11', '2026. 6. 11.', '26.6.11', '2026년 6월 11일', (year가 있으면) '6. 11.(목)'."""
    if isinstance(s, dt.datetime):
        return s.date()
    if isinstance(s, dt.date):
        return s
    s = str(s or "").strip()
    if not s:
        return None
    m = _FULL.search(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y += 2000 if y < 100 else 0
        try:
            return dt.date(y, mo, d)
        except ValueError:
            return None
    if year:
        m = _MD.search(s)
        if m:
            try:
                return dt.date(year, int(m.group(1)), int(m.group(2)))
            except ValueError:
                return None
    return None


def all_dates(s: str, year: int | None = None) -> list[dt.date]:
    out = []
    for m in _FULL.finditer(s or ""):
        d = parse_date(m.group(0))
        if d:
            out.append(d)
    if not out and year:
        for m in _MD.finditer(s or ""):
            d = parse_date(m.group(0), year)
            if d:
                out.append(d)
    return out


def parse_range(s) -> tuple[dt.date | None, dt.date | None]:
    ds = all_dates(str(s or ""))
    if not ds:
        return None, None
    return ds[0], ds[-1] if len(ds) > 1 else None


_HOURS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:시간|[Hh](?![a-zA-Z]))")
_SPAN = re.compile(r"(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})")


def hours_in(text: str) -> float | None:
    """'(4H)', '16시간' → 숫자. 없으면 '14:00~18:00' 같은 시간 범위로 계산."""
    text = str(text or "")
    m = _HOURS.search(text)
    if m:
        return float(m.group(1))
    m = _SPAN.search(text)
    if m:
        a = int(m.group(1)) * 60 + int(m.group(2))
        b = int(m.group(3)) * 60 + int(m.group(4))
        if b > a:
            return round((b - a) / 60, 1)
    return None


def num(s) -> float | None:
    try:
        return float(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def norm_name(s) -> str:
    return re.sub(r"\s+|\(.*?\)", "", str(s or ""))


def norm_dept(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).replace("시설관리공단", "")


def dept_core(s) -> str:
    return re.sub(r"(팀|과|부|실|센터|파트)$", "", norm_dept(s))


def same_dept(a, b) -> bool:
    a, b = dept_core(a), dept_core(b)
    return bool(a and b) and (a in b or b in a)


def yes(s) -> bool:
    return str(s or "").strip().upper() in ("Y", "YES", "예", "O", "○", "◯", "●", "V", "✓", "✔", "해당", "1", "TRUE")


def kdate(d: dt.date | None, with_year=True) -> str:
    if not d:
        return ""
    return (f"{d.year}. " if with_year else "") + f"{d.month}. {d.day}.({WEEK[d.weekday()]})"


def edit1(a: str, b: str) -> bool:
    """두 이름이 한 글자만 다른지(오타 후보)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    s, t = (a, b) if len(a) < len(b) else (b, a)
    return any(t[:i] + t[i + 1:] == s for i in range(len(t)))


def fmt_h(h) -> str:
    if h is None:
        return ""
    return str(int(h)) if float(h).is_integer() else f"{h:.1f}"
