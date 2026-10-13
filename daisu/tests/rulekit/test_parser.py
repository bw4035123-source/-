"""규칙 스키마·규정 파서 테스트(예시 지침은 시험용 가상 문서)."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal as D
from pathlib import Path

import pytest
from pydantic import ValidationError

from daisu.rulekit.parser import cap, conditions, parse_table, parse_text, ratio
from daisu.rulekit.schema import BonusRule, Category, EligibilityCondition, HoursCap, LegalBasis, Profile, Rule, RuleSet

FIX = Path(__file__).parent / "fixtures"
LAW = "[예시] 교육훈련 운영 지침"


@pytest.fixture(scope="module")
def parsed():
    return parse_text((FIX / "example_guideline_v2.txt").read_text(encoding="utf-8"), LAW, dt.date(2026, 1, 1))


class TestSchema:
    LB = LegalBasis(law_name="지침", article="제5조", paragraph=2, item=1)

    def test_cite(self):
        assert self.LB.cite() == "지침 제5조 제2항 제1호"

    @pytest.mark.parametrize("bad", ["basic-1", "BASIC", "BASIC_1", "기본-1"])
    def test_rule_id_pattern(self, bad):
        with pytest.raises(ValidationError):
            Rule(rule_id=bad, category=Category.BASIC, title="t", legal_basis=self.LB)

    def test_bonus_only_on_bonus_category(self):
        with pytest.raises(ValidationError):
            Rule(rule_id="BASIC-A1-1", category=Category.BASIC, title="t", legal_basis=self.LB,
                 bonus=BonusRule(unit_hours=D(10), points_per_unit=D("0.1")))

    def test_cap_must_be_positive_and_ratio_in_range(self):
        with pytest.raises(ValidationError):
            HoursCap(hours=D(0))
        with pytest.raises(ValidationError):
            Rule(rule_id="SELF-A1-1", category=Category.SELF_DEV, title="t", legal_basis=self.LB, credit_ratio=D("1.5"))

    def test_article_format(self):
        with pytest.raises(ValidationError):
            LegalBasis(law_name="지침", article="5조")

    def test_duplicate_rule_ids(self):
        r = Rule(rule_id="BASIC-A1-1", category=Category.BASIC, title="t", legal_basis=self.LB)
        with pytest.raises(ValidationError):
            RuleSet(rules=[r, r])

    def test_conditions(self):
        p = Profile(person_id="1", grade="7급", series="시설")
        assert EligibilityCondition(field="grade_level", op="gte", value=6).check(p)  # 6급 이하
        assert not EligibilityCondition(field="grade_level", op="lte", value=5).check(p)
        assert EligibilityCondition(field="series", op="in", value=["시설", "환경"]).check(p)
        assert not EligibilityCondition(field="position", op="contains", value="팀장").check(p)  # 정보 없음 → 대상 아님
        with pytest.raises(ValidationError):
            EligibilityCondition(field="series", op="in", value="시설")


class TestPieces:
    @pytest.mark.parametrize("text,hours,per", [("연간 40시간까지 인정한다", "40", "year"), ("1회 8시간을 한도로", "8", "record"),
                                                ("1과정당 최대 35시간까지", "35", "record"), ("1일 2시간을 한도로", "2", "day"),
                                                ("연간 20시간을 초과할 수 없다", "20", "year")])
    def test_cap(self, text, hours, per):
        c = cap(text)
        assert c.hours == D(hours) and c.per == per

    def test_cap_requirement_is_not_cap(self):
        assert cap("기본교육을 연간 40시간 이상 이수하여야 한다") is None

    @pytest.mark.parametrize("text,val", [("2분의 1을 인정", "0.5"), ("3분의 1을 인정", None), ("50% 인정", "0.5")])
    def test_ratio(self, text, val):
        r = ratio(text)
        if val is None:
            assert r == D(1) / D(3)
        else:
            assert r == D(val)

    def test_conditions_text(self):
        cs = {(c.field, c.op): c.value for c in conditions("시설직렬 및 환경직렬 6급 이하 공무원, 재직 3년 이상")}
        assert cs[("grade_level", "gte")] == 6 and sorted(cs[("series", "in")]) == ["시설", "환경"] and cs[("tenure_years", "gte")] == 3.0


class TestDocument:
    def test_rules_found_with_legal_basis(self, parsed):
        ids = [r.rule_id for r in parsed.rules]
        assert ids == ["BASIC-A5-1", "BASIC-A5-2", "PROF-A6-1", "PROF-A6-2", "SELF-A7-1", "SELF-A7-2", "BONUS-A9-1"]
        r = next(x for x in parsed.rules if x.rule_id == "SELF-A7-1")
        assert r.credit_ratio == D("0.5") and r.max_hours_cap.hours == D(20)
        assert r.legal_basis.cite() == f"{LAW} 제7조 제1항" and r.legal_basis.effective_date == dt.date(2026, 1, 1)
        assert "2분의 1" in r.legal_basis.text

    def test_bonus_and_requirements(self, parsed):
        b = next(x for x in parsed.rules if x.category == Category.BONUS).bonus
        assert (b.unit_hours, b.points_per_unit, b.max_points) == (D(10), D("0.1"), D("0.5"))
        low, high = parsed.requirements
        assert low.required_hours == {Category.BASIC: D(40), Category.PROFESSIONAL: D(30)}
        assert high.total_required == D(60)

    def test_unparsed_reported(self, parsed):
        assert any("제9조" in u for u in parsed.unparsed)

    def test_table(self):
        rows = [["구분", "인정 기준", "대상"], ["기본교육", "연간 40시간까지 인정", "6급 이하"], ["자기개발", "이수시간의 2분의 1, 연간 20시간을 초과할 수 없음", ""]]
        res = parse_table(rows, LAW, "표 1")
        assert [r.category for r in res.rules] == [Category.BASIC, Category.SELF_DEV]
        assert res.rules[0].eligibility_conditions[0].value == 6 and "표 1 2행" in res.rules[0].legal_basis.text

    def test_ruleset_roundtrip_json(self, parsed):
        rs = parsed.ruleset(version="2026", effective_date=dt.date(2026, 1, 1))
        again = RuleSet.model_validate_json(rs.model_dump_json())
        assert again == rs
