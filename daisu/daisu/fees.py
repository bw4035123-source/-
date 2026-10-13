"""강사료·원천징수 계산.

지급 기준(등급별 1시간·추가 1시간 금액, 원고료)은 기관마다 달라 settings.json 의 "fees" 에서 고친다.
세금 계산(기본값, 설정에서 변경 가능)
  - 기타소득(일시적 강연): 필요경비 60% 공제 → 기타소득금액의 20% 소득세 + 소득세의 10% 지방소득세(실효 8.8%)
    기타소득금액이 건별 5만원 이하이면 과세하지 않음(과세최저한)
  - 사업소득(강의가 직업인 강사): 지급액의 3% + 지방소득세 0.3%
  - 내부 직원: 근로소득에 합산(여기서는 원천징수하지 않음)
  - 국고금 관리 관행에 따라 세액의 10원 미만은 버림
"""
from __future__ import annotations

import math


def _floor10(x: float) -> int:
    return int(math.floor(x / 10) * 10)


def compute(inst: dict, hours: float, cfg: dict) -> dict:
    tiers = {t["grade"]: t for t in cfg.get("tiers", [])}
    # 등급을 고르지 않았거나 등급표에 없는 값이면 금액을 0으로 두고 '등급 확인 필요'로 알린다(최고 등급으로 과지급 방지)
    tier = tiers.get(inst.get("grade"))
    missing = tier is None
    if missing:
        tier = {"grade": "", "desc": "", "first": 0, "extra": 0}
    hours = max(0.0, float(hours or 0))
    first = tier["first"] if hours > 0 else 0
    extra_h = max(0.0, hours - 1)
    extra = round(tier["extra"] * extra_h)
    pages = max(0, int(inst.get("pages") or 0))
    manuscript = pages * int(cfg.get("manuscript_per_page", 0))
    travel = max(0, int(inst.get("travel") or 0))  # 교통비 실비: 과세 대상에서 제외
    lecture = first + extra + manuscript
    kind = inst.get("income") or "기타소득"
    tax = cfg.get("tax", {})
    steps = [f"강사 등급을 고르세요{' (등급표에 없는 값: ' + str(inst.get('grade')) + ')' if inst.get('grade') else ''} – 등급을 정하기 전에는 강의료를 0원으로 둡니다"
             if missing else "",
             f"강의료: 첫 1시간 {first:,}원" + (f" + 추가 {extra_h:g}시간 × {tier['extra']:,}원 = {first + extra:,}원" if extra_h else ""),
             f"원고료: {pages}매 × {int(cfg.get('manuscript_per_page', 0)):,}원 = {manuscript:,}원" if pages else "",
             f"교통비(실비, 비과세): {travel:,}원" if travel else ""]
    income_tax = local_tax = 0
    taxable = 0
    if kind == "기타소득":
        expense = float(tax.get("other_expense_rate", 0.6))
        taxable = lecture - _floor10(lecture * expense)
        if taxable > int(tax.get("other_min_income", 50000)):
            income_tax = _floor10(taxable * float(tax.get("other_rate", 0.2)))
            local_tax = _floor10(income_tax * 0.1)
            steps.append(f"기타소득금액: {lecture:,}원 − 필요경비 {expense:.0%} = {taxable:,}원 → 소득세 {income_tax:,}원(20%), 지방소득세 {local_tax:,}원")
        else:
            steps.append(f"기타소득금액 {taxable:,}원이 5만원 이하라 과세하지 않음(과세최저한)")
    elif kind == "사업소득":
        income_tax = _floor10(lecture * float(tax.get("business_rate", 0.03)))
        local_tax = _floor10(income_tax * 0.1)
        steps.append(f"사업소득: {lecture:,}원 × 3% = 소득세 {income_tax:,}원, 지방소득세 {local_tax:,}원")
    else:
        steps.append("내부 직원: 근로소득에 합산(이 단계에서 원천징수 없음)")
    withholding = income_tax + local_tax
    return {"grade": tier["grade"], "grade_missing": missing, "grade_desc": tier.get("desc", ""), "hours": hours, "first": first, "extra": extra,
            "manuscript": manuscript, "travel": travel, "lecture": lecture, "income": kind, "taxable": taxable,
            "income_tax": income_tax, "local_tax": local_tax, "withholding": withholding,
            "total": lecture + travel, "net": lecture + travel - withholding, "steps": [s for s in steps if s]}
