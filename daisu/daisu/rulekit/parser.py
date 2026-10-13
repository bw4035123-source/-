"""규정 문서(조문·표) → 이수시간 인정 Rule 목록.

공무원 교육훈련 지침, 지방공무원 평정규칙 같은 문서는 기관·연도마다 문구가 조금씩 다르다. 그래서
"조 → 항 → 호" 단위로 문장을 나눈 뒤, 각 문장에서 다음을 정규식으로 읽는다(AI 추측 없음).

  분야      기본교육 · 전문교육 · 자기개발 · 가점(가산점)
  상한      연간/연/매년 N시간 (까지·이내·한도·초과할 수 없다·최대)   → per=year
            1회/건당/과정당 N시간                                      → per=record
            1일/하루 N시간                                             → per=day
  인정비율  N분의 M · N% 인정
  대상      N급 이하/이상 · ○○직렬 · 팀장 등 직위 · 임기제 등 고용형태 · 재직 N년 이상
  가점      N시간마다(당) M점 · 최대(한도) K점
  의무시간  (분야)을 연간 N시간 이상 이수 → Requirement

읽지 못한 문장(시간·점수 숫자가 있는데 규칙이 안 된 것)은 unparsed 로 돌려주어 사람이 확인하게 한다.
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal

from pydantic import BaseModel, Field

from .schema import (BonusRule, Category, EligibilityCondition, HoursCap, LegalBasis, Requirement, Rule,
                     RuleSet)

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
ART = re.compile(r"^\s*(제(\d+)조(?:의(\d+))?)\s*(?:\(([^)]*)\))?", re.M)
PARA = re.compile(rf"(?m)^\s*([{CIRCLED}])\s*")
ITEM = re.compile(r"(?m)^\s*(\d{1,2})\.\s+")
NUM = r"(\d+(?:\.\d+)?)"

CAT_WORDS = [(Category.BASIC, r"기본\s*교육"), (Category.PROFESSIONAL, r"전문\s*교육"),
             (Category.SELF_DEV, r"자기\s*개발(?:\s*학습)?"), (Category.BONUS, r"가\s*(?:산)?\s*점")]
CAP_UNIT = [("year", r"(?:연간|연|매년|1년에?|한\s*해에?)"), ("record", r"(?:1회|회당|건당|1건|과정당|1과정)"),
            ("day", r"(?:1일|하루|일일)")]
CAP_TAIL = r"(?:까지|이내|을\s*한도로|를\s*한도로|한도|을\s*초과할\s*수\s*없|를\s*초과할\s*수\s*없|초과\s*불가|만\s*인정|인정)"


class ParseResult(BaseModel):
    rules: list[Rule] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    unparsed: list[str] = Field(default_factory=list)

    def ruleset(self, version: str = "1", effective_date: dt.date | None = None) -> RuleSet:
        return RuleSet(version=version, effective_date=effective_date, rules=self.rules, requirements=self.requirements)


def _dec(x: str) -> Decimal:
    return Decimal(x)


# ───────────── 문장 하나에서 읽기
def categories(text: str) -> list[Category]:
    return [c for c, pat in CAT_WORDS if re.search(pat, text)]


def cap(text: str) -> HoursCap | None:
    for per, unit in CAP_UNIT:
        m = re.search(rf"{unit}\s*(?:최대|최고)?\s*{NUM}\s*시간\s*{CAP_TAIL}", text)
        if m:
            return HoursCap(hours=_dec(m.group(1)), per=per, text=m.group(0))
    m = re.search(rf"(?:최대|상한)\s*{NUM}\s*시간", text)
    if m:
        return HoursCap(hours=_dec(m.group(1)), per="year", text=m.group(0))
    return None


def ratio(text: str) -> Decimal | None:
    m = re.search(r"(\d+)\s*분의\s*(\d+)", text)
    if m and int(m.group(1)) > 0 and 0 < int(m.group(2)) <= int(m.group(1)):
        return Decimal(int(m.group(2))) / Decimal(int(m.group(1)))
    m = re.search(rf"{NUM}\s*(?:%|퍼센트)\s*(?:만|를|을|로)?\s*(?:인정|반영|환산)", text)
    if m and 0 < float(m.group(1)) <= 100:
        return _dec(m.group(1)) / 100
    return None


def conditions(text: str) -> list[EligibilityCondition]:
    out = []
    m = re.search(r"(\d+)\s*급\s*(이하|이상)", text)
    if m:
        n = int(m.group(1))
        # 숫자가 클수록 하위 직급: 6급 이하 = grade_level ≥ 6
        out.append(EligibilityCondition(field="grade_level", op="gte" if m.group(2) == "이하" else "lte", value=n, text=m.group(0)))
    else:
        grades = re.findall(r"(\d+)\s*급(?!\s*(?:이하|이상))", text)
        if grades and re.search(r"\d+\s*급\s*(?:공무원|직원|및|·|,|과|와|에\s*한)", text):
            out.append(EligibilityCondition(field="grade_level", op="in", value=sorted({int(g) for g in grades}),
                                            text=", ".join(f"{g}급" for g in grades)))
    series = re.findall(r"([가-힣]{1,8}?)\s*직렬", text)
    series = [s for s in series if s not in ("각", "해당", "모든", "전", "동일")]
    if series:
        out.append(EligibilityCondition(field="series", op="in", value=sorted(set(series)), text=" ".join(f"{s}직렬" for s in series)))
    m = re.search(r"(팀장|과장|국장|부서장|관리자|감독자)", text)
    if m and re.search(rf"{m.group(1)}\s*(?:급|이상|에게|은|는|의|을|를|에\s*한)", text):
        out.append(EligibilityCondition(field="position", op="contains", value=m.group(1), text=m.group(0)))
    m = re.search(r"(임기제|시간선택제|공무직|기간제)", text)
    if m:
        out.append(EligibilityCondition(field="employment", op="contains", value=m.group(1), text=m.group(0)))
    m = re.search(rf"재직\s*(?:기간)?\s*(?:이)?\s*{NUM}\s*년\s*이상", text)
    if m:
        out.append(EligibilityCondition(field="tenure_years", op="gte", value=float(m.group(1)), text=m.group(0)))
    return out


def bonus(text: str) -> BonusRule | None:
    m = re.search(rf"{NUM}\s*시간\s*(?:마다|당|을\s*단위로|단위로)\s*{NUM}\s*점", text)
    if not m:
        return None
    mx = re.search(rf"(?:최대|상한|한도|총)\s*{NUM}\s*점|{NUM}\s*점\s*(?:을|를)?\s*(?:한도|초과할\s*수\s*없|까지)", text)
    mxv = (mx.group(1) or mx.group(2)) if mx else None
    return BonusRule(unit_hours=_dec(m.group(1)), points_per_unit=_dec(m.group(2)), max_points=_dec(mxv) if mxv else None,
                     text=(m.group(0) + (" / " + mx.group(0) if mx else "")))


def requirement_hours(text: str) -> list[tuple[Category | None, Decimal, str]]:
    """'기본교육을 연간 40시간 이상 이수' → [(기본교육, 40, 원문)]. 분야가 없으면 합계(None)."""
    out = []
    for m in re.finditer(rf"(?:연간|매년|1년에?|연)\s*{NUM}\s*시간\s*이상", text):
        before = text[max(0, m.start() - 40):m.start()]
        cats = [c for c, pat in CAT_WORDS if c != Category.BONUS and re.search(pat, before)]
        out.append((cats[-1] if cats else None, _dec(m.group(1)), m.group(0)))
    return out


# ───────────── 문서 나누기
def units(text: str):
    """(조, 조문 제목, 항, 호, 문장) 단위로 나눈다."""
    arts = list(ART.finditer(text))
    if not arts:
        yield ("", "", None, None, text)
        return
    for i, a in enumerate(arts):
        body = text[a.end(): arts[i + 1].start() if i + 1 < len(arts) else len(text)]
        art, title = a.group(1), a.group(4) or ""
        paras = list(PARA.finditer(body))
        chunks = [(None, body)] if not paras else \
            [(CIRCLED.index(p.group(1)) + 1, body[p.end(): paras[j + 1].start() if j + 1 < len(paras) else len(body)])
             for j, p in enumerate(paras)]
        if paras and body[:paras[0].start()].strip():
            chunks.insert(0, (None, body[:paras[0].start()]))
        for pno, ptxt in chunks:
            items = list(ITEM.finditer(ptxt))
            head = ptxt[:items[0].start()] if items else ptxt
            yield (art, title, pno, None, (title + " " + head).strip())
            for k, it in enumerate(items):
                itxt = ptxt[it.end(): items[k + 1].start() if k + 1 < len(items) else len(ptxt)]
                # 호는 항의 머리 문장(예: '다음 각 호의 시간을 인정한다')과 함께 읽는다
                yield (art, title, pno, int(it.group(1)), (title + " " + head.strip() + " " + itxt).strip())


def parse_text(text: str, law_name: str, effective_date: dt.date | None = None) -> ParseResult:
    res = ParseResult()
    seq: dict[str, int] = {}
    for art, title, pno, ino, sent in units(text):
        s = re.sub(r"\s+", " ", sent)
        basis = LegalBasis(law_name=law_name, article=art or "제0조", paragraph=pno, item=ino,
                           effective_date=effective_date, text=s[:300]) if art else None
        made = False
        # 의무 이수시간
        for cat, hrs, raw in requirement_hours(s):
            conds = conditions(s)
            rid = f"REQ-{(art or 'X').replace('제', 'A').replace('조', '').replace('의', 'S')}-{len(res.requirements) + 1}"
            existing = next((r for r in res.requirements if r.conditions == conds and r.legal_basis and basis
                             and r.legal_basis.article == basis.article), None)
            if existing is None:
                existing = Requirement(requirement_id=rid, conditions=conds, legal_basis=basis)
                res.requirements.append(existing)
            if cat is None:
                res.requirements[res.requirements.index(existing)] = existing.model_copy(update={"total_required": hrs})
            else:
                res.requirements[res.requirements.index(existing)] = existing.model_copy(
                    update={"required_hours": {**existing.required_hours, cat: hrs}})
            made = True
        # 인정 기준(상한·비율·가점)
        cats = categories(s)
        c, r, b = cap(s), ratio(s), bonus(s)
        if cats and basis and (c or r or b) and not (requirement_hours(s) and not (c or r or b)):
            for cat in cats:
                if cat == Category.BONUS and not b:
                    continue
                if cat != Category.BONUS and not (c or r):
                    continue
                key = f"{cat.code}-{art.replace('제', 'A').replace('조', '').replace('의', 'S')}"
                seq[key] = seq.get(key, 0) + 1
                res.rules.append(Rule(rule_id=f"{key}-{seq[key]}", category=cat, title=(title or cat.value).strip(),
                                      legal_basis=basis, eligibility_conditions=conditions(s), max_hours_cap=c,
                                      credit_ratio=r or Decimal(1), bonus=b if cat == Category.BONUS else None))
                made = True
        if not made and re.search(r"\d+\s*(?:시간|점)", s) and (cats or "인정" in s):
            res.unparsed.append(f"{law_name} {art} {('제%d항' % pno) if pno else ''} {s[:160]}".strip())
    return res


def parse_table(rows: list[list[str]], law_name: str, where: str, effective_date: dt.date | None = None,
                article: str = "제0조") -> ParseResult:
    """구분(분야) | 인정 기준·한도 | 대상 | 비율 같은 표. 행마다 문장처럼 읽는다."""
    res = ParseResult()
    if not rows:
        return res
    head = [re.sub(r"\s+", "", h or "") for h in rows[0]]
    if not any(re.search(r"구분|분야|교육", h) for h in head):
        return res
    for i, r in enumerate(rows[1:], 2):
        s = " ".join(f"{head[j] if j < len(head) else ''} {c}" for j, c in enumerate(r) if c)
        sub = parse_text(s, law_name, effective_date)
        for k, rule in enumerate(sub.rules, 1):
            res.rules.append(rule.model_copy(update={
                "rule_id": f"{rule.category.code}-T{re.sub(r'[^0-9]', '', where) or '0'}R{i}-{k}",
                "legal_basis": LegalBasis(law_name=law_name, article=article, effective_date=effective_date,
                                          text=f"{where} {i}행: {' / '.join(c for c in r if c)}"[:300])}))
        res.unparsed += sub.unparsed
    return res


def parse_document(texts: list[str], tables: list[tuple[str, list[list[str]]]], law_name: str,
                   effective_date: dt.date | None = None) -> ParseResult:
    """다이수 readers 로 읽은 문서(문단 목록·표 목록)를 한 번에."""
    out = parse_text("\n".join(texts), law_name, effective_date)
    for where, rows in tables:
        t = parse_table(rows, law_name, where, effective_date)
        out.rules += t.rules
        out.unparsed += t.unparsed
    return out
