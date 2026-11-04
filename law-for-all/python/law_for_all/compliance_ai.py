"""자체규정 AI 검토 — 규정 조문마다 국가법령정보에서 찾은 상위 조문 원문을 붙여 생성형 AI가 상충·검토 필요·적합을 판단하고,
가드가 결정적으로 검증한다(lib/compliance-ai.ts 와 같음).
 - 문제점의 근거는 그 조문에 붙인 상위 조문 키만 인정
 - 문제점·고칠 방향의 금액·기간·비율은 규정 조문이나 근거 상위 조문 원문에 있어야 함
 - 근거가 확인된 문제점이 하나도 남지 않으면 상충·검토 필요 판단을 '판단 보류'로 낮춤"""
from __future__ import annotations

import re

from .guard import resolve_key
from .numbers import unverified_quantities

AI_VERDICTS = ["상충", "검토 필요", "적합", "판단 보류"]

# 목적·정의·시행일 같은 일반 조문은 상위 조문 검색을 건너뜀(규칙이 연결한 조문만 사용) — lib/compliance-ai.ts GENERIC_ARTICLE 과 같음
GENERIC_ARTICLE = re.compile(r"^(?:목적|정의|용어의 정의|시행일|적용 ?범위|위임|시행세칙|세부 ?사항|재검토기한)$")

COMPLIANCE_SYSTEM = """너는 공공기관 자체규정(내부규정·조례·지침)을 상위법령과 대조하는 법제 검토 AI다.
[절대 규칙]
1. 각 조문은 그 조문에 붙은 <상위조문>에만 비추어 검토한다. 상위조문에 없는 법령·조문·금액·기간·비율을 만들어내지 않는다.
2. verdict 는 다음 중 하나다.
   - "상충": 상위조문과 명백히 어긋남(법정 기준 미달·초과, 금지된 것을 허용, 반드시 거쳐야 할 절차를 빠뜨림)
   - "검토 필요": 어긋날 가능성이 있거나 문구가 불명확함, 상위조문이 정한 사항이 빠짐
   - "적합": 붙은 상위조문의 기준을 충족함
   - "판단 보류": 붙은 상위조문이 이 조문과 관련이 없거나 판단할 근거가 부족함
3. 상충·검토 필요이면 문제점마다 {"point":"무엇이 왜 문제인지 한두 문장","basis":["근거 상위조문 키"],"suggestion":"고칠 방향 한 문장"}을 쓴다. basis 에는 그 조문의 <상위조문>에 있는 키만 쓴다.
4. 기관이 자율로 정할 수 있는 사항(내부 절차·부서명·서식 등)은 상위조문에 기준이 없으면 문제 삼지 않는다.
5. 공문서체(~함, ~임)로 간결하게 쓴다. 문제점은 조문당 3개 이내, point 는 2문장 이내, suggestion 은 1문장으로 쓰고 같은 내용을 되풀이하지 않는다. 조문 키·내부 용어("상위조문 목록" 등)를 문장에 쓰지 않는다.
6. 출력은 {"articles":[{"no":"3","verdict":"상충","issues":[...]}]} 형식의 JSON 객체 하나만 출력한다. 입력의 모든 조문에 대해 답한다."""


def build_compliance_prompt(reg_name: str, org_type: str, articles: list[dict]) -> str:
    parts = []
    for a in articles:
        up = "\n\n".join(f"[[{u['key']}]] {u['label']}\n{u['text'][:1200]}" for u in a["upper"]) if a["upper"] else "(찾은 상위조문 없음)"
        parts.append(f"<<조문 no={a['no']}>> {a['label']}\n{a['text']}\n<상위조문>\n{up}\n</상위조문>")
    body = "\n\n".join(parts)
    return f"<규정>\n이름: {reg_name or '(미정)'}\n기관 유형: {org_type}\n</규정>\n\n{body}\n\n위 조문마다 상위조문과 대조한 결과를 JSON으로 답하라."


def _norm_no(s) -> str:
    t = re.sub(r"\s", "", str(s if s is not None else "")).removeprefix("제")
    return re.sub(r"조(?:의(\d+))?.*$", lambda m: f"의{m.group(1)}" if m.group(1) else "", t)


def _str(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def guard_compliance(raw, articles: list[dict]) -> list[dict]:
    lst = raw.get("articles") if isinstance(raw, dict) and isinstance(raw.get("articles"), list) else []
    out = []
    for a in articles:
        got = next((x for x in lst if isinstance(x, dict) and _norm_no(x.get("no")) == a["no"]), None)
        if not got:
            out.append({"no": a["no"], "verdict": "판단 보류", "issues": [], "dropped": 0, "note": "AI가 이 조문에 답하지 않음"})
            continue
        allowed = {u["key"] for u in a["upper"]}
        verdict = _str(got.get("verdict")) if _str(got.get("verdict")) in AI_VERDICTS else "판단 보류"
        dropped, issues = 0, []
        for it in got.get("issues") if isinstance(got.get("issues"), list) else []:
            it = it if isinstance(it, dict) else {}
            # 내부 용어가 문장에 섞이면 화면용 말로
            tidy = lambda t: re.sub(r"\[\[[^\]]+\]\]", "", re.sub(r"상위\s?조문\s?목록", "확인된 상위 조문", t)).strip()  # noqa: E731
            point, suggestion = tidy(_str(it.get("point"))), tidy(_str(it.get("suggestion")))
            keys = [resolve_key(re.sub(r"^\[\[|\]\]$", "", _str(k)), allowed) for k in (it.get("basis") if isinstance(it.get("basis"), list) else [])]
            basis = list(dict.fromkeys(k for k in keys if k))
            if not point or not basis:
                dropped += 1
                continue
            sources = [a["text"], *[u["text"] for u in a["upper"] if u["key"] in basis]]
            if unverified_quantities([point, suggestion], sources):
                dropped += 1
                continue
            issues.append({"point": point, "suggestion": suggestion, "basis": basis})
        note = None
        if verdict in ("상충", "검토 필요") and not issues:
            note = f"근거가 확인되지 않은 지적 {dropped}건을 버려 판단 보류" if dropped else "문제점 근거 없음"
            verdict = "판단 보류"
        if verdict == "적합" and not a["upper"]:
            verdict = "판단 보류"
        if verdict in ("적합", "판단 보류"):
            issues = []
        r = {"no": a["no"], "verdict": verdict, "issues": issues, "dropped": dropped}
        if note:
            r["note"] = note
        out.append(r)
    return out
