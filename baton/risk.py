"""바통 낙하 위험도: 인수인계가 '지금 끊기면 얼마나 위험한가'를 0~100점으로 계산한다.

점수가 높을수록 후임자가 일을 놓칠 위험이 크다. 요인마다 '무엇을 하면 점수가 내려가는지'를 함께 돌려준다.
인터뷰에 답하고, 불일치를 풀고, 검수를 마칠수록 점수가 떨어져 인수인계의 진척을 숫자로 보여 준다.
"""
from __future__ import annotations

import datetime as dt

from .plan import make_plan

LIVE = lambda items: [i for i in items if i["status"] not in ("deleted", "unsupported")]  # noqa: E731


def compute_risk(project: dict) -> dict:
    d = project.get("draft")
    if not d:
        return {"score": None}
    secs = {s["kind"]: s for s in d["sections"]}
    items = [i for s in d["sections"] for i in LIVE(s["items"])]
    qs = d.get("questions", [])
    answered_src = {s for q in qs if q.get("answer") for s in q.get("sources", [])}
    factors = []

    def add(key, label, value, points, cap, hint, tab):
        factors.append({"key": key, "label": label, "value": value, "points": round(min(points, cap), 1), "max": cap,
                        "hint": hint, "tab": tab})

    # 1) 결론 없는 현안: 인터뷰로 상태를 확인하지 않은 대기·보류 현안
    issues = LIVE(secs.get("issues", {}).get("items", []))
    open_issues = [i for i in issues if (i["meta"].get("status") in ("대기", "보류") or i["meta"].get("next") == "전임자 확인 필요")
                   and i["status"] not in ("verified", "edited") and not set(i["sources"]) & answered_src]
    add("open", "결론 없는 현안", f"{len(open_issues)}건", 6 * len(open_issues), 24,
        "③ 인터뷰에서 현재 상태와 다음 할 일을 답하면 내려갑니다", "interview")

    # 2) 풀리지 않은 자료 간 불일치
    conflicts = [i for i in LIVE(secs.get("checks", {}).get("items", [])) if i["meta"].get("type") == "conflict"]
    unresolved = [i for i in conflicts if not i["meta"].get("resolved")]
    add("conflict", "자료 간 기한 불일치", f"{len(unresolved)}/{len(conflicts)}건 미해소", 10 * len(unresolved), 20,
        "불일치 질문에 실제 기한을 답하면 사라집니다", "interview")

    # 3) 인수 직후 2주 안에 닥치는 기한
    base = dt.date.fromisoformat(project.get("base_date") or dt.date.today().isoformat())
    soon = [t for t in make_plan(d, project.get("docs", []), base, horizon=14)["timeline"] if t["deadline"]]
    add("soon", "2주 안에 닥치는 기한", f"{len(soon)}건", 5 * len(soon), 15,
        "⑦ 첫 30일에서 확인하고 후임자와 함께 준비하세요", "plan")

    # 4) 암묵지 의존도: 개인 메모·메일에만 근거한 지식 중 확인 안 된 것
    tacit = [i for i in items if i["trust"] in ("memo", "mail") and i["status"] not in ("verified", "edited")]
    add("tacit", "메모·메일에만 있는 미확인 지식", f"{len(tacit)}건", 1.5 * len(tacit), 15,
        "② 검수에서 확인하거나 수정하면 공식 지식이 됩니다", "review")

    # 5) 검수 미완료
    done = sum(1 for i in items if i["status"] in ("verified", "edited"))
    ratio = done / max(1, len(items))
    add("review", "전임자 검수 미완료", f"{round(100 * ratio)}% 완료", 15 * (1 - ratio), 15,
        "② 검수에서 출처를 보고 ✔ 확인하세요", "review")

    # 6) 인터뷰 미답변
    unanswered = [q for q in qs if q["status"] == "open"]
    add("interview", "인터뷰 미답변", f"{len(unanswered)}/{len(qs)}개", 11 * len(unanswered) / max(1, len(qs)), 11,
        "③ 인터뷰에 답할수록 노하우가 문서로 남습니다", "interview")

    score = round(min(100, sum(f["points"] for f in factors)))
    level = "안전" if score < 30 else "주의" if score < 60 else "위험"
    factors.sort(key=lambda f: -f["points"])
    return {"score": score, "level": level, "factors": factors}
