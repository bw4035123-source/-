"""수치 대조 — Next.js 판 lib/answer/numbers.ts 와 같은 규칙.
생성형 AI 답변의 금액·기간·비율이 근거 조문 원문(또는 질문에 사용자가 직접 쓴 값)에 실제로 있는지 확인한다.
표기만 다른 같은 값('2천만원'='2,000만원', '5천5백만원'='5,500만원', '0.03%'='0.03퍼센트', '100분의 50'='50%')은 같은 값으로 본다."""
from __future__ import annotations

import re

_KO_UNIT = {"십": 10, "백": 100, "천": 1000}


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _fmt(v: float) -> str:
    r = round(v * 100) / 100
    return str(int(r)) if r == int(r) else str(r)


def _korean_amount(span: str) -> int:
    """'1억 6천5백만', '2천만', '40만', '5,000만', '50,000' → 원 단위 정수"""
    total = 0.0
    section = 0.0  # 만 아래 자리(천·백·십·숫자)
    for m in re.finditer(r"(\d[\d,]*(?:\.\d+)?)?\s*(억|만|천|백|십)?", span):
        if not m.group(1) and not m.group(2):
            continue
        n = _num(m.group(1)) if m.group(1) else 0.0
        u = m.group(2)
        if u in ("억", "만"):
            total += ((section + n) or (0 if section else 1)) * (1e8 if u == "억" else 1e4)
            section = 0.0
        elif u:
            section += (n if m.group(1) else 1) * _KO_UNIT[u]
        else:
            section += n
    return round(total + section)


def extract_quantities(text: str) -> list[str]:
    """글에 나온 수치를 '단위:값' 형태로(같은 값은 한 번, 나온 순서)"""
    out: dict[str, None] = {}
    t = re.sub(r"\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?", " ", text)
    t = re.sub(r"\d{1,2}\s*월\s*\d{1,2}\s*일", " ", t)
    t = re.sub(r"(?:19|20)\d{2}\s*년", " ", t)
    t = re.sub(r"제\s*\d+(?:조의?\d*|항|호|목|편|장|절)?(?:의\d+)?", " ", t)

    def frac(m):
        d, n = _num(m.group(1)), _num(m.group(2))
        if d:
            out[f"%:{_fmt(n / d * 100)}"] = None
        return " "

    t = re.sub(r"(\d[\d,]*)\s*분의\s*(\d[\d,]*(?:\.\d+)?)", frac, t)

    def money(m):
        v = _korean_amount(re.sub(r"원$", "", m.group(0)))
        if v:
            out[f"원:{v}"] = None
        return " "

    t = re.sub(r"(?<![\d.])\d[\d,]*(?:\.\d+)?(?:\s*(?:억|만|천|백|십)(?:\s*\d[\d,]*(?:\.\d+)?)?)*\s*원", money, t)
    for pat, name in ((r"(\d[\d,]*(?:\.\d+)?)\s*(?:%|퍼센트)", "%"), (r"(\d+)\s*개월", "개월"), (r"(\d+)\s*년(?!도)", "년"), (r"(\d+)\s*일(?![반부])", "일"),
                      (r"(\d+)\s*시간", "시간"), (r"(\d+(?:\.\d+)?)\s*배", "배"), (r"(\d+)\s*세(?![대금])", "세"), (r"(?i)(\d+)\s*(?:dB|데시벨)", "dB")):
        for m in re.finditer(pat, t):
            out[f"{name}:{_fmt(_num(m.group(1)))}"] = None
    return list(out)


def unverified_quantities(answer_texts: list[str], sources: list[str]) -> list[str]:
    """answer_texts 의 수치 중 sources(근거 조문 원문·사용자 질문)에서 확인되지 않은 것"""
    known = {q for s in sources for q in extract_quantities(s)}
    tables = [s for s in sources if re.search(r"(?i)dB|데시벨", s)]
    # 100%는 원문이 '통상임금에 해당하는 금액'·'전액'으로 쓴 경우의 풀이로만 인정('2분의 1에 해당하는 금액'은 제외)
    whole = any("전액" in s or any(not re.search(r"분의\s*\d+\s*에\s*$", s[max(0, m.start() - 12):m.start()]) for m in re.finditer(r"해당하는 금액", s)) for s in sources)
    bad = []
    for q in extract_quantities("\n".join(answer_texts)):
        if q in known or (q == "%:100" and whole):
            continue
        u, v = q.split(":")
        if u == "dB" and any(re.search(rf"(?<![\d.]){re.escape(v)}(?![\d.])", s) for s in tables):
            continue
        bad.append(q)
    return bad


def quantity_label(q: str) -> str:
    """'일:30' → '30일', '원:400000' → '40만원'"""
    u, v = q.split(":")
    if u == "원":
        n = int(float(v))
        if n >= 100_000_000 and n % 100_000_000 == 0:
            return f"{n // 100_000_000}억원"
        if n >= 10_000 and n % 10_000 == 0:
            return f"{n // 10_000:,}만원"
        return f"{n:,}원"
    return f"{v}{u}"
