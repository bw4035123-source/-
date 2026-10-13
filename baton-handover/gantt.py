"""업무 간트차트와 업무별 체크리스트.

인수인계 분석 결과(연간 일정·진행 중 현안·계약 기간·리스크 레이더의 착수일)를 착임일부터 N개월 달력 위 막대로 놓는다.
  - 업무별: 담당 업무(R&R)마다 묶어 보여 준다(어느 업무에 속하는지는 낱말이 겹치는 정도로 정함)
  - 기간별: 묶지 않고 시작일 순서로 늘어놓는다
막대를 누르면 그 업무의 체크리스트를 만든다. 체크리스트는 업무 종류별 표준 절차(계약·점검·제출·공사·예산·교육·보험·민원·수질)에
이 인수인계 자료에서 찾은 기한·협의 상대·노하우·빈틈·근거를 더한 것이다. 체크한 상태는 저장된다.
"""
import calendar
import hashlib
import re
from datetime import date, timedelta

from core.textutil import similarity
from reportgen import josa

RANGE_RX = re.compile(r"(?:(20\d{2})\s*[.\-/]\s*)?(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?\s*(?:\([^)]*\))?\s*[~∼\-–]\s*(?:(20\d{2})\s*[.\-/]\s*)?(?:(\d{1,2})\s*[.\-/]\s*)?(\d{1,2})\s*\.?")
PERIOD_RX = re.compile(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*~\s*(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})")
ROLE = {"주임", "주무관", "팀장", "과장", "담당자", "협의", "업체", "센터", "부서", "팀", "문의",
        "용역", "계약", "점검", "검사", "공사", "예산", "제출", "시설", "시설물"}
DOMAIN = [  # (막대 낱말, 이 낱말이 이름에 있는 담당 업무로 보냄)
    (r"수질|탁도|여과기|잔류염소", r"수질"),
    (r"교체공사|보수공사|착공|냉난방|승강기|청소|보험", r"유지관리|유지보수"),
    (r"행정사무감사|의회", r"민원|예산"),
]
GENERIC = {"관리", "업무", "관련", "실시", "필요", "확인", "결과", "보고", "추진", "계획", "시행", "운영", "담당", "소관", "기타"}

KINDS = [  # (종류, 판별 낱말, 막대 색 이름)
    ("계약", r"계약|용역|입찰|공고|임차|위탁|재계약|발주", "contract"),
    ("공사", r"공사|착공|준공|교체|보수|정비", "work"),
    ("점검", r"점검|검사|진단|안전", "check"),
    ("예산", r"예산|집행|결산|정산|요구서", "budget"),
    ("제출·보고", r"제출|보고|통보|공개|게시", "report"),
    ("교육", r"교육|연수|훈련", "edu"),
    ("보험·갱신", r"보험|갱신", "renew"),
    ("민원", r"민원", "civil"),
]


def _words(t):
    ws = set()
    for w in re.findall(r"[가-힣A-Za-z]{2,}", t or ""):
        w = re.sub(r"(은|는|이|가|을|를|의|에|에서|으로|로|과|와|및)$", "", w)
        if len(w) >= 2 and w not in GENERIC:
            ws.add(w)
    return ws


def kind_of(text):
    for name, rx, cls in KINDS:
        if re.search(rx, text or ""):
            return name, cls
    return "업무", "etc"


def _tid(*parts):
    return "g-" + hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:10]


def _kdate(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{y}. {m}. {d}."


def _clamp(y, m, d):
    last = calendar.monthrange(y, m)[1]
    try:
        d = int(d)
    except (TypeError, ValueError):
        d = 1
    return date(y, m, max(1, min(d, last)))


def _src(it):
    s = (it.get("sources") or [{}])[0] if isinstance(it, dict) else {}
    return f"{s.get('file', '').rsplit('/', 1)[-1]} {s.get('loc', '')}".strip()


def _occurrences(s, start, end):
    """일정 항목 → 기간 안의 [(시작일, 끝일, 점인지)]"""
    months = sorted({int(m) for m in s.get("months") or [] if str(m).isdigit() and 1 <= int(m) <= 12})
    if not months or not (s.get("task") or "").strip():
        return []
    text = s["task"]
    rec = s.get("recurring") or ""
    out = []
    years = range(start.year, end.year + 1)
    if rec == "매월":
        d = s.get("day") or 1
        cur = date(start.year, start.month, 1)
        while cur <= end:
            x = _clamp(cur.year, cur.month, d)
            if start <= x <= end:
                out.append((x, x, True))
            cur = _clamp(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
        return out
    rng = RANGE_RX.search(text)
    for y in years:
        if not rec and s.get("year") and s["year"] != y and not s.get("date"):
            continue
        for m in months:
            if rng:
                m1, d1 = int(rng.group(2)), int(rng.group(3))
                m2 = int(rng.group(5) or m1)
                d2 = int(rng.group(6))
                if m1 != m:
                    continue
                a, b = _clamp(y, m1, d1), _clamp(y, m2, d2)
            elif s.get("day"):
                a = b = _clamp(y, m, s["day"])
            else:
                a, b = date(y, m, 1), _clamp(y, m, 31)
            if b >= start and a <= end:
                out.append((max(a, start), min(b, end), a == b))
    if not rec and out:  # 일회성: 가장 가까운 한 번만
        out = out[:1]
    return out


def build(h, start=None, months=12, rd=None):
    """간트 자료: {start, end, months:[{y,m,label}], groups:[{id,name,tasks:[...]}]}"""
    from report import _parse_due, live
    start = start or date.today()
    start = date(start.year, start.month, 1) if start.day > 1 and False else start
    first = date(start.year, start.month, 1)
    months = max(3, min(int(months or 12), 24))
    ey, em = first.year + (first.month - 1 + months) // 12, (first.month - 1 + months) % 12 + 1
    end = date(ey, em, 1) - timedelta(days=1)
    S = h["draft"]["sections"]
    duties = [r for r in live(S["rnr"]) if not re.search(r"참고사항|메모", r["duty"])]
    groups = [{"id": f"d{i}", "name": r["duty"], "words": _words(r["duty"] + " " + (r.get("detail") or "")), "tasks": []}
              for i, r in enumerate(duties)]
    other = {"id": "etc", "name": "그 밖의 업무", "words": set(), "tasks": []}

    def place(task):
        tw = _words(task["label"] + " " + task.get("related", ""))
        best, score = other, 0
        for g in groups:
            sc = len(tw & g["words"]) + max((similarity(task["label"], g["name"]) for _ in [0]), default=0)
            # 계약·예산·민원 같은 종류 낱말이 업무 이름에 있으면 가산
            if re.search(task["kind"].split("·")[0], g["name"]):
                sc += 1
            for a, b in DOMAIN:
                if re.search(a, task["label"]) and re.search(b, g["name"]):
                    sc += 2
                    break
            if sc > score:
                best, score = g, sc
        g = best if score >= 1 else other
        task["duty"] = g["name"] if g is not other else ""
        g["tasks"].append(task)

    tasks = []
    # 1) 연간 일정
    for s in live(S["schedule"]):
        if s.get("timing") in ("완료", "지난 일"):
            continue
        occ = _occurrences(s, first, end)
        if not occ:
            continue
        kind, cls = kind_of(s["task"] + " " + (s.get("related") or ""))
        tasks.append({"id": _tid("s", s["id"]), "label": s["task"], "related": s.get("related") or "", "kind": kind, "cls": cls,
                      "segments": [{"from": a.isoformat(), "to": b.isoformat(), "point": p} for a, b, p in occ],
                      "recurring": s.get("recurring") or "", "source": _src(s), "ref": s["id"], "from": "일정",
                      "overdue": s.get("timing") == "기한 지남"})
    # 2) 진행 중 현안: 착임일부터 기한까지
    for i in live(S["issues"]):
        due = _parse_due(i.get("due"), start.year)
        label = i["title"] if not i.get("next_action") or i["next_action"] in i["title"] else f"{i['title']}: {i['next_action']}"
        kind, cls = kind_of(label)
        if due and due < start and (start - due).days > 183:
            due = date(due.year + 1, due.month, min(due.day, 28))
        if due:
            a, b = (start, due) if due >= start else (start, start)
            seg = [{"from": max(a, first).isoformat(), "to": min(b, end).isoformat(), "point": a == b}]
        else:
            seg = [{"from": start.isoformat(), "to": min(start + timedelta(days=30), end).isoformat(), "point": False, "open": True}]
        tasks.append({"id": _tid("i", i["id"]), "label": label, "related": "", "kind": kind, "cls": cls, "segments": seg,
                      "due": due.isoformat() if due else "", "source": _src(i), "ref": i["id"], "from": "현안",
                      "overdue": bool(due and due < start)})
    # 3) 계약 기간(계약 대장)
    for x in h["draft"].get("ledger", []):
        if x.get("kind") != "계약":
            continue
        m = PERIOD_RX.search(x.get("period") or "")
        if not m:
            continue
        a = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        b = date(int(m.group(4)), int(m.group(5)), int(m.group(6)))
        if b < first or a > end:
            continue
        tasks.append({"id": _tid("c", x["name"], x.get("period")), "label": f"{x['name']} 계약 기간", "related": x.get("vendor", ""),
                      "kind": "계약", "cls": "contract", "segments": [{"from": max(a, first).isoformat(), "to": min(b, end).isoformat(), "point": False}],
                      "due": b.isoformat(), "source": f"{x['source']['file'].rsplit('/', 1)[-1]} {x['source']['loc']}" if x.get("source") else "",
                      "ref": "", "from": "계약", "overdue": False, "status": x.get("status", "")})
    # 4) 리스크 레이더의 '다음 계약 준비 착수'(자료에 직접 없는 날을 계산해 넣은 것)
    for e in (rd or {}).get("timeline", []):
        if "착수" in e["title"] and e["kind"] == "자료":
            d0 = date.fromisoformat(e["date"])
            if first <= d0 <= end:
                tasks.append({"id": _tid("r", e["title"]), "label": e["title"], "related": "", "kind": "계약", "cls": "contract",
                              "segments": [{"from": e["date"], "to": e["date"], "point": True}], "source": e.get("source", ""),
                              "ref": "", "from": "리스크 레이더", "overdue": e["days"] < 0, "why": e.get("why", "")})
    # 비슷한 막대 합치기(같은 업무가 일정·현안 양쪽에 있을 때)
    uniq = []
    for t in sorted(tasks, key=lambda t: t["segments"][0]["from"]):
        if re.match(r"^(중|및|등|후|전|또는)\s", t["label"]) or len(t["label"].strip()) < 4:
            continue  # 문장 조각
        dup = next((u for u in uniq if similarity(re.sub(r"[\[\]():]", " ", u["label"]), re.sub(r"[\[\]():]", " ", t["label"])) >= 0.55
                    and abs((date.fromisoformat(u["segments"][0]["from"]) - date.fromisoformat(t["segments"][0]["from"])).days) <= 31), None)
        if dup:
            dup.setdefault("also", []).append(t["from"])
            continue
        uniq.append(t)
    for t in uniq:
        place(t)
    out_groups = [g for g in groups + [other] if g["tasks"]]
    for g in out_groups:
        g.pop("words", None)
        g["tasks"].sort(key=lambda t: t["segments"][0]["from"])
    month_list = []
    y, m = first.year, first.month
    for _ in range(months):
        month_list.append({"y": y, "m": m, "label": f"{m}월" if m != 1 or not month_list else f"{y}. {m}월",
                           "days": calendar.monthrange(y, m)[1]})
        y, m = y + (m == 12), m % 12 + 1
    done = h.get("checklists") or {}
    for g in out_groups:
        for t in g["tasks"]:
            c = done.get(t["id"])
            if c:
                n = len(c["items"])
                t["check"] = {"done": sum(1 for x in c["items"] if x.get("done")), "total": n}
    return {"start": start.isoformat(), "first": first.isoformat(), "end": end.isoformat(), "months": month_list,
            "groups": out_groups, "count": sum(len(g["tasks"]) for g in out_groups)}


# ---------------------------------------------------------------- 체크리스트

STEPS = {
    "계약": ["계약 만료일과 계약 방법(입찰·수의계약) 확인", "소요 예산 확보 여부 확인(예산 집행현황)", "과업지시서·설계서(규격) 작성",
           "원가 검토·계약심사 의뢰(대상인 경우)", "입찰공고 게시(공고 기간 확보)", "적격심사·낙찰자 결정",
           "계약 체결, 계약보증금·보험 증권 확인", "착수계 접수, 기존 계약 만료 전 인계(공백 방지)"],
    "공사": ["착공일 확정(업체·관계 부서 협의)", "이용자 안내문 게시·사용 중지 구역 공지", "안전관리계획·공사 보험 확인",
           "공정 점검과 감독 일지 작성", "준공검사·하자보수 기간 기록", "대금 지급과 정산"],
    "점검": ["점검 계획 결재(일정·대상·점검표)", "점검 기관 섭외 또는 자체점검표 준비", "이용자 안내(휴관·사용 중지 공지)",
           "점검 실시·사진 기록", "지적 사항 조치 계획 수립", "결과 보고(기한 내)와 관계기관 통보"],
    "예산": ["예산 지침·요구 기준 확인", "사업별 산출 근거 작성", "전년도 집행률·이월 검토", "예산 부서와 사전 협의", "결재 후 기한 내 제출"],
    "제출·보고": ["작성 양식과 지난 회차 자료 확보", "수치·근거 자료 확인", "보고서 작성(리포트 업그레이더 활용)", "결재",
              "제출처·제출 기한 확인 후 제출", "제출 결과 기록"],
    "교육": ["교육 대상·일정 확정", "강사 섭외·강사료 기준 확인", "교육 공지와 신청 접수", "교육 실시·출석 확인", "결과 보고와 강사료 정산"],
    "보험·갱신": ["갱신일과 보장 내용 확인", "견적 비교", "결재 후 계약", "증권 보관과 관계 부서 통보"],
    "민원": ["민원 접수일과 법정 처리 기한 확인", "사실 확인·현장 조사", "회신 전 팀장 보고", "기한 내 회신", "민원 대장 기록"],
    "업무": ["담당 자료와 지난 처리 내역 확인", "추진 일정 확정", "필요 시 관계 부서 협의", "결재", "실행", "결과 기록·보고"],
}
WATER = ["검사기관 예약", "시료 채취", "결과 확인(기준 대비)", "부적합 시 조치·재검사", "기한 내 결과 제출"]


def make_checklist(h, task, blocks=None, net=None, start=None):
    """간트 막대(task) → 체크리스트 {id, title, kind, due, items:[{id,text,tag,src,done}]}"""
    label = task["label"]
    items = []

    def add(text, tag="절차", src=""):
        if not any(similarity(text, x["text"]) >= 0.7 for x in items):
            items.append({"id": f"c{len(items) + 1}", "text": text, "tag": tag, "src": src, "done": False})
    today = (start or date.today()).isoformat()
    due = task.get("due") or next((x["to"] for x in task["segments"] if x["to"] >= today), task["segments"][-1]["to"])
    if due:
        add(f"기한 {_kdate(due)}까지 마치기" + (" — 이미 기한이 지났으니 처리 여부부터 확인" if due < today else ""), "기한", task.get("source", ""))
    if task.get("why"):
        add(task["why"], "주의", task.get("source", ""))
    for step in (WATER if "수질" in label else STEPS.get(task["kind"], STEPS["업무"])):
        add(step)
    # 이 업무와 관련된 자료: 빈틈·협의 상대·노하우. 흔한 낱말 하나만 겹치는 건 관련 없다고 본다
    words = _words(label + " " + task.get("related", ""))

    def near(text):
        hit = words & _words(text)
        return len(hit) >= 2 or any(len(w) >= 3 for w in hit)
    for f in h["draft"].get("flags", []):
        if not f.get("resolved") and near(f["message"]):
            add(f"빈틈 확인: {f['message']}", "빈틈")
    duty_id = {n["id"]: n["label"] for n in (net or {}).get("nodes", []) if n.get("group") == "duty"}
    ranked = []
    for n in (net or {}).get("nodes", []):
        if n.get("group") in ("center", "duty") or (n.get("group") == "civil" and task["kind"] != "민원"):
            continue
        hit = words & (_words(" ".join(n.get("topics") or [])) - ROLE)
        sc = 2 * len(hit) + (1 if task.get("duty") and duty_id.get(n.get("link")) == task["duty"] else 0)
        if sc >= 2:
            ranked.append((sc, n))
    for _, n in sorted(ranked, key=lambda x: -x[0])[:3]:
        bare = re.sub(r"\(.*?\)", "", n["label"])
        add(f"{n['label']}{josa(bare, '과', '와')} 협의" + (f" ({n['phones'][0]})" if n.get("phones") else ""), "협의", n.get("source", ""))
    for k in (net or {}).get("cards", []):
        if near(k["text"]):
            add(f"노하우: {k['text']}", "노하우", k.get("source", ""))
    for m in h["draft"].get("law_mentions", []):
        if near(m.get("source", {}).get("quote", "")):
            add(f"근거 법령 확인: {m['name']}" + (f" {m['article']}" if m.get("article") else ""), "근거")
    add("처리 결과를 인수인계 초안·업무 달력에 반영", "마무리")
    return {"id": task["id"], "title": label, "kind": task["kind"], "due": due, "items": items[:24]}


def checklist_blocks(c):
    return [("title", f"체크리스트: {c['title']}"),
            ("p", f"업무 종류: {c['kind']} · 기한: {c.get('due') or '-'}"),
            ("table", ["완료", "구분", "할 일", "근거"],
             [["☑" if x.get("done") else "☐", x.get("tag", ""), x["text"], x.get("src", "")] for x in c["items"]], [1, 1, 6, 2])]
