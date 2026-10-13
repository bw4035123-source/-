"""이수시간 인정 기준 Rule Schema(Pydantic v2).

규칙 하나 = "어떤 교육(분야)을, 누구에게, 어떤 근거로, 최대 몇 시간까지 인정하는가".

    Rule
      rule_id                 BASIC-A5-1 처럼 분야코드-조문-순번(대문자·숫자·하이픈)
      category                기본교육 · 전문교육 · 자기개발 · 가점
      legal_basis             법령명 + 조·항·호 + 시행일 + 원문(근거 표시용)
      eligibility_conditions  대상 조건 목록(모두 충족해야 적용) – 직렬·직급·고용형태·재직연수 등
      max_hours_cap           인정 상한(시간, 기간 단위: 연간·건당·일)
      credit_ratio            인정 비율(예: 2분의 1 → 0.5)
      bonus                   가점 규칙일 때 환산 기준(시간당 점수·최대 점수)

수치는 반드시 규정 원문에서 읽어야 하며, 이 파일에는 어떤 실제 수치도 들어 있지 않다.
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Category(str, Enum):
    BASIC = "기본교육"
    PROFESSIONAL = "전문교육"
    SELF_DEV = "자기개발"
    BONUS = "가점"

    @property
    def code(self) -> str:
        return {"기본교육": "BASIC", "전문교육": "PROF", "자기개발": "SELF", "가점": "BONUS"}[self.value]


class LegalBasis(BaseModel):
    model_config = ConfigDict(frozen=True)

    law_name: str = Field(min_length=1, description="법령·지침 이름(예: 지방공무원 평정규칙)")
    article: str = Field(pattern=r"^제\d+조(의\d+)?$", description="조(예: 제5조, 제10조의2)")
    paragraph: int | None = Field(default=None, ge=1, description="항 번호(①=1)")
    item: int | None = Field(default=None, ge=1, description="호 번호")
    effective_date: dt.date | None = Field(default=None, description="시행일(검색 시 최신 우선 가중치에 사용)")
    text: str = Field(default="", description="근거 원문(잘라서 보관)")

    def cite(self) -> str:
        """'지방공무원 평정규칙 제5조 제2항 제1호' 형태."""
        s = f"{self.law_name} {self.article}"
        if self.paragraph:
            s += f" 제{self.paragraph}항"
        if self.item:
            s += f" 제{self.item}호"
        return s


Field_ = Literal["series", "grade", "grade_level", "position", "employment", "tenure_years", "job"]
Op = Literal["eq", "ne", "in", "not_in", "gte", "lte", "contains"]


class Profile(BaseModel):
    """판정 대상 개인(대상 조건 검사에 쓰는 속성)."""

    person_id: str
    name: str = ""
    dept: str = ""
    series: str = Field(default="", description="직렬(예: 행정, 시설, 사회복지)")
    grade: str = Field(default="", description="직급(예: 7급, 6급, 5급)")
    position: str = Field(default="", description="직위(예: 팀장)")
    employment: str = Field(default="", description="고용형태(예: 정규, 임기제, 공무직)")
    job: str = Field(default="", description="직무 구분(예: 사무, 현장)")
    tenure_years: float = 0.0

    @property
    def grade_level(self) -> int | None:
        """'7급' → 7, '6급(갑)' → 6. 숫자가 작을수록 상위 직급."""
        m = re.search(r"(\d+)\s*급", self.grade)
        return int(m.group(1)) if m else None


class EligibilityCondition(BaseModel):
    model_config = ConfigDict(frozen=True)

    field: Field_
    op: Op
    value: Any
    text: str = Field(default="", description="조건 원문(예: 6급 이하)")

    @model_validator(mode="after")
    def _check(self):
        if self.op in ("in", "not_in") and not isinstance(self.value, (list, tuple)):
            raise ValueError("in/not_in 조건의 value 는 목록이어야 합니다.")
        if self.op in ("gte", "lte") and not isinstance(self.value, (int, float)):
            raise ValueError("gte/lte 조건의 value 는 숫자여야 합니다.")
        return self

    def check(self, p: Profile) -> bool:
        v = p.grade_level if self.field == "grade_level" else getattr(p, self.field)
        if v is None or v == "":
            return False  # 정보가 없으면 대상으로 보지 않는다(추측 금지)
        if self.op == "eq":
            return v == self.value
        if self.op == "ne":
            return v != self.value
        if self.op == "in":
            return v in self.value
        if self.op == "not_in":
            return v not in self.value
        if self.op == "gte":
            return float(v) >= float(self.value)
        if self.op == "lte":
            return float(v) <= float(self.value)
        if self.op == "contains":
            return str(self.value) in str(v)
        return False


class HoursCap(BaseModel):
    model_config = ConfigDict(frozen=True)

    hours: Decimal = Field(gt=0, description="상한 시간")
    per: Literal["year", "record", "day"] = Field(default="year", description="상한 단위: 연간·건당·일")
    text: str = ""


class BonusRule(BaseModel):
    """가점 환산: unit_hours 시간마다 points_per_unit 점, 최대 max_points 점."""

    model_config = ConfigDict(frozen=True)

    unit_hours: Decimal = Field(gt=0)
    points_per_unit: Decimal = Field(gt=0)
    max_points: Decimal | None = Field(default=None, gt=0)
    text: str = ""


class Rule(BaseModel):
    model_config = ConfigDict(frozen=True)

    rule_id: str = Field(pattern=r"^[A-Z]+(-[A-Z0-9]+)+$")
    category: Category
    title: str = Field(min_length=1)
    legal_basis: LegalBasis
    eligibility_conditions: list[EligibilityCondition] = Field(default_factory=list)
    max_hours_cap: HoursCap | None = None
    credit_ratio: Decimal = Field(default=Decimal(1), gt=0, le=1)
    bonus: BonusRule | None = None
    keywords: list[str] = Field(default_factory=list, description="과정명 매칭용 단어")

    @model_validator(mode="after")
    def _bonus_only_for_bonus(self):
        if self.bonus is not None and self.category != Category.BONUS:
            raise ValueError("bonus(가점 환산)는 category=가점 규칙에만 둘 수 있습니다.")
        return self

    def applies_to(self, p: Profile) -> bool:
        return all(c.check(p) for c in self.eligibility_conditions)


class Requirement(BaseModel):
    """직렬·직급별 의무 이수시간(분야별·합계). 조건이 더 구체적인 것이 우선 적용된다."""

    requirement_id: str
    conditions: list[EligibilityCondition] = Field(default_factory=list)
    required_hours: dict[Category, Decimal] = Field(default_factory=dict)
    total_required: Decimal | None = Field(default=None, ge=0)
    legal_basis: LegalBasis | None = None

    @field_validator("required_hours")
    @classmethod
    def _non_negative(cls, v):
        if any(x < 0 for x in v.values()):
            raise ValueError("의무 시간은 0 이상이어야 합니다.")
        return v

    def applies_to(self, p: Profile) -> bool:
        return all(c.check(p) for c in self.conditions)


class RuleSet(BaseModel):
    version: str = "1"
    effective_date: dt.date | None = None
    rules: list[Rule] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self):
        ids = [r.rule_id for r in self.rules]
        dup = {x for x in ids if ids.count(x) > 1}
        if dup:
            raise ValueError(f"rule_id 중복: {sorted(dup)}")
        return self

    def get(self, rule_id: str) -> Rule | None:
        return next((r for r in self.rules if r.rule_id == rule_id), None)

    def requirement_for(self, p: Profile) -> Requirement | None:
        """조건을 모두 충족하는 것 가운데 조건 수가 가장 많은(가장 구체적인) 의무 기준."""
        cands = [r for r in self.requirements if r.applies_to(p)]
        return max(cands, key=lambda r: len(r.conditions)) if cands else None
