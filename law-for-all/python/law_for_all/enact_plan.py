"""한 줄 제정 — 한 줄 요청에서, 국가법령정보에서 찾은 상위 조문을 보고 생성형 AI가 규정 설계(규정명·종류·목적·담을 조문·용어·근거 조문)를 정한다
(lib/enact-plan.ts 와 같음). 조문 문형은 결정적 표준 초안이, 빈칸은 AI 채우기(가드 검증)가 맡는다"""
from __future__ import annotations

import re

from .guard import resolve_key

PLAN_SYSTEM = """너는 공공기관 내부 규정(행정규칙·자치법규) 제정을 설계하는 법제 보조 AI다.
[절대 규칙]
1. 사용자의 요청과 <상위조문>을 보고 제정할 규정의 설계만 한다. 조문 문장은 쓰지 않는다.
2. name: 기관명을 넣은 규정 이름(예: "○○공단 산업안전보건 관리 지침"). 기관명을 모르면 "○○"을 쓴다.
3. kind: 기관 내부 규정이면 "행정규칙", 지방자치단체 조례·규칙이면 "자치법규".
4. purpose: 제정 목적 한 문장(~하기 위함).
5. items: 규정에 담을 조문 제목 5~10개(명사구, 예: "안전보건관리책임자 지정", "안전보건교육"). <상위조문>이 사업주·기관에 부과한 의무와 절차를 빠짐없이 반영한다. 목적·정의·부칙은 넣지 않는다.
6. terms: 정의가 필요한 용어 0~5개.
7. basis: 근거가 되는 상위조문 키 1~4개. <상위조문>에 있는 키만 쓴다.
8. 벌칙·과태료·벌금 같은 제재 조문은 넣지 않는다(내부 규정이 정할 수 없음).
9. 출력은 {"name":"","kind":"행정규칙","purpose":"","items":[],"terms":[],"basis":[]} 형식의 JSON 객체 하나만 출력한다."""


def build_plan_prompt(request: str, org: str, evidence: list[dict]) -> str:
    up = "\n\n".join(f"[[{e['key']}]] {e['label']}\n{e['text'][:900]}" for e in evidence) if evidence else "(찾은 상위조문 없음)"
    return f"<요청>\n{request}\n</요청>\n<기관>{org or '(미정)'}</기관>\n\n<상위조문>\n{up}\n</상위조문>\n\n위 요청에 맞는 규정 설계를 JSON으로 답하라."


_PENALTY = re.compile(r"(벌칙|과태료|벌금|징역|과징금|양벌)")


def _str(v, n: int) -> str:
    return re.sub(r"\s+", " ", v).strip()[:n] if isinstance(v, str) else ""


def _list(v) -> list:
    return v if isinstance(v, list) else []


def guard_plan(raw, evidence: list[dict], org: str = "") -> dict:
    o = raw if isinstance(raw, dict) else {}
    notes: list[str] = []
    allowed = {e["key"] for e in evidence}
    name = _str(o.get("name"), 50) or f"{org or '○○'} 규정"
    kind = "자치법규" if o.get("kind") == "자치법규" else "행정규칙"
    purpose = _str(o.get("purpose"), 200)
    items: list[str] = []
    for x in _list(o.get("items")):
        t = re.sub(r"^[(（]|[)）]$", "", re.sub(r"^\s*(?:\d+[.)]|제\s*\d+\s*조)\s*", "", _str(x, 30)))
        if not t or t in items or re.fullmatch(r"목적|정의|부칙|시행일", t):
            continue
        if _PENALTY.search(t):
            notes.append(f"‘{t}’ 조문은 뺐어요(벌칙·과태료는 내부 규정이 정할 수 없음)")
            continue
        items.append(t)
    terms = list(dict.fromkeys(t for t in (_str(x, 20) for x in _list(o.get("terms"))) if t))[:5]
    basis = list(dict.fromkeys(k for k in (resolve_key(re.sub(r"^\[\[|\]\]$", "", _str(k, 80)), allowed) for k in _list(o.get("basis"))) if k))[:4]
    if _list(o.get("basis")) and not basis:
        notes.append("AI가 고른 근거 조문이 찾은 조문 밖이라 뺐어요")
    if not basis and evidence:
        basis = [e["key"] for e in evidence[:2]]
        notes.append("근거 조문은 검색 상위 조문으로 넣었어요 — 맞는지 확인하세요")
    return {"name": name, "kind": kind, "purpose": purpose, "items": items[:10], "terms": terms, "basis": basis, "notes": notes}
