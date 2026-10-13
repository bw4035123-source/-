"""이수시간 계산 엔진 테스트(TDD: 이 파일을 먼저 쓰고 calc.py 를 구현).

수치는 모두 시험용 가상 규칙이다(실제 지침·평정규칙 수치 아님).
"""
from __future__ import annotations

import json
from decimal import Decimal as D

import pytest

from daisu.rulekit.calc import (JudgmentError, compute_all, compute_person, dept_summary, parse_judgment)
from daisu.rulekit.schema import (BonusRule, Category, EligibilityCondition, HoursCap, LegalBasis, Profile, Requirement,
                                  Rule, RuleSet)

LB = LegalBasis(law_name="[예시] 지침", article="제5조")


def rule(rid, cat, cap=None, per="year", ratio=1, conds=(), bonus=None):
    return Rule(rule_id=rid, category=cat, title=rid, legal_basis=LB, max_hours_cap=HoursCap(hours=D(cap), per=per) if cap else None,
                credit_ratio=D(str(ratio)), eligibility_conditions=list(conds), bonus=bonus)


LOW = EligibilityCondition(field="grade_level", op="gte", value=6)   # 6급 이하
HIGH = EligibilityCondition(field="grade_level", op="lte", value=5)  # 5급 이상
FAC = EligibilityCondition(field="series", op="in", value=["시설"])

RS = RuleSet(rules=[
    rule("BASIC-A5-1", Category.BASIC, cap=40),
    rule("BASIC-A5-2", Category.BASIC, cap=8, per="record"),
    rule("PROF-A6-1", Category.PROFESSIONAL, cap=35, per="record"),
    rule("PROF-A6-2", Category.PROFESSIONAL, cap=70, conds=[FAC]),
    rule("SELF-A7-1", Category.SELF_DEV, cap=20, ratio="0.5"),
    rule("SELF-A7-2", Category.SELF_DEV, cap=2, per="day"),
    rule("BONUS-A9-1", Category.BONUS, conds=[LOW], bonus=BonusRule(unit_hours=D(10), points_per_unit=D("0.1"), max_points=D("0.5"))),
], requirements=[
    Requirement(requirement_id="REQ-LOW", conditions=[LOW], required_hours={Category.BASIC: D(40), Category.PROFESSIONAL: D(30)}),
    Requirement(requirement_id="REQ-HIGH", conditions=[HIGH], total_required=D(60)),
    Requirement(requirement_id="REQ-LOW-FAC", conditions=[LOW, FAC], required_hours={Category.BASIC: D(40), Category.PROFESSIONAL: D(50)}),
])

KIM = Profile(person_id="P1", name="김주무", dept="총무팀", series="행정", grade="7급")
LEE = Profile(person_id="P2", name="이팀장", dept="총무팀", series="행정", grade="5급")
PARK = Profile(person_id="P3", name="박시설", dept="시설팀", series="시설", grade="6급")


def J(pid, *items):
    return {"person_id": pid, "items": [dict({"recognized": True}, **it) for it in items]}


def it(rid, cat, hours, rec, date="2026-03-02", **kw):
    return {"record_id": rec, "rule_id": rid, "category": cat, "hours": hours, "date": date, "course": rec, **kw}


# ───────────── 입력(LLM 판정 JSON) 검증
class TestParseJudgment:
    def test_parses_json_text(self):
        j = parse_judgment(json.dumps(J("P1", it("BASIC-A5-1", "기본교육", 8, "r1")), ensure_ascii=False))
        assert j.person_id == "P1" and j.items[0].hours == D(8)

    @pytest.mark.parametrize("bad", [
        '{"person_id": "P1", "items": [{"record_id": "r1", "rule_id": "X-1", "category": "기본교육", "hours": -3, "recognized": true}]}',
        '{"person_id": "P1", "items": [{"record_id": "r1", "rule_id": "X-1", "category": "모름", "hours": 3, "recognized": true}]}',
        '{"items": []}',
        "이건 JSON 이 아님",
    ])
    def test_rejects_malformed(self, bad):
        with pytest.raises(JudgmentError):
            parse_judgment(bad)

    def test_accepts_code_fenced_json(self):
        """LLM 이 ```json … ``` 으로 감싸 보내도 읽는다."""
        txt = "```json\n" + json.dumps(J("P1", it("BASIC-A5-1", "기본교육", 2, "r1"))) + "\n```"
        assert parse_judgment(txt).items[0].record_id == "r1"


# ───────────── 개인 계산
class TestPerson:
    def test_simple_sum_and_shortfall(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-1", "기본교육", 12, "r1"), it("PROF-A6-1", "전문교육", 10, "r2"))), RS)
        assert r.by_category[Category.BASIC] == D(12)
        assert r.by_category[Category.PROFESSIONAL] == D(10)
        assert r.total == D(22)
        assert r.shortfall[Category.BASIC] == D(28)
        assert r.shortfall[Category.PROFESSIONAL] == D(20)
        assert r.total_shortfall == D(48)
        assert r.met is False

    def test_yearly_cap_applies_in_date_order(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-1", "기본교육", 30, "late", date="2026-09-01"),
                                                  it("BASIC-A5-1", "기본교육", 25, "early", date="2026-02-01"))), RS)
        got = {x.record_id: x.credited_hours for x in r.items}
        assert got == {"early": D(25), "late": D(15)}  # 연간 40시간 상한: 먼저 받은 교육부터 인정
        assert r.by_category[Category.BASIC] == D(40)

    def test_record_cap(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-2", "기본교육", 12, "r1"))), RS)
        assert r.items[0].credited_hours == D(8)
        assert any("건당" in x for x in r.items[0].notes)

    def test_day_cap_shared_by_same_day(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("SELF-A7-2", "자기개발", 1.5, "a", date="2026-04-01"),
                                                  it("SELF-A7-2", "자기개발", 1.5, "b", date="2026-04-01"),
                                                  it("SELF-A7-2", "자기개발", 1.5, "c", date="2026-04-02"))), RS)
        assert r.by_category[Category.SELF_DEV] == D("3.5")  # 4/1: 2시간 한도, 4/2: 1.5시간

    def test_ratio_from_rule_overrides_llm_ratio(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("SELF-A7-1", "자기개발", 9, "r1", recognized_ratio=1.0))), RS)
        assert r.items[0].credited_hours == D("4.5")
        assert any("비율" in x for x in r.items[0].notes)

    def test_ratio_then_yearly_cap(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("SELF-A7-1", "자기개발", 50, "r1"))), RS)
        assert r.items[0].credited_hours == D(20)  # 50 × 0.5 = 25 → 연간 20시간

    def test_not_recognized_and_unknown_rule_and_duplicate(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-1", "기본교육", 4, "r1", recognized=False),
                                                  it("NOPE-X-1", "기본교육", 4, "r2"),
                                                  it("BASIC-A5-1", "기본교육", 4, "r3"),
                                                  it("BASIC-A5-1", "기본교육", 4, "r3"))), RS)
        st = [(x.record_id, x.status) for x in r.items]
        assert st == [("r1", "제외"), ("r2", "제외"), ("r3", "인정"), ("r3", "제외")]
        assert r.total == D(4)

    def test_eligibility_excludes(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("PROF-A6-2", "전문교육", 10, "r1"))), RS)  # 행정직렬
        assert r.items[0].status == "제외" and "대상" in r.items[0].notes[0]
        r2 = compute_person(PARK, parse_judgment(J("P3", it("PROF-A6-2", "전문교육", 10, "r1"))), RS)  # 시설직렬
        assert r2.items[0].credited_hours == D(10)

    def test_category_mismatch_uses_rule_category(self):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-1", "전문교육", 5, "r1"))), RS)
        assert r.by_category[Category.BASIC] == D(5) and r.by_category[Category.PROFESSIONAL] == D(0)
        assert any("분야" in x for x in r.items[0].notes)


# ───────────── 직렬·직급별 의무시간
class TestRequirementBySeriesGrade:
    def test_high_grade_uses_total_requirement(self):
        r = compute_person(LEE, parse_judgment(J("P2", it("BASIC-A5-1", "기본교육", 40, "r1"), it("PROF-A6-1", "전문교육", 25, "r2"))), RS)
        assert r.requirement_id == "REQ-HIGH"
        assert r.total_required == D(60) and r.total_shortfall == D(0) and r.met is True
        assert r.bonus_points == D(0)  # 가점은 6급 이하만

    def test_most_specific_requirement_wins(self):
        r = compute_person(PARK, parse_judgment(J("P3", it("BASIC-A5-1", "기본교육", 40, "r1"), it("PROF-A6-2", "전문교육", 45, "r2"))), RS)
        assert r.requirement_id == "REQ-LOW-FAC"
        assert r.shortfall[Category.PROFESSIONAL] == D(5)

    def test_no_requirement(self):
        nobody = Profile(person_id="P9", grade="")
        r = compute_person(nobody, parse_judgment(J("P9", it("BASIC-A5-1", "기본교육", 3, "r1"))), RS)
        assert r.requirement_id is None and r.met is None and r.total_shortfall is None


# ───────────── 가점
class TestBonus:
    @pytest.mark.parametrize("hours,points", [(9, "0"), (10, "0.1"), (35, "0.3"), (55, "0.5"), (110, "0.5")])
    def test_bonus_points(self, hours, points):
        r = compute_person(KIM, parse_judgment(J("P1", it("BASIC-A5-1", "기본교육", min(hours, 40), "r1"),
                                                  *([it("PROF-A6-1", "전문교육", min(hours - 40, 35), "r2")] if hours > 40 else []),
                                                  *([it("PROF-A6-1", "전문교육", min(hours - 75, 35), "r3")] if hours > 75 else []))), RS)
        assert r.total == D(hours)
        assert r.bonus_points == D(points)


# ───────────── 정확도(부동소수 오차 없음)
def test_decimal_exactness():
    items = [it("BASIC-A5-1", "기본교육", 0.1, f"r{i}") for i in range(30)]
    r = compute_person(KIM, parse_judgment(J("P1", *items)), RS)
    assert r.by_category[Category.BASIC] == D("3.0")  # 0.1 × 30 = 3.0 (float 로 더하면 3.0000000000000013)


# ───────────── 전체·부서
def test_compute_all_and_dept_summary():
    js = [J("P1", it("BASIC-A5-1", "기본교육", 40, "r1"), it("PROF-A6-1", "전문교육", 30, "r2")),
          J("P2", it("BASIC-A5-1", "기본교육", 10, "r1")),
          J("P3", it("BASIC-A5-1", "기본교육", 40, "r1"), it("PROF-A6-2", "전문교육", 50, "r2"))]
    res = compute_all([KIM, LEE, PARK], [parse_judgment(j) for j in js], RS)
    assert [r.met for r in res] == [True, False, True]
    ds = {d.dept: d for d in dept_summary(res)}
    assert ds["총무팀"].headcount == 2 and ds["총무팀"].met_count == 1 and ds["총무팀"].total_hours == D(80)
    assert ds["총무팀"].avg_hours == D(40) and ds["총무팀"].met_rate == D("50.0")
    assert ds["시설팀"].met_rate == D("100.0")


def test_person_without_judgment_has_zero_and_full_shortfall():
    res = compute_all([KIM], [], RS)
    assert res[0].total == D(0) and res[0].total_shortfall == D(70)


def test_parser_ruleset_end_to_end():
    """파서로 읽은 예시 지침 규칙으로도 같은 계산이 된다."""
    import datetime as dt
    from pathlib import Path

    from daisu.rulekit.parser import parse_text
    txt = (Path(__file__).parent / "fixtures" / "example_guideline_v2.txt").read_text(encoding="utf-8")
    rs = parse_text(txt, "[예시] 교육훈련 운영 지침", dt.date(2026, 1, 1)).ruleset()
    r = compute_person(KIM, parse_judgment(J("P1", it("SELF-A7-1", "자기개발", 50, "r1"), it("BASIC-A5-1", "기본교육", 45, "r2"))), rs)
    assert r.by_category[Category.SELF_DEV] == D(20) and r.by_category[Category.BASIC] == D(40)
    assert r.requirement_id is not None and r.shortfall[Category.PROFESSIONAL] == D(30)
    assert r.bonus_points == D("0.5")
