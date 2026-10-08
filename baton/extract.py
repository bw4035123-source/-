"""규칙 기반 사실 추출기(LLM 없이도 동작).

근거조각(청크)에서 '시기별 할 일', '사람·기관', '진행 중 현안', '자료·시스템 위치', '노하우·주의사항',
'담당 업무(R&R)'를 뽑는다. 모든 사실은 근거조각 ID(출처)를 가진다.
LLM 모드에서도 이 결과를 '후보 사실'로 넘겨 환각을 줄이고, LLM 실패 시 그대로 대체 결과가 된다.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

# ───────────────────────── 공통 도구 ─────────────────────────
_JOSA = re.compile(r"(으로부터|에서는|에게서|으로는|까지는|부터는|에서|에게|께서|으로|까지|부터|이나|이며|이고|하고|에는|와는|과는|은|는|이|가|을|를|의|에|와|과|도|만|로|께)$")
STOP = set("""있음 있다 없음 예정 관련 대한 위해 경우 내용 사항 진행 해당 담당 업무 우리 이번 다음 지난 작년 올해 금년 내년 매년 매월 기한
까지 이후 이전 확인 필요 요청 완료 처리 제출 검토 협의 보고 계획 결과 추진 시행 참고 기타 정리 자료 문서 파일 관련해 하여 하고 한다 합니다 했음
입니다 됩니다 됨 함 및 등 또는 그리고 그래서 하지만 주무관 사무관 팀장 과장 국장 님 메일 보낸사람 받는사람 날짜 제목 참조""".split())


_SENT_SPLIT = re.compile(r"(?<=[가-힣)][.!?])\s+(?=[^\d\s])")
_HEADING = re.compile(r"^\s*(?:[*#■□●◆▶]\s*\S|\[[^\]]{2,30}\]\s*$|\d{1,2}\.\s+\S|[가-하]\.\s+\S|제\s*\d+\s*[장조절])")


def _split_line(line: str) -> list[str]:
    if " / " in line and ": " in line:  # 엑셀 행은 한 문장으로 유지
        return [line]
    return _SENT_SPLIT.split(line)


def sentences(text: str) -> list[str]:
    return [s for s, _ in sentences_with_heading(text)]


def sentences_with_heading(text: str):
    """(문장, 소제목) 목록. 소제목은 메모의 '* 수준진단' 같은 줄로, 문장의 맥락을 보완한다."""
    out, heading = [], ""
    for raw in text.split("\n"):
        if not raw.strip():
            continue
        line = raw.strip(" \t-•·○◦▪■□●*>").strip()
        if not line:
            continue
        if _HEADING.match(raw) and len(line) <= 30 and not re.search(r"\d+\s*[월일]|까지", line):
            heading = line
        for s in _split_line(line):
            s = s.strip()
            if 6 <= len(s) <= 260:
                out.append((s, heading))
            elif len(s) > 260:
                out.append((s[:257] + "…", heading))
    return out


def keywords(text: str) -> set[str]:
    words = set()
    for w in re.findall(r"[가-힣A-Za-z]{2,}", text):
        w = _JOSA.sub("", w)
        if len(w) >= 2 and w not in STOP:
            words.add(w)
    return words


def similar(a: str, b: str) -> float:
    ka, kb = keywords(a), keywords(b)
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / len(ka | kb)


def bigram_sim(a: str, b: str) -> float:
    def grams(s):
        s = re.sub(r"\s+", "", s)
        return {s[i:i + 2] for i in range(len(s) - 1)}
    ga, gb = grams(a), grams(b)
    return len(ga & gb) / max(1, min(len(ga), len(gb)))


# ───────────────────────── 날짜·시기 ─────────────────────────
WEEKDAY = r"(?:\s*\((?:월|화|수|목|금|토|일)\))"
RE_FULL = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)\s*일?\.?")
RE_MD_KO = re.compile(r"(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일")
RE_MD_DOT = re.compile(r"(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?=" + WEEKDAY + r"|\s*까지|\s*~|\s*\)|\s*한|\s*마감|\s*제출|\s*예정|\s*$|\s*,)")
RE_MD_SLASH = re.compile(r"(?<![\d/.])(\d{1,2})/(\d{1,2})(?![\d/])")
RE_MONTH = re.compile(r"(?<![\d.])(\d{1,2})\s*월\s*(초순|중순|하순|초|중|말|경)?(?!\s*\d)")
RE_MONTHLY = re.compile(r"매월\s*(?:(\d{1,2})\s*일|(초|중순|말))")
RE_QUARTER = re.compile(r"매\s*분기|분기\s*별|분기마다")
RE_HALF = re.compile(r"(상|하)반기")
RE_YEARLY = re.compile(r"매년|해마다|연\s*1회|연례|정기적으로|매해")
RE_DEADLINE = re.compile(r"까지|기한|마감|제출|만료|종료|완료|회신")

_PART = {"초": "초", "초순": "초", "중": "중순", "중순": "중순", "말": "말", "하순": "말", "경": ""}


def _clean_title(s: str) -> str:
    if " / " in s and ": " in s:  # 엑셀 행: 앞쪽 두 항목만
        t = " / ".join(x.split(": ", 1)[-1] for x in s.split(" / ")[:2])
    else:
        t = re.sub(r"^\s*(\d{1,2}|[가-하])\.\s*", "", s)
    t = re.sub(r"\s+", " ", t).strip(" ,~:-·")
    return t[:80] + ("…" if len(t) > 80 else "")


def find_dates(s: str) -> list[dict]:
    """문장 하나에서 시기 정보를 찾는다. 반환: [{month, day, year, part, recur}]"""
    found, taken = [], []

    def free(m):
        return all(m.end() <= a or m.start() >= b for a, b in taken)

    def add(m, **kw):
        taken.append((m.start(), m.end()))
        found.append(kw)

    for m in RE_FULL.finditer(s):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            add(m, year=y, month=mo, day=d)
    for rx in (RE_MD_KO, RE_MD_DOT, RE_MD_SLASH):
        for m in rx.finditer(s):
            mo, d = int(m.group(1)), int(m.group(2))
            if free(m) and 1 <= mo <= 12 and 1 <= d <= 31:
                add(m, year=None, month=mo, day=d)
    for m in RE_MONTH.finditer(s):
        mo = int(m.group(1))
        if free(m) and 1 <= mo <= 12:
            add(m, year=None, month=mo, day=None, part=_PART.get(m.group(2) or "", ""))
    if len(found) >= 2 and re.search(r"기간|~", s) and found[0].get("day") and found[1].get("day"):
        found = [dict(found[-1], ends=True)]
    yearly = bool(RE_YEARLY.search(s))
    for f in found:
        f["recur"] = "yearly" if yearly else "once"
        f.setdefault("part", "")
    m = RE_MONTHLY.search(s)
    if m:
        found.append({"year": None, "month": None, "day": int(m.group(1)) if m.group(1) else None,
                      "part": m.group(2) or "", "recur": "monthly"})
    elif RE_QUARTER.search(s) and not found:
        found.append({"year": None, "month": None, "day": None, "part": "", "recur": "quarterly"})
    if not found:
        h = RE_HALF.search(s)
        if h and (yearly or RE_DEADLINE.search(s)):
            found.append({"year": None, "month": 6 if h.group(1) == "상" else 12, "day": None,
                          "part": "말", "recur": "yearly" if yearly else "once"})
    return found[:3]


# ───────────────────────── 사람·기관 ─────────────────────────
SURNAMES = set("김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌팽승간상갈단견당화창")
TITLES = "주무관|사무관|서기관|부이사관|이사관|팀장|과장|국장|계장|실장|부장|차장|대리|주임|선임|책임|연구원|연구관|센터장|소장|단장|원장|본부장|위원장|위원|교수|대표|이사|매니저|PM|PL"
RE_PERSON = re.compile(r"(?<![가-힣])([가-힣]{2,3}?)\s?(" + TITLES + r")(?:님)?(?![가-힣]{2})")
ORG_SUFFIX = r"(?:과|팀|실|국|센터|본부|단|부|청|원|처|공단|공사|재단|위원회|구청|시청|군청|도청|협회|진흥원|연구원|㈜|\(주\))"
RE_ORG_BEFORE = re.compile(r"((?:\(주\)|㈜)\s*[가-힣A-Za-z]{2,15}|[가-힣A-Za-z0-9]{1,15}" + ORG_SUFFIX + r")\s*(?:의\s*)?$")
RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
RE_TEL = re.compile(r"(?<!\d)(0\d{1,2})[-.)\s]?(\d{3,4})[-.\s](\d{4})(?!\d)")
NOT_NAMES = set("담당 업무 관련 해당 각 기관 소속 신임 전임 후임 우리 귀하 사업 예산 계약 보안 정보 시스템 위원회 협의 회의 총괄 실무 운영 기획 회계 감사 인사 총무 민원 행정 전산 정책".split())


def _is_name(n: str) -> bool:
    return len(n) >= 2 and n[0] in SURNAMES and n not in NOT_NAMES and not n.endswith(("은", "는", "을", "를", "이", "가", "의", "에", "과", "와", "도"))


# ───────────────────────── 현안·자원·노하우 ─────────────────────────
RE_ISSUE = re.compile(r"진행\s*중|협의\s*중|검토\s*중|추진\s*중|작업\s*중|대기\s*중|논의\s*중|미완료|미결|보류|지연|회신\s*대기|답변\s*대기|미정|결정\s*필요|확인\s*필요|논의\s*필요|이슈|문제\s*(?:가|점|있)|민원|재검토|차질|협의\s*예정|요청\s*예정|진행\s*예정|아직")
RE_NEXT = re.compile(r"해야|필요|예정|요청|협의|보고|제출|확인|챙겨|준비|처리|진행할|할\s*것|바람|부탁")
RE_TIP = re.compile(r"주의|유의|꼭|반드시|팁|노하우|참고로|실수|반려|놓치|잊지|빠뜨|미리|사전에|좋음|좋다|권장|하지\s*말|금지|조심|중요|핵심|요령|노트|체크")
SYSTEMS = ["온나라", "e호조", "이호조", "나라장터", "K-에듀파인", "에듀파인", "인사랑", "e-사람", "이사람", "새올", "디브레인", "dBrain",
           "지방재정", "업무관리시스템", "전자결재", "문서24", "국민신문고", "정부24", "GPKI", "EPKI", "그룹웨어", "NAS", "공유폴더",
           "공유드라이브", "클라우드", "보탬e", "e나라도움", "하모니", "정보공개시스템", "알리오", "클린아이", "PMS", "ITSM", "VPN", "SSL-VPN"]
RE_SYSTEM = re.compile("|".join(re.escape(s) for s in sorted(SYSTEMS, key=len, reverse=True)), re.I)
RE_PATH = re.compile(r"(?:[A-Z]:\\|\\\\)[^\s\"'<>|]+|(?:공유폴더|NAS|드라이브)\s*[>/\\][^\s,]+(?:\s*[>/\\]\s*[^\s,]+)*")
RE_URL = re.compile(r"https?://[^\s)\]>\"']+")
RE_RR = re.compile(r"담당\s*업무|주요\s*업무|업무\s*분장|분장|소관|담당자|R&R|역할")


RE_NOISE = re.compile(r"전결|대결|시행\s+\S+-\d+|접수\s+\S+-\d+|공개구분|관련입니다|호와\s*관련|우\s*\d{5}|팩스|담당자\s*:\s*$")


def doc_titles(chunks: list[dict], docs: list[dict]) -> dict[str, str]:
    """문서별 제목(메일 제목, 공문 '제목' 줄, 첫 줄, 파일명 순)."""
    first: dict[str, str] = {}
    for c in chunks:
        first.setdefault(c["doc_id"], c["text"])
    out = {}
    for d in docs:
        t = d.get("info", {}).get("subject") or ""
        body = first.get(d["id"], "")
        if not t:
            m = re.search(r"제\s*목\s*[:：]?\s*(.{4,80})", body)
            t = m.group(1).strip() if m else ""
        if not t:
            line = next((l.strip(" []") for l in body.split("\n") if len(l.strip()) >= 6), "")
            t = line[:80] if line and not re.search(r"[:/]", line) else ""
        out[d["id"]] = t or re.sub(r"[_\-]+", " ", d["file"].rsplit("/", 1)[-1].rsplit(".", 1)[0])
    return out


def extract(chunks: list[dict], docs: list[dict]) -> dict:
    kind_of = {d["id"]: d.get("kind", "doc") for d in docs}
    doc_name = {d["id"]: d["file"] for d in docs}
    events, issues, resources, tips, rr = [], [], [], [], []
    people: dict[str, dict] = {}
    mail_docs = [d for d in docs if d.get("kind") == "mail"]

    # ── 메일 헤더로 사람·빈도 파악, 가장 자주 등장하는 주소를 '전임자 본인'으로 추정
    addr_count: Counter = Counter()
    addr_name: dict[str, str] = {}
    for d in mail_docs:
        seen = set()
        for name, addr in d.get("info", {}).get("from", []) + d.get("info", {}).get("to", []):
            if not addr or addr in seen:
                continue
            seen.add(addr)
            addr_count[addr] += 1
            if name:
                addr_name[addr] = re.sub(r"\s+", "", name)
    me_addr = None
    if mail_docs and addr_count:
        a, c = addr_count.most_common(1)[0]
        if c >= max(2, 0.6 * len(mail_docs)):
            me_addr = a
    me_name = None
    if me_addr and me_addr in addr_name:
        me_name = re.sub(r"(" + TITLES + r")$", "", addr_name[me_addr])

    def person(name: str) -> dict:
        p = people.get(name)
        if p is None:
            p = people[name] = {"name": name, "titles": Counter(), "orgs": Counter(), "emails": set(), "tels": set(),
                                "mentions": 0, "mails": 0, "contexts": [], "sources": [], "files": set(), "topics": Counter()}
        return p

    for d in mail_docs:
        chunk = next((c for c in chunks if c["doc_id"] == d["id"]), None)
        for name, addr in d.get("info", {}).get("from", []) + d.get("info", {}).get("to", []):
            if not addr or addr == me_addr:
                continue
            clean = re.sub(r"\s+", "", name or "")
            m = RE_PERSON.match(clean)
            nm, title = (m.group(1), m.group(2)) if m else (clean, "")
            if not nm or not re.fullmatch(r"[가-힣]{2,4}", nm):
                continue
            p = person(nm)
            p["emails"].add(addr)
            if title:
                p["titles"][title] += 1
            p["mails"] += 1
            p["files"].add(d["file"])
            if chunk and chunk["id"] not in p["sources"]:
                p["sources"].append(chunk["id"])
            subj = d.get("info", {}).get("subject", "")
            if subj:
                p["topics"][re.sub(r"^(RE|FW|Fwd|회신|전달)\s*:\s*", "", subj, flags=re.I).strip()] += 1

    titles = doc_titles(chunks, docs)
    seen_issue, seen_tip, seen_event = [], [], set()
    for c in chunks:
        kind = kind_of.get(c["doc_id"], "doc")
        fname = doc_name.get(c["doc_id"], "")
        for s, heading in sentences_with_heading(c["text"]):
            if s.startswith(("보낸사람:", "받는사람:", "참조:", "날짜:", "제목:")) or RE_NOISE.search(s):
                continue
            body = s

            # 시기별 할 일
            for dd in find_dates(body):
                title = _clean_title(body)
                if len(title) < 4:
                    continue
                key = (dd["month"], dd["day"], dd["recur"], title[:30])
                if key in seen_event:
                    continue
                seen_event.add(key)
                events.append({
                    "id": f"E{len(events) + 1:03d}", "title": (title + " (종료)") if dd.get("ends") else title, "text": s, "month": dd["month"], "day": dd["day"],
                    "year": dd["year"], "part": dd["part"], "recur": dd["recur"],
                    "deadline": bool(RE_DEADLINE.search(body)), "sources": [c["id"]], "kind": kind,
                    "doc_id": c["doc_id"], "heading": heading, "doc_title": titles.get(c["doc_id"], ""),
                })

            # 사람
            for m in RE_PERSON.finditer(body):
                nm, title = m.group(1), m.group(2)
                if not _is_name(nm) or (me_name and nm == me_name):
                    continue
                p = person(nm)
                p["titles"][title] += 1
                p["mentions"] += 1
                om = RE_ORG_BEFORE.search(body[: m.start()])
                if om:
                    p["orgs"][om.group(1)] += 1
                tail = body[m.end(): m.end() + 40]
                for e in RE_EMAIL.findall(tail):
                    p["emails"].add(e)
                for t in RE_TEL.findall(tail):
                    p["tels"].add("-".join(t))
                if len(p["contexts"]) < 4 and s not in [x["text"] for x in p["contexts"]]:
                    p["contexts"].append({"text": s, "source": c["id"]})
                if c["id"] not in p["sources"]:
                    p["sources"].append(c["id"])
                p["files"].add(fname)
                for k in keywords(body) - {nm}:
                    p["topics"][k] += 1

            # 자료·시스템 위치
            sysm = RE_SYSTEM.findall(body)
            paths = RE_PATH.findall(body) + RE_URL.findall(body)
            if sysm or paths:
                resources.append({"id": f"R{len(resources) + 1:03d}", "text": s,
                                  "systems": sorted(set(x for x in sysm)), "paths": paths, "sources": [c["id"]], "kind": kind})

            # 노하우·주의사항(특히 개인 메모의 암묵지)
            if RE_TIP.search(body) and (kind in ("memo", "mail") or re.search(r"주의|유의|반드시|노하우|팁|실수|반려", body)):
                if not any(bigram_sim(x["text"], s) > 0.7 for x in seen_tip):
                    item = {"id": f"T{len(tips) + 1:03d}", "text": s, "sources": [c["id"]], "kind": kind}
                    tips.append(item)
                    seen_tip.append(item)

            # 담당 업무(R&R)
            in_rr_file = bool(re.search(r"업무분장|분장표|담당업무|사무분장", fname))
            mine = (me_name in body.split(" / ")[0] or (me_name in body and "감독" in body)) if me_name else ("담당" in body)
            if (in_rr_file and mine) or (RE_RR.search(body) and kind not in ("mail", "data") and not in_rr_file):
                if not any(bigram_sim(x["text"], s) > 0.8 for x in rr):
                    rr.append({"id": f"W{len(rr) + 1:03d}", "text": s, "sources": [c["id"]], "kind": kind})

    issues = find_issues(chunks, kind_of, titles)

    # 사람 정리
    plist = []
    for p in people.values():
        if p["mentions"] + p["mails"] == 0:
            continue
        bad = set(people) | {me_name or ""} | set(TITLES.split("|")) | {"참석", "드림", "안녕하세요", "주무관님"}
        topics = [t for t, _ in p["topics"].most_common(10) if t not in bad and not re.match(r"^(RE|FW)\b", t)][:4]
        plist.append({
            "id": f"P{len(plist) + 1:03d}", "name": p["name"],
            "title": p["titles"].most_common(1)[0][0] if p["titles"] else "",
            "org": p["orgs"].most_common(1)[0][0] if p["orgs"] else "",
            "emails": sorted(p["emails"]), "tels": sorted(p["tels"]),
            "weight": p["mentions"] + 2 * p["mails"], "mails": p["mails"], "mentions": p["mentions"],
            "topics": topics, "contexts": p["contexts"], "sources": p["sources"][:6], "files": sorted(p["files"]),
        })
    plist.sort(key=lambda x: -x["weight"])
    for i, p in enumerate(plist, 1):
        p["id"] = f"P{i:03d}"

    conflicts = find_conflicts(events, chunks)
    return {"events": events, "people": plist, "issues": issues, "resources": resources, "tips": tips, "rr": rr,
            "conflicts": conflicts, "me": {"name": me_name, "email": me_addr}}


def _shared_weight(ka: set[str], kb: set[str]) -> int:
    w = 0
    for x in ka:
        if x in kb or any(min(len(x), len(y)) >= 2 and (y.startswith(x) or x.startswith(y) or
                                                        (min(len(x), len(y)) >= 3 and (x in y or y in x))) for y in kb):
            w += 2 if len(x) >= 4 else 1
    return w


_NUM_PREFIX = re.compile(r"^\s*(?:\d{1,2}|[가-하])\.\s*")


def find_issues(chunks: list[dict], kind_of: dict, titles: dict) -> list[dict]:
    """진행 중 현안: 문단(줄) 단위로 찾아 맥락을 살리고, 문서가 달라도 같은 사안이면 하나로 묶는다."""
    cands = []
    for c in chunks:
        kind = kind_of.get(c["doc_id"], "doc")
        for raw in c["text"].split("\n"):
            line = _NUM_PREFIX.sub("", raw.strip(" \t-•·○◦▪■□●*>"))
            if len(line) < 12 or line.startswith(("보낸사람", "받는사람", "참조", "날짜", "제목")) or not RE_ISSUE.search(line):
                continue
            if len(line) > 220:
                line = next((x for x in _split_line(line) if RE_ISSUE.search(x)), line[:220])
            cands.append({"text": line, "sources": [c["id"]], "kind": kind,
                          "ctx": keywords(line + " " + titles.get(c["doc_id"], "")), "near": keywords(line)})
    groups: list[list[dict]] = []
    for x in cands:
        g = next((g for g in groups if any(
            bigram_sim(x["text"], y["text"]) > 0.7 or
            (_shared_weight(x["near"], y["ctx"]) >= 3 and _shared_weight(x["ctx"], y["ctx"]) >= 4) for y in g)), None)
        (g.append(x) if g else groups.append([x]))
    out = []
    for g in groups:
        rep = max(g, key=lambda y: ({"official": 3, "data": 3, "doc": 2, "mail": 1, "memo": 0}.get(y["kind"], 0), len(y["text"])))
        body = " ".join(y["text"] for y in g)
        status = ("보류" if re.search(r"보류|지연|차질", body) else
                  "대기" if re.search(r"대기|회신|답변|아직|미정|결정\s*필요|결론", body) else "진행중")
        srcs = list(dict.fromkeys(s for y in g for s in y["sources"]))
        related = [y["text"] for y in g if y is not rep and bigram_sim(y["text"], rep["text"]) < 0.7]
        out.append({"id": f"I{len(out) + 1:03d}", "text": rep["text"], "status": status, "related": related,
                    "has_next": bool(RE_NEXT.search(body)) and not re.search(r"아직|미정|결론\s*못", body),
                    "sources": srcs, "kind": rep["kind"], "kinds": sorted({y["kind"] for y in g})})
    return out


def find_conflicts(events: list[dict], chunks: list[dict]) -> list[dict]:
    """서로 다른 문서에서 같은 일로 보이는데 기한이 다른 경우 = 충돌(확인 필요)."""
    dated = [e for e in events if e["month"] and e["day"] and e["deadline"]]
    ctx = {e["id"]: keywords(" ".join([e["title"], e.get("heading", ""), e.get("doc_title", "")])) for e in dated}
    near = {e["id"]: keywords(" ".join([e["title"], e.get("heading", "")])) for e in dated}
    parent = {e["id"]: e["id"] for e in dated}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    for i, a in enumerate(dated):
        for b in dated[i + 1:]:
            if a["doc_id"] == b["doc_id"] or (a["month"], a["day"]) == (b["month"], b["day"]):
                continue
            if a["year"] and b["year"] and a["year"] != b["year"]:
                continue
            if a["recur"] != b["recur"] and "monthly" in (a["recur"], b["recur"]):
                continue
            w = _shared_weight(ctx[a["id"]], ctx[b["id"]])
            w_near = _shared_weight(near[a["id"]], ctx[b["id"]]) + _shared_weight(near[b["id"]], ctx[a["id"]])
            if w >= 2 and w_near >= 2:
                parent[find(a["id"])] = find(b["id"])
    groups: dict[str, list[dict]] = defaultdict(list)
    for e in dated:
        groups[find(e["id"])].append(e)
    out = []
    for members in groups.values():
        dates = {(e["month"], e["day"]) for e in members}
        if len(members) < 2 or len(dates) < 2:
            continue
        common = set.intersection(*(ctx[e["id"]] for e in members)) or ctx[members[0]["id"]]
        variants = []
        for e in sorted(members, key=lambda e: (e["month"], e["day"])):
            variants.append({"event": e["id"], "date": fmt_date(e), "text": e["text"], "sources": e["sources"], "kind": e["kind"]})
        out.append({"id": f"C{len(out) + 1:03d}", "topic": " ".join(sorted(common, key=len, reverse=True)[:3]),
                    "variants": variants})
    return out[:20]


def fmt_date(e: dict) -> str:
    if e["recur"] == "monthly":
        return f"매월 {e['day']}일" if e["day"] else f"매월 {e['part']}".strip()
    if e["recur"] == "quarterly":
        return "매 분기"
    s = f"{e['year']}. " if e.get("year") else ""
    if e["month"]:
        s += f"{e['month']}월"
        s += f" {e['day']}일" if e["day"] else (f" {e['part']}" if e["part"] else "")
    return ("매년 " if e["recur"] == "yearly" else "") + s.strip()
