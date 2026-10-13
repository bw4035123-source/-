"""기안문(공문) 블록 만들기 – 행정업무규정 서식 순서: 기관명 → 수신 → (경유) → 제목 → 본문(1. 가. 1) 가)) → 붙임 → 끝.

본문 항목은 중첩 목록으로 받는다:  ["관련: ...", ["교육명: ...", "일시: ..."], "협조 사항 ..."]
문자열은 현재 단계 번호를 받고, 바로 뒤의 목록은 그 항목의 하위 항목이 된다.
"""
from __future__ import annotations

LEVELS = [lambda i: f"{i}.", lambda i: f"{'가나다라마바사아자차카타파하'[i - 1]}.", lambda i: f"{i})",
          lambda i: f"{'가나다라마바사아자차카타파하'[i - 1]})"]
INDENT = ["", "  ", "    ", "      "]


def _number(items, level=0) -> list[str]:
    out, n = [], 0
    for it in items:
        if isinstance(it, list):
            out += _number(it, level + 1)
            continue
        n += 1
        out.append(f"{INDENT[level]}{LEVELS[level](n)} {it}")
    return out


def blocks(org: dict, title: str, body: list, attachments: list[str] | None = None, receiver: str = "내부결재",
           tables: list | None = None) -> list:
    """tables: [(본문 항목 번호 뒤에 넣을 위치 표시 문자열, ("table", ...))] – 표는 본문 뒤, 붙임 앞에 넣는다."""
    lines = _number(body)
    B = [("title", org.get("name", "")),
         ("p", f"수신  {receiver}"), ("p", "(경유)"), ("p", f"제목  {title}"), ("p", "")]
    if attachments:
        for ln in lines:
            B.append(("p", ln))
        for t in tables or []:
            B.append(t)
        att = [f"붙임  {i}. {a}" if i == 1 else f"      {i}. {a}" for i, a in enumerate(attachments, 1)]
        if len(attachments) == 1:
            att = [f"붙임  {attachments[0]}"]
        att[-1] += "  끝."
        B.append(("p", ""))
        B += [("p", a) for a in att]
    else:
        lines[-1] += "  끝."
        for ln in lines:
            B.append(("p", ln))
        for t in tables or []:
            B.append(t)
    sign = org.get("signers") or {}
    B += [("p", ""), ("p", f"기안자 {sign.get('drafter', org.get('manager', '교육담당'))}   "
                           f"검토자 {sign.get('reviewer', org.get('dept', '') + '장')}   결재권자 {sign.get('approver', '')}"),
          ("note", f"{org.get('name', '')} {org.get('dept', '')} · 다이수가 자료를 근거로 작성한 초안입니다. 결재 전 내용을 확인하세요.")]
    return B
