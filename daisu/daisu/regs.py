"""규정 해석: 교육훈련규정·여비규정·강사수당 기준·경영평가 편람·정부 교육 계획 문서에서 계산 기준을 읽어 낸다.

문서를 넣기만 하면
  - 연간 교육시간 목표, 결과보고 기한, 교육비 지원 한도, 직급·대상별 필수교육(표)
  - 여비 지급표(직급군별 일비·식비·숙박비 상한)와 교육여비 특례(숙박 제공 시 미지급, 일비 감액)
  - 강사수당 등급표(기본·초과), 원고료
  - 경영평가 교육훈련 지표(지표명·산식·배점)
  - 정부 권고 목표(1인당 연간 교육시간 등)와 중점 과제
를 뽑고, 값마다 근거(파일·위치·원문)를 붙인다. 판정·계산은 이 기준으로 하며, 문서가 없으면 설정값을 쓴다.
"""
from __future__ import annotations

import os
import re

from .util import hours_in, num

DOC_KINDS = [
    ("fee", lambda t: "강사" in t and ("수당" in t or "강사료" in t)),
    ("travel", lambda t: "여비" in t and "교육훈련규정" not in t),
    ("eval", lambda t: "경영평가" in t or "편람" in t),
    ("gov", lambda t: "행정안전부" in t or "행안부" in t),
    ("training", lambda t: "교육" in t and any(k in t for k in ("규정", "규칙", "지침", "내규"))),
]
DOC_LABEL = {"fee": "강사수당 기준", "travel": "여비규정", "eval": "경영평가 편람", "gov": "정부 교육 계획", "training": "교육훈련 내규",
             "budget": "교육 예산"}


def doc_kind(rel: str, texts: list[dict]) -> str | None:
    """파일 이름으로 먼저 판단하고(본문에 '경영평가에 활용' 같은 말이 섞여 있어도 흔들리지 않게), 없으면 제목 줄로."""
    for head in (os.path.basename(rel), " ".join(t["text"] for t in texts[:2])[:200]):
        for k, fn in DOC_KINDS:
            if fn(head):
                return k
    return None


def money(s) -> int | None:
    s = str(s or "").replace(" ", "")
    if not s or "실비" in s:
        return None
    f = lambda x: float(x.replace(",", ""))  # noqa: E731
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)만(?:(\d[\d,]*)천)?원?", s)  # 100만원, 2만5천원
    if m:
        return int(f(m.group(1)) * 10000 + (f(m.group(2)) * 1000 if m.group(2) else 0))
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)천원", s)
    if m:
        return int(f(m.group(1)) * 1000)
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)원", s)  # '1일 25,000원' → 원 바로 앞 숫자
    if not m:
        m = re.search(r"(\d[\d,]*(?:\.\d+)?)", s)
    if not m:
        return None
    return int(f(m.group(1)))


def _src(file, where, text):
    return {"file": file, "where": where, "text": str(text)[:300]}


def _col(head, *keys):
    for j, h in enumerate(head):
        hh = h.replace(" ", "")
        if any(k in hh for k in keys):
            return j
    return None


def _rows(t):
    """머리글 행(가장 많이 채워진 앞쪽 행) 찾기."""
    rows = t["rows"]
    width = max((sum(1 for c in r if c) for r in rows), default=0)
    for i, r in enumerate(rows[:5]):
        if sum(1 for c in r if c) >= max(2, width - 1):
            return i, r, rows[i + 1:]
    return 0, rows[0] if rows else [], rows[1:]


def _months(text: str) -> int | None:
    """'임용 후 3개월 이내' → 3(달력 기준 개월 수). 개월 표기가 없으면 None."""
    m = re.search(r"(\d+)\s*개월", text or "")
    return int(m.group(1)) if m else None


def _days(text: str, default: int) -> int:
    m = re.search(r"(\d+)\s*(개월|일|주)", text or "")
    if not m:
        return default
    n = int(m.group(1))
    return n * 30 if m.group(2) == "개월" else n * 7 if m.group(2) == "주" else n


def extract(docs: list[dict]) -> dict:
    """docs: [{rel, texts:[{text, where}], tables:[{rows, where, before}], budget}]"""
    out = {"docs": [], "fee": None, "travel": None, "training": {}, "required": [], "kpis": [], "gov": {}, "budget": None, "items": []}

    def item(group, label, value, src, applied=True):
        out["items"].append({"group": group, "label": label, "value": value, "src": src, "applied": applied})

    for d in docs:
        if d.get("budget"):
            b = d["budget"]
            out["budget"] = b
            out["docs"].append({"file": d["rel"], "kind": "budget", "label": DOC_LABEL["budget"]})
            item("예산", "교육훈련 예산 합계", f"{b['total']:,}원", _src(d["rel"], "합계", ", ".join(f"{x['name']} {x['amount']:,}원" for x in b["items"])))
            continue
        k = doc_kind(d["rel"], d["texts"])
        if not k:
            continue
        out["docs"].append({"file": d["rel"], "kind": k, "label": DOC_LABEL[k]})
        text_all = [(t["text"], t["where"]) for t in d["texts"]]

        if k == "fee":
            for t in d["tables"]:
                hi, head, body = _rows(t)
                jf, je = _col(head, "기본", "1시간"), _col(head, "초과", "추가")
                if jf is None or je is None:
                    continue
                jd = _col(head, "대상", "설명")
                tiers = []
                for i, r in enumerate(body, hi + 2):
                    if not r or not r[0] or money(r[jf]) is None:
                        continue
                    tiers.append({"grade": r[0].strip(), "desc": r[jd] if jd is not None and jd < len(r) else "", "first": money(r[jf]),
                                  "extra": money(r[je]) or 0, "src": _src(d["rel"], f"{t['where']} {i}행", " / ".join(r))})
                if tiers:
                    out["fee"] = {"tiers": tiers, "manuscript_per_page": None, "file": d["rel"]}
                    item("강사수당", "강사 등급", f"{len(tiers)}개 등급(" + ", ".join(f"{x['grade']} {x['first']:,}원" for x in tiers) + ")",
                         _src(d["rel"], t["where"], " / ".join(head)))
            for txt, w in text_all:
                m = re.search(r"원고료.*?(\d[\d,]{2,})\s*원", txt)
                if m and out["fee"]:
                    out["fee"]["manuscript_per_page"] = money(m.group(1))
                    item("강사수당", "원고료(1매당)", f"{money(m.group(1)):,}원", _src(d["rel"], w, txt))

        elif k == "travel":
            for t in d["tables"]:
                hi, head, body = _rows(t)
                jd, jm, jl = _col(head, "일비"), _col(head, "식비"), _col(head, "숙박")
                if jd is None or jm is None:
                    continue
                groups = []
                for i, r in enumerate(body, hi + 2):
                    if not r or not r[0]:
                        continue
                    label = r[0]
                    lo, hi_g = 0, 99
                    m = re.search(r"(\d+)\s*급?\s*[~∼\-]\s*(\d+)\s*급", label)
                    if m:
                        lo, hi_g = int(m.group(1)), int(m.group(2))
                    elif re.search(r"(\d+)\s*급\s*이하", label):
                        lo = int(re.search(r"(\d+)\s*급\s*이하", label).group(1))
                    elif re.search(r"(\d+)\s*급\s*이상", label):
                        hi_g = int(re.search(r"(\d+)\s*급\s*이상", label).group(1))
                    exec_ = "임원" in label
                    groups.append({"label": label, "lo": 0 if exec_ else lo, "hi": 0 if exec_ else hi_g, "exec": exec_,
                                   "daily": money(r[jd]) or 0, "meal": money(r[jm]) or 0,
                                   "lodging": money(r[jl]) if jl is not None and jl < len(r) else None,
                                   "src": _src(d["rel"], f"{t['where']} {i}행", " / ".join(r))})
                if groups:
                    out["travel"] = {"groups": groups, "file": d["rel"], "daily_ratio": 1.0, "no_lodging_if_provided": False, "rules_src": []}
                    for g in groups:
                        item("여비", g["label"], f"일비 {g['daily']:,} · 식비 {g['meal']:,} · 숙박 상한 {g['lodging'] or 0:,}원", g["src"])

        elif k == "training":
            for txt, w in text_all:
                m = re.search(r"연간\s*(\d+)\s*시간\s*이상", txt)
                if m and "annual_hours" not in out["training"]:
                    out["training"]["annual_hours"] = {"value": int(m.group(1)), "src": _src(d["rel"], w, txt)}
                    item("교육훈련 내규", "1인당 연간 교육시간 목표", f"{m.group(1)}시간 이상", _src(d["rel"], w, txt))
                m = re.search(r"(?:수료|종료)\s*후\s*(\d+)\s*일\s*이내[^.]*결과\s*보고", txt)
                if m:
                    out["training"]["report_days"] = {"value": int(m.group(1)), "src": _src(d["rel"], w, txt)}
                    item("교육훈련 내규", "위탁교육 결과보고 기한", f"수료 후 {m.group(1)}일 이내", _src(d["rel"], w, txt))
                m = re.search(r"(?:1인당|직원\s*1명당)\s*연간?\s*([\d,]+\s*(?:만\s*원|원))\s*한도", txt)
                if m:
                    out["training"]["support_limit"] = {"value": money(m.group(1)), "src": _src(d["rel"], w, txt)}
                    item("교육훈련 내규", "1인당 위탁교육비 지원 한도", f"연 {money(m.group(1)):,}원", _src(d["rel"], w, txt))
                if "여비" in txt:
                    if re.search(r"숙박을\s*제공하는\s*경우\s*숙박비[^.]*(?:지급하지|미지급)", txt):
                        out["training"]["no_lodging_if_provided"] = _src(d["rel"], w, txt)
                        item("교육여비", "숙박 제공 시 숙박비", "지급하지 않음", _src(d["rel"], w, txt))
                    m = re.search(r"일비는\s*(\d+)\s*분의\s*(\d+)", txt)
                    if m:
                        out["training"]["daily_ratio"] = {"value": int(m.group(2)) / int(m.group(1)), "src": _src(d["rel"], w, txt)}
                        item("교육여비", "교육기간 중 일비", f"{m.group(2)}/{m.group(1)} 지급", _src(d["rel"], w, txt))
            for t in d["tables"]:
                hi, head, body = _rows(t)
                jc, jt, jh = _col(head, "과정", "교육명"), _col(head, "대상"), _col(head, "시간")
                if jc is None or jt is None or jh is None:
                    continue
                jw = _col(head, "시기", "기한")
                for i, r in enumerate(body, hi + 2):
                    if not r or not r[jc]:
                        continue
                    out["required"].append({"name": r[jc].strip(), "target": r[jt], "hours": num(r[jh]) or hours_in(r[jh]) or num((re.search(r"\d+(?:\.\d+)?", r[jh] or "") or [""])[0]) or 0,
                                            "when": r[jw] if jw is not None and jw < len(r) else "",
                                            "src": _src(d["rel"], f"{t['where']} {i}행", " / ".join(r))})
                    item("필수교육", r[jc].strip(), f"{r[jt]} · {r[jh]}시간 · {r[jw] if jw is not None else ''}", out["required"][-1]["src"])

        elif k == "eval":
            for t in d["tables"]:
                hi, head, body = _rows(t)
                jn, jf = _col(head, "지표"), _col(head, "산식", "산출")
                if jn is None or jf is None:
                    continue
                jw = _col(head, "배점", "가중")
                for i, r in enumerate(body, hi + 2):
                    if not r or not r[jn]:
                        continue
                    out["kpis"].append({"name": r[jn].strip(), "formula": r[jf], "weight": num(r[jw]) if jw is not None and jw < len(r) else None,
                                        "src": _src(d["rel"], f"{t['where']} {i}행", " / ".join(r))})
                    item("경영평가 지표", r[jn].strip(), r[jf], out["kpis"][-1]["src"])
            for txt, w in text_all:
                if txt.startswith("증빙"):
                    out["gov"].setdefault("evidence", _src(d["rel"], w, txt))

        elif k == "gov":
            lines = [(ln.strip(), w) for txt, w in text_all for ln in txt.splitlines() if ln.strip()]
            for ln, w in lines:
                m = re.search(r"1인당\s*(?:연간\s*)?(\d+)\s*시간", ln)
                if m and "rec_hours" not in out["gov"]:
                    out["gov"]["rec_hours"] = {"value": int(m.group(1)), "src": _src(d["rel"], w, ln)}
                    item("정부 계획", "1인당 연간 교육시간 권장", f"{m.group(1)}시간 이상", _src(d["rel"], w, ln))
            pri, on = [], False
            for ln, w in lines:
                if "중점" in ln:
                    on = True
                    continue
                if on and re.match(r"^\d+\.", ln):
                    on = False
                if on and re.match(r"^[가-하]\.", ln):
                    pri.append({"text": re.sub(r"^[가-하]\.\s*", "", ln), "src": _src(d["rel"], w, ln)})
            if pri:
                out["gov"]["priorities"] = pri
                item("정부 계획", "중점 과제", " / ".join(p["text"] for p in pri), pri[0]["src"])

    # 교육여비 특례를 여비 지급표에 반영
    if out["travel"]:
        tr = out["training"]
        if tr.get("daily_ratio"):
            out["travel"]["daily_ratio"] = tr["daily_ratio"]["value"]
            out["travel"]["rules_src"].append(tr["daily_ratio"]["src"])
        if tr.get("no_lodging_if_provided"):
            out["travel"]["no_lodging_if_provided"] = True
            out["travel"]["rules_src"].append(tr["no_lodging_if_provided"])
    return out


# ───────────── 필수교육 표 → 판정 규칙(교육 규칙표와 같은 모양)
def required_rules(regs: dict) -> list[dict]:
    rules = []
    for i, r in enumerate(regs.get("required", []), 1):
        tgt_text = r["target"]
        rule = {"id": f"req{i}", "name": r["name"], "group": "필수", "law": f"{os.path.basename(r['src']['file'])} {r['src']['where']}",
                "hours": r["hours"] or 1, "mandatory": True, "category": "필수", "keywords": [r["name"], re.sub(r"\s*(과정|교육)$", "", r["name"])],
                "target": {}, "cycle": "year", "due": "12-31", "note": f"대상: {tgt_text} · 시기: {r['when']}", "src": r["src"]}
        if "신규" in tgt_text:
            rule.update(cycle="hire", due_days=_days(r["when"], 90), due_months=_months(r["when"]), target={"hired_this_year": True})
        elif "승진" in tgt_text:
            rule.update(cycle="promo", due_days=_days(r["when"], 180), due_months=_months(r["when"]), target={"promoted_this_year": True})
        else:
            if "현장" in tgt_text:
                rule["target"]["job"] = "현장"
            elif "사무" in tgt_text or "행정" in tgt_text:
                rule["target"]["job"] = "사무"
            m = re.search(r"(팀장|부장|파트장|관리자|감독자)", tgt_text)
            if m:
                rule["target"]["title_has"] = "장" if m.group(1) == "관리자" else m.group(1)
        rules.append(rule)
    return rules


def grade_num(grade: str) -> int | None:
    m = re.search(r"(\d+)", grade or "")
    return int(m.group(1)) if m else None


def travel_group(regs: dict, grade: str, title: str = "") -> dict | None:
    tr = regs.get("travel")
    if not tr:
        return None
    if any(k in (title or "") for k in ("이사장", "본부장", "상임이사", "임원")):
        g = next((x for x in tr["groups"] if x["exec"]), None)
        if g:
            return g
    n = grade_num(grade)
    if n is not None:
        for g in tr["groups"]:
            if not g["exec"] and g["lo"] <= n <= g["hi"]:
                return g
    return tr["groups"][-1]
