"""인수 리허설: 확정된 인수인계 내용으로 후임자용 확인 문제를 만든다.

'전달했다'가 아니라 '이해했다'를 확인하는 단계. LLM 없이도 달력·사람·현안·노하우에서 객관식 문제를 만든다.
"""
from __future__ import annotations

import random
import re

from .extract import fmt_date

LIVE = lambda items: [i for i in items if i["status"] not in ("deleted", "unsupported")]  # noqa: E731


def _strip_date(text: str) -> str:
    t = re.sub(r"^\[[^\]]*\]\s*", "", text)
    t = re.sub(r"(20\d{2}\.\s*)?\d{1,2}\.\s*\d{1,2}\.(\([월화수목금토일]\))?|\d{1,2}월\s*\d{1,2}일|\d{1,2}/\d{1,2}|매월\s*\d{1,2}일", "○○", t)
    return t.strip()[:90]


def make_quiz(draft: dict, n: int = 8, seed: int | None = None) -> list[dict]:
    rnd = random.Random(seed)
    secs = {s["kind"]: s for s in draft["sections"]}
    out = []

    # 1) 언제까지? – 기한이 있는 달력 항목
    cal = [i for i in LIVE(secs.get("calendar", {}).get("items", [])) if i["meta"].get("deadline") and i["meta"].get("month")]
    dates = list(dict.fromkeys(fmt_date({**i["meta"], "year": None}) for i in cal if i["meta"].get("day")))
    for it in cal:
        m = it["meta"]
        if not m.get("day"):
            continue
        right = fmt_date({**m, "year": None})
        wrong = [x for x in dates if x != right]
        if len(wrong) < 2:
            continue
        opts = [right] + rnd.sample(wrong, min(3, len(wrong)))
        rnd.shuffle(opts)
        out.append({"type": "언제", "q": f"다음 일의 기한은 언제인가요?\n“{_strip_date(it['text'])}”", "options": opts,
                    "answer": opts.index(right), "sources": it["sources"], "item": it["id"]})

    # 2) 누구에게? – 협의할 사람
    people = [i for i in LIVE(secs.get("people", {}).get("items", [])) if i["meta"].get("name")]
    names = [i["meta"]["name"] for i in people]
    for it in people:
        m = re.search(r"관련:\s*([^/]+)", it["text"])
        if not m or len(names) < 3:
            continue
        topic = m.group(1).split(",")[0].strip()
        if len(topic) < 4:
            continue
        right = it["meta"]["name"]
        opts = [right] + rnd.sample([x for x in names if x != right], min(3, len(names) - 1))
        rnd.shuffle(opts)
        out.append({"type": "누구", "q": f"‘{topic}’ 건으로 연락해야 할 사람은?", "options": opts,
                    "answer": opts.index(right), "sources": it["sources"], "item": it["id"]})

    # 3) O/X – 노하우·주의사항(원문 그대로 = O)
    for it in LIVE(secs.get("tips", {}).get("items", []))[:4]:
        out.append({"type": "O/X", "q": f"전임자의 노하우입니다. 맞으면 O\n“{it['text'][:120]}”", "options": ["O", "X"],
                    "answer": 0, "sources": it["sources"], "item": it["id"]})

    # 4) 현안 상태
    for it in LIVE(secs.get("issues", {}).get("items", [])):
        st = it["meta"].get("status")
        if st in ("진행중", "대기", "보류"):
            opts = ["진행중", "대기", "보류", "완료"]
            out.append({"type": "현안", "q": f"이 현안의 현재 상태는?\n“{it['text'][:110]}”", "options": opts,
                        "answer": opts.index(st), "sources": it["sources"], "item": it["id"]})

    # 유형이 고르게 섞이도록 뽑는다
    by_type: dict[str, list] = {}
    for q in out:
        by_type.setdefault(q["type"], []).append(q)
    for v in by_type.values():
        rnd.shuffle(v)
    picked = []
    while len(picked) < n and any(by_type.values()):
        for t in list(by_type):
            if by_type[t] and len(picked) < n:
                picked.append(by_type[t].pop())
    for i, q in enumerate(picked, 1):
        q["id"] = f"R{i:02d}"
    return picked
