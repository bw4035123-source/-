"""이수시간 계산 엔진: LLM(또는 사람)의 판정 JSON → 개인별 인정시간·미달시간·가점.

LLM 판정은 '후보'로만 쓰고, 아래는 모두 규칙(RuleSet)으로 다시 계산·검증한다.
  1. 불인정 판정 · 없는 rule_id · 같은 record_id 중복 → 제외(사유 기록)
  2. 대상 조건(직렬·직급 등)에 맞지 않으면 → 제외
  3. 분야는 규칙의 분야로, 인정 비율은 규칙의 비율로(판정 값과 다르면 정정 사유 기록)
  4. 상한: 건당 → 같은 날 합계(일) → 규칙별 연간 합계 순서로 자름. 연간·일 상한은 날짜가 빠른 기록부터 인정
  5. 분야별 합계 → 직렬·직급에 맞는 의무 기준(가장 구체적인 것)과 비교해 미달시간
  6. 가점: 인정시간 합계를 단위 시간으로 나눈 몫 × 점수, 최대 점수까지
모든 계산은 Decimal(부동소수 오차 없음), 결과는 소수 둘째 자리까지 반올림(ROUND_HALF_UP)해 보여 준다.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from collections import defaultdict
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

from pydantic import BaseModel, Field, ValidationError

from .schema import Category, Profile, RuleSet

Q = Decimal("0.01")


class JudgmentError(ValueError):
    """판정 JSON 형식 오류(계산을 시작하지 않음)."""


class JudgedItem(BaseModel):
    record_id: str = Field(min_length=1)
    rule_id: str = Field(min_length=1)
    category: Category
    hours: Decimal = Field(gt=0, le=1000)
    recognized: bool = True
    recognized_ratio: Decimal | None = Field(default=None, gt=0, le=1)
    date: dt.date | None = None
    course: str = ""
    reason: str = ""


class Judgment(BaseModel):
    person_id: str = Field(min_length=1)
    items: list[JudgedItem] = Field(default_factory=list)


def parse_judgment(data) -> Judgment:
    """dict 또는 JSON 문자열(```json … ``` 로 감싼 것 포함)."""
    if isinstance(data, str):
        txt = data.strip()
        m = re.search(r"```(?:json)?\s*(.*?)```", txt, re.S)
        if m:
            txt = m.group(1).strip()
        try:
            data = json.loads(txt)
        except ValueError as e:
            raise JudgmentError(f"판정 결과가 JSON 형식이 아닙니다: {e}") from e
    try:
        return Judgment.model_validate(data)
    except ValidationError as e:
        raise JudgmentError(f"판정 결과 형식 오류: {e.errors()[0]['loc']} {e.errors()[0]['msg']}") from e


class ItemResult(BaseModel):
    record_id: str
    rule_id: str
    category: Category
    course: str = ""
    date: dt.date | None = None
    claimed_hours: Decimal
    credited_hours: Decimal = Decimal(0)
    status: str = "인정"  # 인정 / 제외
    notes: list[str] = Field(default_factory=list)
    basis: str = ""


class PersonResult(BaseModel):
    profile: Profile
    items: list[ItemResult]
    by_category: dict[Category, Decimal]
    total: Decimal
    requirement_id: str | None = None
    required: dict[Category, Decimal] = Field(default_factory=dict)
    total_required: Decimal | None = None
    shortfall: dict[Category, Decimal] = Field(default_factory=dict)
    total_shortfall: Decimal | None = None
    met: bool | None = None
    bonus_points: Decimal = Decimal(0)
    bonus_basis: str = ""


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q, rounding=ROUND_HALF_UP).normalize() if x else Decimal(0)


def _out(x: Decimal) -> Decimal:
    """표시용: 소수 둘째 자리 반올림, 불필요한 0 제거(3.50 → 3.5, 40.00 → 40)."""
    v = _q(x)
    return v if v != v.to_integral() else v.quantize(Decimal(1))


def compute_person(profile: Profile, judgment: Judgment | None, rs: RuleSet) -> PersonResult:
    items: list[ItemResult] = []
    seen: set[str] = set()
    accepted: list[tuple[ItemResult, object]] = []
    for j in (judgment.items if judgment else []):
        r = ItemResult(record_id=j.record_id, rule_id=j.rule_id, category=j.category, course=j.course, date=j.date,
                       claimed_hours=j.hours)
        items.append(r)
        rule = rs.get(j.rule_id)
        if j.record_id in seen:
            r.status, r.notes = "제외", ["같은 기록(record_id)이 중복됨"]
            continue
        seen.add(j.record_id)
        if not j.recognized:
            r.status, r.notes = "제외", ["판정: 불인정" + (f" – {j.reason}" if j.reason else "")]
            continue
        if rule is None:
            r.status, r.notes = "제외", [f"규칙 {j.rule_id} 없음(규칙표 확인 필요)"]
            continue
        r.basis = rule.legal_basis.cite()
        if not rule.applies_to(profile):
            why = ", ".join(c.text or f"{c.field} {c.op} {c.value}" for c in rule.eligibility_conditions if not c.check(profile))
            r.status, r.notes = "제외", [f"대상 아님({why})"]
            continue
        if rule.category != j.category:
            r.notes.append(f"분야 정정: 판정 {j.category.value} → 규칙 {rule.category.value}")
            r.category = rule.category
        credited = j.hours * rule.credit_ratio
        if j.recognized_ratio is not None and j.recognized_ratio != rule.credit_ratio:
            r.notes.append(f"인정 비율 정정: 판정 {j.recognized_ratio} → 규정 {rule.credit_ratio}")
        elif rule.credit_ratio != 1:
            r.notes.append(f"인정 비율 {rule.credit_ratio} 적용")
        cap = rule.max_hours_cap
        if cap and cap.per == "record" and credited > cap.hours:
            r.notes.append(f"건당 상한 {_out(cap.hours)}시간 적용({_out(credited)} → {_out(cap.hours)})")
            credited = cap.hours
        r.credited_hours = credited
        accepted.append((r, rule))

    # 일·연간 상한: 날짜 빠른 순(날짜 없으면 뒤로), 같은 날짜는 record_id 순으로 먼저 인정
    order = sorted(accepted, key=lambda x: (x[0].date or dt.date.max, x[0].record_id))
    used_day: dict[tuple, Decimal] = defaultdict(Decimal)
    used_year: dict[str, Decimal] = defaultdict(Decimal)
    for r, rule in order:
        cap = rule.max_hours_cap
        if not cap or cap.per == "record":
            continue
        key = (rule.rule_id, r.date) if cap.per == "day" else rule.rule_id
        used = used_day if cap.per == "day" else used_year
        room = max(Decimal(0), cap.hours - used[key])
        if r.credited_hours > room:
            unit = "1일" if cap.per == "day" else "연간"
            r.notes.append(f"{unit} 상한 {_out(cap.hours)}시간 적용({_out(r.credited_hours)} → {_out(room)})")
            r.credited_hours = room
        used[key] += r.credited_hours
    for r, _ in accepted:
        if r.credited_hours == 0:
            r.status = "제외"
        r.credited_hours = _out(r.credited_hours)

    by_cat = {c: Decimal(0) for c in Category if c != Category.BONUS}
    for r, _ in accepted:
        if r.category in by_cat:
            by_cat[r.category] += r.credited_hours
    total = sum(by_cat.values(), Decimal(0))

    res = PersonResult(profile=profile, items=items, by_category={k: _out(v) for k, v in by_cat.items()}, total=_out(total))
    req = rs.requirement_for(profile)
    if req:
        res.requirement_id = req.requirement_id
        res.required = dict(req.required_hours)
        res.shortfall = {c: _out(max(Decimal(0), h - by_cat.get(c, Decimal(0)))) for c, h in req.required_hours.items()}
        res.total_required = req.total_required
        if req.total_required is not None:
            res.total_shortfall = _out(max(Decimal(0), req.total_required - total))
        else:
            res.total_shortfall = _out(sum(res.shortfall.values(), Decimal(0)))
        res.met = res.total_shortfall == 0 and all(v == 0 for v in res.shortfall.values())

    # 가점: 인정시간 합계 기준
    pts, basis = Decimal(0), []
    for rule in rs.rules:
        if rule.category == Category.BONUS and rule.bonus and rule.applies_to(profile):
            b = rule.bonus
            units = (total / b.unit_hours).to_integral_value(rounding=ROUND_FLOOR)
            p = units * b.points_per_unit
            if b.max_points is not None:
                p = min(p, b.max_points)
            pts += p
            basis.append(f"{rule.legal_basis.cite()}: {_out(total)}시간 ÷ {_out(b.unit_hours)}시간 = {units}단위 × {b.points_per_unit}점"
                         + (f"(최대 {b.max_points}점)" if b.max_points is not None else "") + f" = {_out(p)}점")
    res.bonus_points, res.bonus_basis = _out(pts), " / ".join(basis)
    return res


def compute_all(profiles: list[Profile], judgments: list[Judgment], rs: RuleSet) -> list[PersonResult]:
    """판정이 없는 직원도 0시간으로 계산(미달시간이 드러나게)."""
    by_pid: dict[str, Judgment] = {}
    for j in judgments:
        if j.person_id in by_pid:  # 같은 사람의 판정이 나뉘어 오면 합친다
            by_pid[j.person_id] = Judgment(person_id=j.person_id, items=by_pid[j.person_id].items + j.items)
        else:
            by_pid[j.person_id] = j
    return [compute_person(p, by_pid.get(p.person_id), rs) for p in profiles]


class DeptSummary(BaseModel):
    dept: str
    headcount: int
    total_hours: Decimal
    avg_hours: Decimal
    met_count: int
    met_rate: Decimal | None
    shortfall_people: list[str] = Field(default_factory=list)
    by_category: dict[Category, Decimal] = Field(default_factory=dict)


def dept_summary(results: list[PersonResult]) -> list[DeptSummary]:
    groups: dict[str, list[PersonResult]] = defaultdict(list)
    for r in results:
        groups[r.profile.dept or "(소속 없음)"].append(r)
    out = []
    for dept, rs_ in groups.items():
        n = len(rs_)
        tot = sum((r.total for r in rs_), Decimal(0))
        judged = [r for r in rs_ if r.met is not None]
        met = sum(1 for r in judged if r.met)
        cats = {c: _out(sum((r.by_category.get(c, Decimal(0)) for r in rs_), Decimal(0))) for c in Category if c != Category.BONUS}
        out.append(DeptSummary(dept=dept, headcount=n, total_hours=_out(tot), avg_hours=_out(tot / n), met_count=met,
                               met_rate=(Decimal(100) * met / len(judged)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) if judged else None,
                               shortfall_people=[r.profile.name or r.profile.person_id for r in judged if not r.met], by_category=cats))
    return out
