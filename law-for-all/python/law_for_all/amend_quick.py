"""한 번에 개정 — 조문 + "개정해줘" → AI 개정(가드: amend_ai.guard_amend) → 3가지 양식 자료(lib/amend-quick.ts 와 같음, 표 조립은 화면에서)"""
from __future__ import annotations

import re

QUICK_SYSTEM = """너는 공공기관 규정·조례·법령 개정을 돕는 법제 전문 AI다.
[절대 규칙]
1. <개정요청>에 구체적인 내용이 있으면 그대로 반영한다. "개정해줘·수정해줘"처럼 구체 내용이 없으면, 내용(의무·기준·수치)은 바꾸지 않고 공공기관 공문서·법제 표준 문체로 다듬는다: 맞춤법·띄어쓰기, 법령 용어 정비(예: "~해야 한다" → "~하여야 한다"), 모호한 표현의 명확화, 항·호 구성 정리. 다만 <상위조문>의 기준에 어긋나는 부분은 상위 기준에 맞게 고친다. 어긋나는 조항은 삭제하지 말고 상위조문이 정한 기준(대상·기간·일수)을 그대로 옮겨 고쳐 쓴다. 단, 상위조문이 이 조문과 같은 대상·사항을 직접 정할 때만 상위 기준으로 고친다. 적용 대상이 다른 상위조문(특정 유형의 민원·근로자에만 적용되는 기준 등)은 근거로 삼지 않고, 현행 기준을 완화(횟수 제한·기한·요건 삭제)하지 않는다. 판단이 서지 않으면 내용은 그대로 두고 문체만 다듬는다.
2. 바꿀 필요가 없는 조문은 결과에서 뺀다. 조 번호·조 제목은 그대로 둔다.
3. 수치(기간·금액·인원·비율)는 <조문>·<개정요청>·<상위조문>에 있는 값만 쓴다. <상위조문>에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료 같은 제재를 새로 만들지 않는다.
4. 의무(~하여야 한다)를 재량(~할 수 있다)으로, 또는 그 반대로 바꾸지 않는다(요청이나 상위 기준이 그렇게 요구할 때만).
5. 항이 둘 이상이면 ①②③…을 차례대로 붙인다. 조 머리(제N조(제목))는 amended 에 쓰지 않는다.
6. summary 는 무엇이 왜 바뀌는지 1~2문장(공문서체, ~함)으로 쓴다. 서론·인사말·덧붙임 말은 쓰지 않는다.
7. 출력은 {"summary":"","articles":[{"label":"제5조(처리기간)","amended":"개정한 본문 전체"}]} 형식의 JSON 객체 하나만 출력한다."""

_REQUEST_LINE = re.compile(r"(개정|수정|다듬|고쳐|바꿔|정비|손봐|보완)\s*(?:해\s*)?(?:줘|주세요|주십시오|줄래|달라|하라|해라|해)?\s*[.!?~]*\s*$")


def split_quick(inp: str) -> tuple[str, list[dict]]:
    req, body = [], []
    for line in inp.replace("\r", "").split("\n"):
        t = line.strip()
        if t and not re.match(r"^제\s*\d+\s*조", t) and _REQUEST_LINE.search(t) and len(t) <= 200:
            req.append(t)
        else:
            body.append(line)
    text = "\n".join(body).strip()
    arts: list[dict] = []
    for line in text.split("\n"):
        m = re.match(r"^(제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?)\s*(.*)$", line.strip())
        if m:
            label = re.sub(r"^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*", lambda x: f"제{x.group(1)}조" + (f"의{x.group(2)}" if x.group(2) else ""), m.group(1)).strip()
            arts.append({"label": label, "text": m.group(2).strip()})
        elif arts and line.strip():
            arts[-1]["text"] += "\n" + line.strip()
        elif line.strip():
            arts.append({"label": "(조문)", "text": line.strip()})
    merged: list[dict] = []
    for a in arts:
        if merged and merged[-1]["label"] == "(조문)" and a["label"] == "(조문)":
            merged[-1]["text"] += "\n" + a["text"]
        else:
            merged.append(dict(a))
    return (" ".join(req) or "개정해줘"), [a for a in merged if a["text"]]


def build_quick_prompt(request: str, articles: list[dict], upper: list[dict]) -> str:
    arts = "\n".join(f"{a['label']} {a['text']}" for a in articles)
    up = "\n\n".join(f"<<{u['label']}>>\n{u['text'][:1200]}" for u in upper) if upper else "(찾은 상위조문 없음)"
    return f"<개정요청>\n{request}\n</개정요청>\n\n<조문>\n{arts}\n</조문>\n\n<상위조문>\n{up}\n</상위조문>\n\n위 조문의 개정안을 JSON으로 답하라."


_QTY = re.compile(r"\d+(?:\.\d+)?\s*(?:퍼센트|개월|시간|만원|일|년|분|원|명|%|회)")


def is_bare_request(request: str) -> bool:
    return not re.search(r"\d", request) and len(re.sub(r"[\s.,!?~]", "", _REQUEST_LINE.sub("", request))) <= 6


def quantity_warning(request: str, current: str, amended: str) -> str | None:
    """구체 요청 없이 수치가 바뀌면 담당자 확인 경고(lib/amend-quick.ts quantityWarning 과 같음)"""
    if not is_bare_request(request):
        return None
    q = lambda t: ", ".join(sorted({re.sub(r"\s", "", x) for x in _QTY.findall(t)}))  # noqa: E731
    a, b = q(current), q(amended)
    return None if a == b else f"요청에 없던 수치 변경({a or '없음'} → {b or '없음'}) — 상위 기준이 이 조문에 그대로 적용되는지 확인 필요"
