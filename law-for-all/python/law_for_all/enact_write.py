"""제정안 AI 작성 — 표준 초안의 조문 체계를 그대로 두고 조문 본문을 생성형 AI가 상위 조문 원문을 보고 쓴다(lib/enact-write.ts 와 같음).
가드: 근거 목록 밖 법령 인용·초안에 없던 제재·항 번호 체계가 깨진 조문은 버리고 표준 초안 유지, 상위 조문에 없는 수치는 '확인 필요'로 알림"""
from __future__ import annotations

import re

from .numbers import extract_quantities, quantity_label

WRITE_SYSTEM = """너는 공공기관 내부 규정(행정규칙·자치법규) 제정안을 쓰는 법제 보조 AI다.
[절대 규칙]
1. <조문초안>의 조문 순서·조 번호·조 제목은 그대로 두고, 각 조문의 본문만 구체적으로 다시 쓴다.
2. 본문은 <근거조문> 원문이 정한 의무·절차·기준을 기관(규정의 주체) 입장에서 실제로 시행할 수 있게 쓴다. 근거조문의 기준(기간·횟수·인원·금액)은 원문 그대로 옮긴다.
3. <근거조문>에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료·벌금 같은 제재를 만들지 않는다.
4. 항이 둘 이상이면 ①②③…을 차례대로 붙이고, 호는 1. 2. 3.으로 쓴다. 한 조문은 1~4개 항으로 간결하게 쓴다.
5. 법제 문체(~하여야 한다, ~할 수 있다, ~한다)로 쓴다. 기관명은 <규정>의 기관을 쓰고, 모르면 ○○를 쓴다.
6. 정의 조문은 각 용어를 근거조문의 정의에 맞춰 "1. “용어”란 …을 말한다." 형식으로 쓴다.
7. 기관 실정에 따라 정할 값(내부 부서명·점검 주기 등)이 근거조문에 없으면 ○○로 둔다.
8. 출력은 {"articles":[{"label":"제1조(목적)","text":"본문"}]} 형식의 JSON 객체 하나만 출력한다. 부칙은 쓰지 않는다."""


def build_write_prompt(inp: dict) -> str:
    basis = "\n\n".join(f"<<{b['label']}>>\n{b['text'][:1500]}" for b in inp["basis"]) if inp["basis"] else "(없음 — 기관 자율 규정)"
    arts = "\n".join(f"{a['label']} {a['text']}" for a in inp["articles"])
    return (
        f"<규정>\n이름: {inp.get('name') or '(미정)'}\n종류: {inp.get('kind')}\n기관: {inp.get('org') or '○○'}\n제정 목적: {inp.get('purpose') or '(미정)'}\n</규정>\n\n"
        f"<근거조문>\n{basis}\n</근거조문>\n\n<조문초안>\n{arts}\n</조문초안>\n\n각 조문의 본문을 근거조문에 맞게 구체적으로 다시 써서 JSON으로 답하라."
    )


CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
_PENALTY = re.compile(r"(과태료|벌금|벌칙|징역|구류|과징금)")


def _law_refs(s: str) -> list[str]:
    return [m.group(1).replace(" ", "") for m in re.finditer(r"「([^」]{2,60})」", s)]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def guard_write(raw, inp: dict) -> dict:
    got: dict[str, str] = {}
    lst = raw.get("articles") if isinstance(raw, dict) and isinstance(raw.get("articles"), list) else []
    for a in lst:
        if isinstance(a, dict) and isinstance(a.get("label"), str) and isinstance(a.get("text"), str):
            got[re.sub(r"\s", "", a["label"])] = re.sub(r"^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)\s*", "", a["text"]).strip()
    allowed = {n for b in inp["basis"] for n in _law_refs(b["label"])} | {n for a in inp["articles"] for n in _law_refs(a["text"])}
    known = {q for s in [inp.get("purpose") or "", *[f"{b['label']} {b['text']}" for b in inp["basis"]]] for q in extract_quantities(s)}
    rejected, checks, articles = [], [], []
    for a in inp["articles"]:
        keep = {"label": a["label"], "text": a["text"], "written": False}
        t = got.get(re.sub(r"\s", "", a["label"]))
        if not t or _norm(t) == _norm(a["text"]):
            articles.append(keep)
            continue
        outside = [n for n in _law_refs(t) if n not in allowed]
        if outside:
            rejected.append({"label": a["label"], "reason": f"근거 목록에 없는 법령 인용({', '.join(dict.fromkeys(outside))})"})
            articles.append(keep)
            continue
        if _PENALTY.search(t) and not _PENALTY.search(a["text"]):
            rejected.append({"label": a["label"], "reason": "초안에 없던 제재(벌칙·과태료 등)를 만듦"})
            articles.append(keep)
            continue
        marks = [ch for ch in t if ch in CIRCLED]
        if any(m != CIRCLED[i] for i, m in enumerate(marks)):
            rejected.append({"label": a["label"], "reason": f"항 번호가 차례대로가 아님({''.join(marks)})"})
            articles.append(keep)
            continue
        if len(t) > 1500:
            rejected.append({"label": a["label"], "reason": "조문이 지나치게 김"})
            articles.append(keep)
            continue
        extra = [q for q in extract_quantities(t) if q not in known]
        if extra:
            checks.append({"label": a["label"], "values": [quantity_label(q) for q in extra]})
        articles.append({"label": a["label"], "text": t, "written": True})
    return {"articles": articles, "rejected": rejected, "checks": checks}
