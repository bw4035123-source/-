"""질문 속 개인정보 가리기 — Next.js 판 lib/privacy-mask.ts 와 같은 규칙
검색·AI로 넘기기 전에 주민등록번호·전화번호 등을 ○○○ 으로 바꾼다(법령 근거 찾기에는 필요 없는 정보)."""
from __future__ import annotations

import re

_D, _E = r"(?<!\d)", r"(?!\d)"
_RULES = [
    ("주민등록번호", re.compile(_D + r"\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?-?\s?[1-8]\d{6}" + _E)),
    ("카드번호", re.compile(_D + r"\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}" + _E)),
    ("전화번호", re.compile(_D + r"(?:01[016789]|0[2-6]\d?|070|080)[- .]?\d{3,4}[- .]?\d{4}" + _E)),
    ("이메일", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    # 계좌번호: 숫자 묶음 3~4개를 -로 이은 10자리 이상(날짜 2026-10-25 같은 8자리는 제외)
    ("계좌번호", re.compile(_D + r"\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?" + _E)),
    ("여권번호", re.compile(r"(?<![A-Za-z0-9])[MSRODmsrod]\d{8}(?![A-Za-z0-9])")),
]
MASK = "○○○"


def mask_pii(text: str) -> tuple[str, list[str]]:
    """(가린 글, 가린 종류 목록)"""
    found: list[str] = []
    for kind, rx in _RULES:
        def rep(m, kind=kind):
            if kind == "계좌번호" and len(re.sub(r"\D", "", m.group(0))) < 10:
                return m.group(0)
            if kind not in found:
                found.append(kind)
            return MASK
        text = rx.sub(rep, text)
    return text, found


def mask_notice(found: list[str]) -> str:
    return f"개인정보 보호를 위해 질문 속 {'·'.join(found)}를 {MASK}(으)로 가리고 처리했어요(저장·전송하지 않음)." if found else ""
