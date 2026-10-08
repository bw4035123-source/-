"""인수 리허설: 확정된 인수인계 내용으로 후임자 확인 문제를 내고 '인수 준비도'를 잰다.

'전달했다'가 아니라 '이해했다'를 확인하는 단계다. 모델 없이 인수인계서 항목만으로 문제를 만든다.
- 기한(언제)·담당자(누구)·현안 상태·자료 위치(어디): 4지선다
- 노하우: O/X (일부는 낱말·숫자를 바꾼 틀린 문장)
정답은 화면에 보내지 않고 서버에서 채점한다. 틀린 문제는 근거 원문 조각과 함께 돌려준다.
답이 둘 이상일 수 있는 문제(같은 문장에서 나온 서로 다른 날짜, 같은 업무를 맡은 두 사람 등)는 내지 않는다.
"""
from __future__ import annotations

import hashlib
import random
import re

CONFIRMED = ("verified", "edited")
LIVE_OUT = ("deleted", "unsupported")
TYPES = {"when": "기한", "who": "담당자", "status": "현안 상태", "where": "자료 위치", "tip": "노하우"}
STATUS_POOL = ["진행중", "대기", "보류", "요청 받음", "회신 대기", "완료"]
# 뜻이 가까운 상태(대기·회신 대기·보류)는 서로 오답 보기로 쓰지 않는다(정답이 애매해짐)
STATUS_GROUP = {"진행중": "진행", "대기": "멈춤", "회신 대기": "멈춤", "보류": "멈춤", "요청 받음": "요청", "완료": "완료"}
STATUS_REP = {"진행": "진행중", "멈춤": "보류", "요청": "요청 받음", "완료": "완료"}
ACTION_RX = re.compile(r"제출|보고|계약|점검|교육|실시|요구|준비|만료|종료|평가|회의|공고|등록|신청|훈련|진단|갱신|정산|게시|운영|구매")
SYSTEM_POOL = ["온나라", "새올", "공유폴더", "업무관리시스템", "나라장터", "e호조", "메신저"]
# 노하우 문장의 틀린 보기를 만들 때 서로 바꾸는 낱말
SWAPS = [("새 양식", "작년 양식"), ("미리", "나중에"), ("이내", "이후"), ("전에", "후에"), ("반드시", "굳이"),
         ("늦으니", "빠르니"), ("감점", "가점"), ("메신저", "메일"), ("먼저", "나중에"), ("많은", "적은")]
DATE_RX = re.compile(r"(20\d{2}\.\s*)?\d{1,2}\.\s*\d{1,2}\.(\([월화수목금토일]\))?|\d{1,2}월\s*(\d{1,2}일|초|중순|말|중)?|"
                     r"\d{1,2}/\d{1,2}|매월\s*\d{1,2}일|매\s*분기|매년|매월|\d{1,2}일")


def _qid(kind: str, item_id: str) -> str:
    return kind + "-" + hashlib.sha1(item_id.encode()).hexdigest()[:8]


def _body(text: str) -> str:
    return re.sub(r"^\[[^\]]*\]\s*", "", text).strip()


def _short(s: str, n: int = 110) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def pool_items(draft: dict) -> tuple[dict[str, list[dict]], bool]:
    """출제에 쓸 항목. 전임자가 확인·수정한 항목이 있으면 그것만, 없으면 살아 있는 항목 전부(검수 전 표시)."""
    by_kind = {s["kind"]: s["items"] for s in draft["sections"]}
    confirmed = {k: [i for i in v if i["status"] in CONFIRMED] for k, v in by_kind.items()}
    if sum(len(v) for k, v in confirmed.items() if k in ("calendar", "people", "issues", "tips", "resources")) >= 3:
        return confirmed, True
    return {k: [i for i in v if i["status"] not in LIVE_OUT] for k, v in by_kind.items()}, False


def _q_when(items: list[dict], rnd: random.Random) -> list[dict]:
    rows = []
    for it in items:
        m = re.match(r"^\[([^\]]+)\]", it["text"])
        if not m or not (it["meta"].get("day") or it["meta"].get("month")):
            continue
        right, body = m.group(1).strip(), _body(it["text"])
        masked = DATE_RX.sub("○○", body)
        if right in masked or "○○" not in masked and right in body:
            continue
        # 남은 문맥이 너무 짧거나 무슨 일인지 알 수 없는 문장(예: '○○ 14:00 / 본관 3층')은 문제로 내지 않는다
        if len(re.sub(r"[^가-힣]", "", masked)) < 12 or not ACTION_RX.search(masked):
            continue
        rows.append((it, right, masked))
    # 같은 문장에서 서로 다른 날짜가 나온 항목(예: '1월 초 준비, 2월 말 만료')은 답이 모호하므로 뺀다
    by_text: dict[str, set] = {}
    for it, right, masked in rows:
        by_text.setdefault(masked, set()).add(right)
    answers = sorted({r for _, r, _ in rows})
    form = lambda a: "매월" if a.startswith("매월") else "매년" if a.startswith(("매년", "매 분기")) else "연도" if re.match(r"20\d\d", a) else "기타"  # noqa: E731
    out = []
    for it, right, masked in rows:
        if len(by_text[masked]) > 1:
            continue
        wrong = [a for a in answers if a != right]
        if len(wrong) < 2:
            continue
        # 보기 모양만 보고 답을 고르지 않도록 정답과 같은 꼴(매월·매년·연도 포함 날짜)의 보기를 먼저 고른다
        same = [a for a in wrong if form(a) == form(right)]
        other = [a for a in wrong if form(a) != form(right)]
        rnd.shuffle(same), rnd.shuffle(other)
        opts = [right] + (same + other)[:3]
        out.append(dict(kind="when", item=it, q=f"다음 일은 언제 해야 하나요?\n“{_short(masked)}”", options=opts, answer=right,
                        explain=f"정답은 ‘{right}’입니다. 원문: {_short(body, 140)}"))
    return out


def _q_who(items: list[dict], rnd: random.Random) -> list[dict]:
    people = [i for i in items if i["meta"].get("name")]
    names = sorted({i["meta"]["name"] for i in people})
    if len(names) < 3:
        return []
    out = []
    for it in people:
        m = re.search(r"관련:\s*([^/※]+)", it["text"])
        if not m:
            continue
        right = it["meta"]["name"]
        for topic in (t.strip() for t in m.group(1).split(",")):
            if len(topic) < 5 or any(n in topic for n in names):
                continue
            # 다른 사람도 같은 일로 나오면 답이 둘이 되므로 건너뛴다
            if any(topic in o["text"] for o in people if o is not it):
                continue
            opts = [right] + rnd.sample([n for n in names if n != right], min(3, len(names) - 1))
            out.append(dict(kind="who", item=it, q=f"‘{_short(topic, 50)}’ 건으로 연락해야 할 사람은 누구인가요?", options=opts,
                            answer=right, explain=f"정답은 ‘{right}’입니다. {_short(it['text'], 140)}"))
            break
    return out


def _q_status(items: list[dict], rnd: random.Random) -> list[dict]:
    out = []
    for it in items:
        st = (it["meta"].get("status") or "").strip()
        if st not in STATUS_POOL:
            continue
        body = it["text"]
        # 문장에 답이 그대로 드러나지 않게 상태 낱말을 가린다
        masked = re.sub(r"진행\s*중|회신\s*대기|대기|보류|요청|완료", "○○", body)
        opts = [st] + [STATUS_REP[g] for g in ("진행", "멈춤", "요청", "완료") if g != STATUS_GROUP[st]]
        out.append(dict(kind="status", item=it, q=f"다음 현안의 현재 상태는 무엇인가요?\n“{_short(masked)}”", options=opts, answer=st,
                        explain=f"정답은 ‘{st}’입니다. 다음 할 일: {it['meta'].get('next') or '전임자 확인 필요'}"))
    return out


def _q_where(items: list[dict], rnd: random.Random) -> list[dict]:
    known = sorted({s for i in items for s in (i["meta"].get("systems") or [])} | set(SYSTEM_POOL))
    out, seen = [], set()
    for it in items:
        systems = [s for s in (it["meta"].get("systems") or []) if s in it["text"]]
        if len(systems) != 1:
            continue
        right = systems[0]
        masked = it["text"].replace(right, "○○")
        if masked in seen:
            continue
        seen.add(masked)
        opts = [right] + rnd.sample([s for s in known if s != right], 3)
        out.append(dict(kind="where", item=it, q=f"빈칸(○○)에 들어갈 시스템·위치는 어디인가요?\n“{_short(masked)}”", options=opts,
                        answer=right, explain=f"정답은 ‘{right}’입니다. 원문: {_short(it['text'], 140)}"))
    return out


def _falsify(text: str, rnd: random.Random) -> str | None:
    """노하우 문장의 뜻을 뒤집은 틀린 문장. 만들 수 없으면 None."""
    pairs = [(a, b) for a, b in SWAPS if a in text or b in text]
    if pairs:
        a, b = rnd.choice(pairs)
        rx = re.compile(re.escape(a) + "|" + re.escape(b))
        return rx.sub(lambda m: b if m.group(0) == a else a, text)
    m = re.search(r"(?<![\d.])([1-9]\d?)\s*(일|시간|주|개월|회|부|장|%)", text)
    if m:
        n = int(m.group(1))
        alt = n + rnd.choice([3, 5, 7]) if n < 10 else max(1, n // 2)
        return text[: m.start(1)] + str(alt) + text[m.end(1):]
    return None


def _q_tip(items: list[dict], rnd: random.Random) -> list[dict]:
    out = []
    for it in items:
        t = it["text"].strip()
        if len(t) < 10 or t.endswith("?"):
            continue
        fake = _falsify(t, rnd) if rnd.random() < 0.55 else None
        stmt, right = (fake, "X") if fake and fake != t else (t, "O")
        out.append(dict(kind="tip", item=it, q=f"전임자의 노하우입니다. 맞으면 O, 틀리면 X를 고르세요.\n“{_short(stmt, 140)}”",
                        options=["O", "X"], answer=right,
                        explain=("맞는 문장입니다." if right == "O" else "틀린 문장입니다. 원래 노하우: ") + ("" if right == "O" else _short(t, 140))))
    return out


def _candidates(draft: dict, rnd: random.Random) -> tuple[list[dict], bool]:
    pool, confirmed = pool_items(draft)
    qs = (_q_when(pool.get("calendar", []), rnd) + _q_who(pool.get("people", []), rnd) + _q_status(pool.get("issues", []), rnd)
          + _q_where(pool.get("resources", []), rnd) + _q_tip(pool.get("tips", []), rnd))
    return qs, confirmed


def text_hash(item: dict) -> str:
    return hashlib.sha1(item["text"].encode()).hexdigest()[:10]


def known(mastery: dict, item: dict) -> bool:
    """가장 최근에 맞혔고, 그 뒤로 항목 내용이 바뀌지 않았으면 숙지한 것으로 본다."""
    m = mastery.get(item["id"])
    return bool(m and m.get("ok") and m.get("h") == text_hash(item))


def coverage(draft: dict) -> dict[str, tuple[str, dict]]:
    """출제할 수 있는 항목 id → (문제 유형, 항목). 준비도의 분모."""
    qs, _ = _candidates(draft, random.Random(0))
    return {q["item"]["id"]: (q["kind"], q["item"]) for q in qs}


def make_round(draft: dict, mastery: dict, n: int = 10, seed: int = 0) -> dict:
    """한 회차 문제. 아직 못 맞힌 항목을 먼저, 유형이 고르게 섞이도록 뽑는다."""
    rnd = random.Random(seed)
    qs, confirmed = _candidates(draft, rnd)
    rnd.shuffle(qs)
    qs.sort(key=lambda q: known(mastery, q["item"]))
    by: dict[str, list] = {}
    for q in qs:
        by.setdefault(q["kind"], []).append(q)
    picked = []
    while len(picked) < n and any(by.values()):
        for k in list(by):
            if by[k] and len(picked) < n:
                picked.append(by[k].pop(0))
    out = []
    for q in picked:
        opts = list(q["options"])
        if q["kind"] != "tip":
            rnd.shuffle(opts)
        out.append({"id": _qid(q["kind"], q["item"]["id"]), "type": TYPES[q["kind"]], "kind": q["kind"], "q": q["q"], "options": opts,
                    "answer": opts.index(q["answer"]), "item": q["item"]["id"], "h": text_hash(q["item"]),
                    "sources": q["item"]["sources"], "explain": q["explain"]})
    return {"questions": out, "confirmed_only": confirmed}


def public(rnd_set: dict) -> dict:
    """화면에 보낼 문제(정답·해설·근거 제외)."""
    keep = ("id", "type", "kind", "q", "options", "item")
    return {"questions": [{k: q[k] for k in keep} for q in rnd_set["questions"]], "confirmed_only": rnd_set["confirmed_only"]}


def grade(rnd_set: dict, answers: dict) -> list[dict]:
    res = []
    for q in rnd_set["questions"]:
        chosen = answers.get(q["id"])
        chosen = int(chosen) if isinstance(chosen, (int, str)) and str(chosen).lstrip("-").isdigit() else None
        res.append({"id": q["id"], "type": q["type"], "kind": q["kind"], "item": q["item"], "h": q["h"], "chosen": chosen,
                    "correct": chosen == q["answer"], "answer": q["answer"], "answer_text": q["options"][q["answer"]],
                    "explain": q["explain"], "sources": q["sources"]})
    return res


def readiness(draft: dict, mastery: dict) -> dict:
    """인수 준비도 = 출제 가능한 항목 중 가장 최근에 맞힌 항목의 비율(유형별 포함)."""
    cov = coverage(draft)
    total = len(cov)
    ok = [i for i, (_, it) in cov.items() if known(mastery, it)]
    tried = [i for i in cov if i in mastery]
    by_type = {}
    for kind, label in TYPES.items():
        ids = [i for i, (k, _) in cov.items() if k == kind]
        if ids:
            good = sum(1 for i in ids if known(mastery, cov[i][1]))
            by_type[label] = {"ok": good, "total": len(ids), "pct": round(100 * good / len(ids))}
    return {"pct": round(100 * len(ok) / total) if total else 0, "ok": len(ok), "tried": len(tried), "total": total, "by_type": by_type}
