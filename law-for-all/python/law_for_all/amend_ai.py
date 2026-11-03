"""개정안 AI 작성 — 개정 방향을 규칙(문형)으로 알아듣지 못했을 때만 생성형 AI가 개정 조문을 쓰고, 가드가 결정적으로 검증한다
(lib/amend-ai.ts 와 같음)
 - 바꾼 내용이 없거나, 항 번호 체계가 깨지면 버림
 - 지시에 없는 항 삭제, 근거(현행·지시·상위법) 밖 수치·법령 인용, 현행에 없던 벌칙·과태료를 만들면 버림
 - 현행에 없던 조문 인용(제N조)은 실재 확인 경고"""
from __future__ import annotations

import re

from .numbers import quantity_label, unverified_quantities

AMEND_SYSTEM = """너는 행정규칙·자치법규·법령 개정안 작성을 돕는 법제 보조 AI다.
[절대 규칙]
1. 개정 방향에 적힌 내용만 고친다. 그 밖의 문장·조사·문장부호는 현행 그대로 둔다.
2. 항 번호(①②③…)는 차례대로 쓰고, 항을 새로 두면 다음 번호를 붙인다. 조문 머리(제N조(제목))는 쓰지 않고 본문만 쓴다.
3. 개정 방향에 없는 항을 지우지 않는다. 항 삭제 지시가 있으면 그 항을 '② 삭제'처럼 번호를 남기고 '삭제'라고만 쓴다.
4. 기간·인원·금액·시각 같은 수치는 개정 방향·현행 조문·상위법 조문에 있는 값만 쓴다. 시각은 개정 방향에 쓴 표기(예: 오후 6시)를 그대로 쓴다.
5. 현행 조문·상위법 조문에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료·벌금 같은 새 제재를 만들지 않는다.
6. 법제 문체(~한다, ~할 수 있다)로 쓴다.
7. 출력은 {"amended":"개정한 조문 본문 전체"} 형식의 JSON 객체 하나만 출력한다."""


def build_amend_prompt(inp: dict) -> str:
    upper = "\n\n".join(f"<<{u['label']}>>\n{u['text']}" for u in inp["upper"]) if inp["upper"] else "(없음)"
    return (
        f"<규정>\n이름: {inp.get('lawName') or '(미정)'}\n종류: {inp.get('kind')}\n조문: {inp.get('label')}\n</규정>\n\n"
        f"<현행조문>\n{inp['current']}\n</현행조문>\n\n<개정방향>\n{inp['instruction']}\n</개정방향>\n\n<상위법조문>\n{upper}\n</상위법조문>\n\n"
        "위 현행조문을 개정방향대로 고친 개정 조문 본문 전체를 JSON으로 답하라."
    )


def amend_retry(reason: str) -> str:
    return f"방금 개정안이 검증에 걸렸다: {reason}\n절대 규칙을 지켜 같은 JSON 형식으로 개정 조문 본문 전체를 다시 써라."


CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
_PENALTY = re.compile(r"(과태료|벌금|벌칙|징역|구류|과징금|금고)")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def paragraphs(text: str) -> list[str]:
    out = [""]
    for ch in text:
        if ch in CIRCLED:
            out.append(ch)
        else:
            out[-1] += ch
    return [_norm(p) for p in out]


def _marks(text: str) -> list[str]:
    return [ch for ch in text if ch in CIRCLED]


def _law_refs(s: str) -> list[str]:
    return [m.group(1).replace(" ", "") for m in re.finditer(r"「([^」]{2,60})」", s)]


def _article_refs(s: str) -> list[str]:
    return [f"{m.group(1)}의{m.group(2)}" if m.group(2) else m.group(1) for m in re.finditer(r"제\s*(\d+)\s*조(?:의\s*(\d+))?", s)]


def _counts(text: str, with_pm: bool = False) -> set[str]:
    out: set[str] = set()
    t = re.sub(r"제\s*\d+\s*(?:조(?:의\s*\d+)?|항|호|목)", " ", text)
    for m in re.finditer(r"(오전|오후)?\s*(\d+)\s*(명|회|시|분|층|건|개|인)(?![간기])", t):
        n = int(m.group(2))
        out.add(f"{m.group(3)}:{n}")
        if with_pm and m.group(1) == "오후" and m.group(3) == "시" and n < 12:
            out.add(f"시:{n + 12}")
    return out


def guard_amend(raw, inp: dict) -> dict:
    got = raw.get("amended") if isinstance(raw, dict) and isinstance(raw.get("amended"), str) else ""
    text = re.sub(r"^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)\s*", "", got).strip()
    cur = inp["current"]
    if not text:
        return {"ok": False, "reason": "개정 조문이 비어 있음"}
    if len(text) > len(cur) * 3 + 600:
        return {"ok": False, "reason": "개정 조문이 지나치게 김(조문 체계 변경 의심)"}
    if _norm(text) == _norm(cur):
        return {"ok": False, "reason": "현행과 바뀐 내용이 없음"}
    ms = _marks(text)
    if any(m != CIRCLED[i] for i, m in enumerate(ms)):
        return {"ok": False, "reason": f"항 번호가 차례대로가 아님({''.join(ms)})"}
    cur_paras, new_paras = paragraphs(cur), paragraphs(text)
    delete_ok = bool(re.search(r"삭제|없애|폐지|제외", inp["instruction"]))
    if len(new_paras) < len(cur_paras) and not delete_ok:
        return {"ok": False, "reason": "개정 방향에 없는 항을 지움"}
    if len(ms) < len(_marks(cur)):
        return {"ok": False, "reason": "항을 지우면서 번호를 남기지 않음('② 삭제'처럼 써야 함)"}

    sources = [cur, inp.get("original") or "", inp["instruction"], *[f"{u['label']} {u['text']}" for u in inp["upper"]]]
    qty = unverified_quantities([text], sources)
    known = {c for s in sources for c in _counts(s, True)}
    cnt = sorted(c for c in _counts(text) if c not in known)
    if qty or cnt:
        labels = [quantity_label(q) for q in qty] + [f"{c.split(':')[1]}{c.split(':')[0]}" for c in cnt]
        return {"ok": False, "reason": f"현행·개정 방향·상위법에 없는 수치({', '.join(labels)})"}
    known_laws = {n for s in sources for n in _law_refs(s)}
    outside = [n for n in _law_refs(text) if n not in known_laws]
    if outside:
        return {"ok": False, "reason": f"현행·상위법에 없는 법령 인용({', '.join(outside)})"}
    if _PENALTY.search(text) and not _PENALTY.search(" ".join([cur, inp.get("original") or "", inp["instruction"]])):
        return {"ok": False, "reason": "현행에 없던 제재(벌칙·과태료 등)를 만듦"}

    warnings: list[str] = []
    known_arts = {n for s in sources for n in _article_refs(s)}
    new_arts = list(dict.fromkeys(n for n in _article_refs(text) if n not in known_arts))
    if new_arts:
        names = ", ".join(f"제{n.replace('의', '조의')}" if "의" in n else f"제{n}조" for n in new_arts)
        warnings.append(f"현행에 없던 조문 인용({names}) — 같은 규정에 실제로 있는지 확인하세요.")

    changes: list[str] = []
    for i, n in enumerate(new_paras):
        c = cur_paras[i] if i < len(cur_paras) else None
        if i == 0:
            if n != c:
                changes.append("본문 개정")
            continue
        lead = f"제{CIRCLED.index(n[0]) + 1}항"
        if c is None:
            changes.append(f"{lead} 신설")
        elif re.match(r"^.\s*삭제", n) and not re.match(r"^.\s*삭제", c):
            changes.append(f"{lead} 삭제")
        elif n != c:
            changes.append(f"{lead} 개정")
    if not changes:
        return {"ok": False, "reason": "현행과 바뀐 내용이 없음"}
    return {"ok": True, "text": text, "changes": changes, "warnings": warnings}
