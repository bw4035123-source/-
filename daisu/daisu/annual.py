"""연간 보고서 작성: 교육훈련 종합 실적 보고서, 경영평가 교육훈련 지표 실적 보고서, 규정 해석 기준표.

모든 숫자는 kpi.py·costs.py 의 계산 결과에서, 모든 기준은 regs.py 가 규정 문서에서 읽은 값(근거 표기)에서 가져온다.
"""
from __future__ import annotations

import datetime as dt
import os
import re

from .kpi import CATS
from .util import dept_core, due_label, fmt_h, kdate

CAT_LABEL = {"법정": "법정의무교육", "필수": "필수교육(내규)", "직무": "직무·역량교육", "외부": "외부(위탁)교육"}


def _cite(src) -> str:
    return f"{os.path.basename(src['file'])} {src['where']}" if src else ""


def _won(v) -> str:
    return f"{v:,}원" if v is not None else "-"


def _val(k) -> str:
    if k["value"] is None:
        return "자료 필요"
    return f"{k['value']:,}{k['unit']}" if isinstance(k["value"], int) else f"{k['value']}{k['unit']}"


def priorities_check(res: dict, k: dict) -> list[str]:
    """정부 중점 과제와 올해 실적을 맞대어 본다(키워드 기준, 근거 과정명을 함께 적음)."""
    out = []
    pri = (res.get("regs") or {}).get("gov", {}).get("priorities") or []
    titles = [(r["title"], r.get("pid")) for r in res["records"] if r["done"] and r.get("pid")]
    for p in pri:
        topics = {"AI": ["AI", "인공지능", "디지털", "데이터"], "디지털": ["AI", "인공지능", "디지털", "데이터"], "안전": ["안전"],
                  "청렴": ["청렴", "반부패"], "리더십": ["리더십", "관리자"], "민원": ["민원", "고객", "CS"], "인권": ["인권"]}
        kws = sorted({w for key, ws in topics.items() if key in p["text"] for w in ws})
        if not kws:
            kws = [w for w in re.findall(r"[가-힣A-Za-z]{2,}", p["text"]) if w not in ("확대", "강화", "측정", "환류", "맞춤형", "근무자", "교육", "역량교육")][:2]
        hit = sorted({t for t, _ in titles if any(w in t for w in kws)})
        people = {pid for t, pid in titles if t in hit}
        if "만족도" in p["text"]:
            sat = k["satisfaction"]
            out.append(f"{p['text']} → 만족도 조사 {sat['n']}건, 평균 {sat['avg']}점" if sat["avg"] else f"{p['text']} → 만족도 자료 없음(보완 필요)")
        elif hit:
            out.append(f"{p['text']} → 관련 과정 {len(hit)}개({', '.join(re.sub(r'\\(.*?\\)', '', h) for h in hit[:3])}{' 외' if len(hit) > 3 else ''}), 이수 {len(people)}명")
        else:
            out.append(f"{p['text']} → 올해 관련 과정 없음(내년 계획에 반영 필요)")
    return out


def annual_blocks(res: dict, k: dict, ex: dict, org: dict) -> list:
    regs = res.get("regs") or {}
    base = dt.date.fromisoformat(res["base"])
    tr = regs.get("training", {})
    B = [("title", f"{res['year']}년 교육훈련 실적 보고"),
         ("p", f"기준일 {kdate(base)} · {org.get('name', '')} {org.get('dept', '')} · 재직 {k['people']}명"),
         ("h1", "1. 총괄")]
    rows = [["총 교육훈련시간", f"{k['total_hours']:,}시간", ""], ["1인당 교육훈련시간", f"{k['per_capita']}시간", ""]]
    if k["target_hours"]:
        rows.append(["내규 목표(1인당 연간)", f"{k['target_hours']}시간", _cite(tr["annual_hours"]["src"])])
        rows.append(["목표 달성률", f"{round(100 * k['per_capita'] / k['target_hours'], 1)}%", f"목표 미달 {len(k['below'])}명(기준일 현재)"])
    if k["gov_hours"]:
        rows.append(["정부 권장(1인당 연간)", f"{k['gov_hours']}시간", _cite(regs['gov']['rec_hours']['src'])])
    rows.append(["교육훈련비 집행", _won(k["spend"]["total"]), f"예산 {_won(k['budget'])} 대비 {round(100 * k['spend']['total'] / k['budget'], 1)}%" if k["budget"] else "예산 자료 없음"])
    B.append(("table", ["구분", "실적", "비고·근거"], rows, [2, 1.5, 4]))
    if k["target_hours"] and k["gov_hours"] and k["target_hours"] < k["gov_hours"]:
        B.append(("note", f"※ 내규 목표({k['target_hours']}시간)가 정부 권장({k['gov_hours']}시간)보다 낮습니다. 내규 개정 검토가 필요합니다."))

    B.append(("h1", "2. 분야별 실적"))
    cnt = {c: len(k["hours"]["courses"][c]) for c in CATS}
    B.append(("table", ["분야", "과정 수", "교육시간", "1인당", "비중"],
              [[CAT_LABEL[c], str(cnt[c]), f"{k['totals'][c]:,}시간", f"{round(k['totals'][c] / max(1, k['people']), 1)}시간",
                f"{round(100 * k['totals'][c] / max(1, k['total_hours']), 1)}%"] for c in CATS]
              + [["합계", str(sum(cnt.values())), f"{k['total_hours']:,}시간", f"{k['per_capita']}시간", "100%"]], [3, 1, 1.5, 1.2, 1]))

    B.append(("h1", "3. 법정의무교육"))
    B.append(("p", f"이수율 {k['legal']['rate']}%(이수 연인원 {k['legal']['done']:,}명 ÷ 대상 연인원 {k['legal']['target']:,}명)"))
    B.append(("table", ["교육", "대상", "이수", "이수율", "기한", "기한 지남"],
              [[s["label"], str(s["target"]), str(s["done"]), f"{s['rate']}%" if s["rate"] is not None else "-",
                kdate(dt.date.fromisoformat(s["due"]), False) if s["due"] else due_label(s), f"{s['overdue']}명" if s["overdue"] else "-"]
               for s in res["summary"] if s.get("category") == "법정"], [4, 1, 1, 1, 1.6, 1.2]))

    req = [s for s in res["summary"] if s.get("category") == "필수"]
    if req:
        B.append(("h1", "4. 필수교육(내규 별표)"))
        B.append(("p", f"이수율 {k['required']['rate']}%(이수 연인원 {k['required']['done']}명 ÷ 대상 연인원 {k['required']['target']}명)"))
        B.append(("table", ["과정", "대상·시기", "대상 인원", "이수", "기한 지남"],
                  [[s["label"], s.get("note", "").replace("대상: ", ""), str(s["target"]), str(s["done"]), f"{s['overdue']}명" if s["overdue"] else "-"] for s in req],
                  [3, 4, 1, 1, 1]))

    B.append(("h1", "5. 외부(위탁)교육"))
    B.append(("p", f"{len(ex['rows'])}건 · {fmt_h(ex['hours'])}시간 · 교육비 {_won(ex['total_cost'])} · 여비(규정 산정, 교통비 제외) {_won(ex['total_travel'])}"))
    if ex["report_days"] is not None:
        B.append(("bullet", f"결과보고(수료 후 {ex['report_days']}일 이내): 지연 제출 {len(ex['late'])}건, 미제출 {len(ex['missing'])}건"
                  + (" – " + ", ".join(f"{x['name']}({x['title']})" for x in ex["missing"]) if ex["missing"] else "")))
    if ex["over_limit"]:
        B.append(("bullet", "1인당 지원 한도 초과: " + ", ".join(f"{o['name']}({o['dept']}) {o['cost']:,}원 / 한도 {o['limit']:,}원" for o in ex["over_limit"])))

    B.append(("h1", "6. 교육훈련비 집행"))
    bud = regs.get("budget") or {}
    sp = k["spend"]
    rows = []
    for it in bud.get("items", []):
        n = it["name"]
        use = sp["external"] if "외부" in n or "위탁" in n else sp["travel"] if "여비" in n else None
        rows.append([n, _won(it["amount"]), _won(use) if use is not None else "(강사료·교재 – 집합교육 회차에서 집계)",
                     f"{round(100 * use / it['amount'], 1)}%" if use is not None and it["amount"] else "-"])
    rows.append(["합계", _won(bud.get("total")), _won(sp["total"]), f"{round(100 * sp['total'] / bud['total'], 1)}%" if bud.get("total") else "-"])
    B.append(("table", ["항목", "예산", "집행", "집행률"], rows, [3, 1.5, 2.5, 1]))

    B.append(("h1", "7. 경영평가 교육훈련 지표"))
    B.append(("table", ["지표", "산식", "실적", "산출 근거"], [[x["name"], x["formula"], _val(x), x["basis"]] for x in k["kpis"]], [2, 3, 1, 5]))

    B.append(("h1", "8. 평가 및 개선 방향"))
    issues = []
    if k["target_hours"] and k["below"]:
        by: dict[str, int] = {}
        for p in k["below"]:
            by[p["dept"]] = by.get(p["dept"], 0) + 1
        issues.append(f"1인당 목표({k['target_hours']}시간) 미달 {len(k['below'])}명 – " + ", ".join(f"{dept_core(d)} {n}명" for d, n in sorted(by.items(), key=lambda x: -x[1])))
    for s in res["summary"]:
        if s["overdue"]:
            issues.append(f"{s['label']} 기한 지난 미이수 {s['overdue']}명 – 보충 교육·사유 확인")
    if ex["missing"] or ex["late"]:
        issues.append(f"위탁교육 결과보고 지연·미제출 {len(ex['late']) + len(ex['missing'])}건 – 제출 독려, 교육 신청 시 기한 안내")
    for x in issues or ["특이사항 없음"]:
        B.append(("bullet", x))
    pri = priorities_check(res, k)
    if pri:
        B.append(("h2", "정부 중점 과제 대비"))
        for x in pri:
            B.append(("bullet", x))
    docs = regs.get("docs", [])
    B.append(("note", "※ 적용 기준: " + (", ".join(f"{d['label']}({os.path.basename(d['file'])})" for d in docs) if docs else "설정값")
              + ". 다이수가 넣은 자료와 규정을 근거로 작성했으며, 세부 근거는 ‘규정 해석 기준표’와 실적 엑셀에 있습니다."))
    return B


def kpi_blocks(res: dict, k: dict, org: dict) -> list:
    regs = res.get("regs") or {}
    B = [("title", f"{res['year']}년 경영평가 교육훈련 지표 실적"),
         ("p", f"{org.get('name', '')} {org.get('dept', '')} · 기준일 {kdate(dt.date.fromisoformat(res['base']))}"),
         ("note", "산식은 경영평가 편람에서 읽은 그대로이며, 실적은 넣은 자료로 계산했습니다. ‘자료 필요’ 항목은 해당 자료를 넣으면 채워집니다.")]
    for i, x in enumerate(k["kpis"], 1):
        B.append(("h1", f"{i}. {x['name']}" + (f" (배점 {fmt_h(x['weight'])})" if x.get("weight") else "")))
        B.append(("table", ["구분", "내용"], [["산식", x["formula"]], ["실적", _val(x)], ["산출 근거", x["basis"]], ["편람 근거", _cite(x.get("src")) or "기본 지표"]], [1, 5]))
    ev = regs.get("gov", {}).get("evidence")
    B.append(("h1", "증빙 자료"))
    for f in res["files"]:
        if any(kk in f["kinds"] for kk in ("records", "sign", "cert", "survey", "budget")):
            B.append(("bullet", f"{f['rel']}"))
    if ev:
        B.append(("note", f"편람 증빙 요구: {ev['text']}"))
    return B


def criteria_blocks(res: dict, org: dict) -> list:
    regs = res.get("regs") or {}
    B = [("title", "교육훈련 산정 기준표(규정 해석 결과)"),
         ("p", f"{org.get('name', '')} {org.get('dept', '')} · 다이수가 아래 문서에서 읽어 계산에 적용한 기준입니다."),
         ("h1", "1. 읽은 문서"),
         ("table", ["구분", "파일"], [[d["label"], d["file"]] for d in regs.get("docs", [])] or [["-", "규정 문서 없음(설정값 사용)"]], [1, 4]),
         ("h1", "2. 적용 기준")]
    B.append(("table", ["분야", "항목", "값", "근거(파일·위치)", "원문"],
              [[it["group"], it["label"], it["value"], _cite(it["src"]), it["src"]["text"][:80] if it.get("src") else ""] for it in regs.get("items", [])],
              [1.2, 2, 2.5, 2.5, 4]))
    B.append(("note", "※ 기준값이 실제 규정과 다르면 원문을 고친 뒤 다시 넣거나, 설정에서 덮어쓸 수 있습니다."))
    return B
