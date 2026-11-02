"""제정안 AI 채우기 — 표준 문형 초안의 ○○ 자리만 생성형 AI가 채우고, 가드가 결정적으로 검증한다(lib/enact-fill.ts 와 같음)
 - 빈칸 밖 글자를 바꾸면(조문 체계·문형 변경) 그 조문은 버림
 - 채운 값에 근거 목록 밖 법령·조문 인용이 있거나, 초안에 없던 벌칙·과태료·의무를 만들면 버림
 - 상위 조문 기준(기한·금액)보다 큰 값은 경고"""
from __future__ import annotations

import re

SLOT = re.compile(r"○○|○일|○명|○회")

FILL_SYSTEM = """너는 행정규칙·자치법규 제정안 작성을 돕는 법제 보조 AI다.
[절대 규칙]
1. 주어진 조문 초안에서 ○○, ○일, ○명, ○회 자리만 채운다. 그 밖의 글자·조사·문장부호·항 번호는 한 글자도 바꾸지 않는다.
2. ○일·○명·○회 자리에는 숫자를 넣는다(예: ○일 → 10일).
3. 근거 조문에 기한·금액 기준이 있으면 그 범위를 넘지 않게 채운다.
4. 근거 조문에 없는 법령명·조문 번호를 새로 쓰지 않는다.
5. 벌칙·과태료·벌금 같은 새 제재를 만들지 않는다.
6. 기관 실정에 따라 달라 확실하지 않은 자리는 ○○를 그대로 둔다.
7. 출력은 {"articles":[{"label":"제1조(목적)","text":"채운 조문 전체"}]} 형식의 JSON 객체 하나만 출력한다."""


def build_fill_prompt(inp: dict) -> str:
    basis = "\n\n".join(f"<<{b['label']}>>\n{b['text']}" for b in inp["basis"]) if inp["basis"] else "(없음)"
    arts = "\n".join(f"{a['label']} {a['text']}" for a in inp["articles"])
    return (
        f"<규정>\n이름: {inp.get('name') or '(미정)'}\n종류: {inp.get('kind')}\n기관: {inp.get('org') or '(미정)'}\n제정 목적: {inp.get('purpose') or '(미정)'}\n</규정>\n\n"
        f"<근거조문>\n{basis}\n</근거조문>\n\n<조문초안>\n{arts}\n</조문초안>\n\n위 조문초안의 빈칸만 채워 JSON으로 답하라."
    )


_PARTICLE = [("을(를)", r"(?:을\(를\)|을|를)"), ("이(가)", r"(?:이\(가\)|이|가)"), ("은(는)", r"(?:은\(는\)|은|는)"), ("과(와)", r"(?:과\(와\)|과|와)"), ("으로(로)", r"(?:으로\(로\)|으로|로)")]
_PENALTY = re.compile(r"(과태료|벌금|벌칙|징역|구류|과징금)")


def _ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _fixed(part: str) -> str:
    out = re.escape(_ws(part)).replace(r"\ ", r"\s*").replace(" ", r"\s*")
    for p, pat in _PARTICLE:
        out = out.replace(re.escape(p), pat)
    return out


def match_fill(template: str, filled: str) -> list[str] | None:
    """초안(빈칸 있음)과 AI가 채운 조문 대조 → 채운 값 목록(빈칸 밖이 바뀌었으면 None)"""
    parts = SLOT.split(_ws(template))
    if len(parts) == 1:
        return [] if _ws(template) == _ws(filled) else None
    m = re.fullmatch("([^\\n]{1,60}?)".join(_fixed(p) for p in parts), _ws(filled), re.S)
    return [v.strip() for v in m.groups()] if m else None


def settle_particles(text: str) -> str:
    """채운 낱말 뒤 겸용 조사 정리: '외부강의등을(를)' → '외부강의등을'(앞 글자 받침 기준, 빈칸이 남은 '○○을(를)'은 그대로)"""

    def rep(m):
        ch, pair = m.group(1), m.group(2)
        jong = (ord(ch) - 0xAC00) % 28
        if pair.startswith("으로"):
            return ch + ("로" if jong in (0, 8) else "으로")
        a, b = pair.replace(")", "").split("(")
        return ch + (a if jong else b)

    return re.sub(r"([가-힣])(을\(를\)|이\(가\)|은\(는\)|과\(와\)|으로\(로\))", rep, text)


def _law_refs(s: str) -> list[tuple[str, str | None]]:
    return [(m.group(1).replace(" ", ""), m.group(2)) for m in re.finditer(r"「([^」]{2,60})」\s*(?:제\s*(\d+)조)?", s)]


def guard_fill(raw, inp: dict) -> dict:
    got: dict[str, str] = {}
    lst = raw.get("articles") if isinstance(raw, dict) and isinstance(raw.get("articles"), list) else []
    for a in lst:
        if isinstance(a, dict) and isinstance(a.get("label"), str) and isinstance(a.get("text"), str):
            # AI가 조문 머리(제N조(제목))를 본문 앞에 다시 붙여도 본문만 대조
            got[a["label"].strip()] = re.sub(r"^\s*제\d+조(?:의\d+)?\([^)]*\)\s*", "", a["text"])
    basis_laws = [r for b in inp["basis"] for r in _law_refs(b["label"])]
    limits = [
        (int(m.group(1).replace(",", "")), m.group(2), re.sub(r"\(.*\)$", "", b["label"]))
        for b in inp["basis"]
        for m in re.finditer(r"(\d[\d,]*)\s*(일|개월|년|만원|원)\s*(?:이내|이하|까지|를 넘지|을 넘지)", b["text"])
    ]
    rejected: list[dict] = []
    warnings: list[str] = []
    articles: list[dict] = []
    for a in inp["articles"]:
        # 화면·결과는 원래 줄바꿈(①·② 항)을 살린 초안 조각으로, 대조만 공백을 정리해서
        parts = SLOT.split(a["text"])
        keep = {"label": a["label"], "text": a["text"], "parts": parts, "values": ["○○"] * (len(parts) - 1), "filled": 0}
        t = got.get(a["label"]) if len(parts) > 1 else None
        if not t:
            articles.append(keep)
            continue
        values = match_fill(a["text"], t)
        if values is None:
            rejected.append({"label": a["label"], "reason": "빈칸 밖 문구를 바꿈", "got": t[:160]})
            articles.append(keep)
            continue
        joined = " ".join(values)
        outside = [r for r in _law_refs(joined) if not any(b[0] == r[0] and (not r[1] or not b[1] or b[1] == r[1]) for b in basis_laws)]
        if outside:
            rejected.append({"label": a["label"], "reason": f"근거 목록에 없는 법령 인용({', '.join(r[0] for r in outside)})"})
            articles.append(keep)
            continue
        if _PENALTY.search(joined) and not _PENALTY.search(a["text"]):
            rejected.append({"label": a["label"], "reason": "초안에 없던 제재(벌칙·과태료 등)를 만듦"})
            articles.append(keep)
            continue
        for v in values:
            for m in re.finditer(r"(\d[\d,]*)\s*(일|개월|년|만원|원)", v):
                lim = next((l for l in limits if l[1] == m.group(2)), None)
                if lim and int(m.group(1).replace(",", "")) > lim[0]:
                    warnings.append(f"{a['label']}의 ‘{m.group(0)}’이(가) {lim[2]}의 기준({lim[0]}{lim[1]})보다 큽니다.")
        text = parts[0] + "".join(values[i] + parts[i + 1] for i in range(len(values)))
        articles.append({"label": a["label"], "text": settle_particles(text), "parts": parts, "values": values, "filled": sum(1 for v in values if not v.startswith("○"))})
    return {"articles": articles, "rejected": rejected, "warnings": warnings}
