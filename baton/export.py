"""인수인계서 내보내기: Markdown · Word(DOCX, 한글에서도 열림) · 인쇄용 HTML.

각 항목 뒤에 각주 번호를 달고, 문서 끝에 '근거 목록(파일·위치)'을 붙여 출처를 끝까지 추적할 수 있게 한다.
"""
from __future__ import annotations

import html
import io
import re

from .ingest import KIND_LABEL

TRUST_LABEL = {"official": "공식", "doc": "문서", "mail": "메일", "memo": "메모", "oral": "구술", "none": "근거없음"}
STATUS_LABEL = {"verified": "확인", "edited": "수정", "ai": "미검수", "added": "추가"}


def _collect(project: dict):
    """(섹션 목록, 근거 번호표) – 삭제·근거없음 항목 제외."""
    draft = project["draft"]
    chunk_map = {c["id"]: c for c in project["chunks"]}
    qmap = {q["id"]: q for q in draft["questions"]}
    notes: dict[str, int] = {}
    secs = []
    for s in draft["sections"]:
        items = []
        for it in s["items"]:
            if it["status"] in ("deleted", "unsupported"):
                continue
            nums = []
            for sid in it["sources"]:
                if sid in chunk_map or sid in qmap:
                    notes.setdefault(sid, len(notes) + 1)
                    nums.append(notes[sid])
            items.append((it, nums))
        secs.append((s, items))
    refs = []
    for sid, n in sorted(notes.items(), key=lambda x: x[1]):
        if sid in qmap:
            refs.append((n, sid, f"전임자 구술 – {qmap[sid]['q'][:60]} ({qmap[sid].get('answered_at', '')})"))
        else:
            c = chunk_map[sid]
            refs.append((n, sid, f"{c['file']} · {c['where']} [{KIND_LABEL.get(c['kind'], '')}]"))
    return secs, refs


def _meta_rows(project: dict) -> list[tuple[str, str]]:
    p, d = project, project["draft"]
    h = p.get("handover", {})
    integ = p.get("integrity", {})
    return [
        ("기관·부서", f"{p.get('org', '')} {p.get('dept', '')}".strip()),
        ("업무명", p.get("name", "")),
        ("전임자 → 후임자", f"{p.get('from_name', '')} → {p.get('to_name', '')}"),
        ("인수인계 기준일", p.get("base_date", "")),
        ("분석 자료", f"{len(p['docs'])}개 파일 / 근거조각 {len(p['chunks'])}개"),
        ("초안 생성", f"{d.get('generated_by', '')} ({d.get('generated_at', '')})"),
        ("원본 무결성", "변경 없음 확인" if integ.get("ok") else "확인 전"),
        ("전임자 확인", h.get("from_signed_at", "미확인")),
        ("후임자 수령", h.get("to_signed_at", "미수령")),
    ]


def _item_text(it: dict) -> str:
    t = it["text"]
    m = it["meta"]
    if m.get("next") and m["next"] not in t:
        t += f" → 다음 할 일: {m['next']}"
    if m.get("due"):
        t += f" (기한: {m['due']})"
    if m.get("resolved"):
        t += f" ⇒ 전임자 확인: {m['resolved']}"
    return t


def _fn(nums) -> str:
    return "".join(f"[{n}]" for n in nums)


def handover_blocks(project: dict) -> list:
    """인수인계서: 표 위주로(일정·현안·연락망), 모든 줄에 근거 번호와 끝에 근거 목록."""
    secs, refs = _collect(project)
    B = [("title", f"{project.get('title') or '업무 인수인계서'} – {project.get('name', '')}"),
         ("table", ["구분", "내용"], [[k, v] for k, v in _meta_rows(project)], [1, 3])]
    for s, items in secs:
        B.append(("h1", s["title"]))
        if not items:
            B.append(("p", "(해당 없음)"))
            continue
        kind = s["kind"]
        if kind == "calendar":
            rows = []
            for it, nums in items:
                m = re.match(r"^\[([^\]]*)\]\s*(.*)$", it["text"])
                when, what = (m.group(1), m.group(2)) if m else ("", it["text"])
                rows.append([when, what + (" (기한)" if it["meta"].get("deadline") else ""), TRUST_LABEL[it["trust"]], _fn(nums)])
            B.append(("table", ["시기", "할 일", "근거 성격", "근거"], rows, [2, 7, 1.3, 1.2]))
        elif kind == "issues":
            rows = [[_item_text(it).split(" → 다음 할 일")[0], it["meta"].get("status", ""), it["meta"].get("next", ""), _fn(nums)]
                    for it, nums in items]
            B.append(("table", ["현안", "상태", "다음 할 일", "근거"], rows, [6, 1.2, 2.5, 1.2]))
        elif kind == "people":
            rows = []
            for it, nums in items:
                t = it["text"]
                who, _, rest = t.partition(" – 관련: ")
                topic, _, contact = rest.partition(" / 연락: ")
                if not rest:
                    who, _, contact = t.partition(" / 연락: ")
                rows.append([who, topic, contact, _fn(nums)])
            B.append(("table", ["이름·소속", "관련 업무", "연락처", "근거"], rows, [3, 4, 3, 1.2]))
        else:
            for it, nums in items:
                B.append(("bullet", f"[{TRUST_LABEL[it['trust']]}] {_item_text(it)} {_fn(nums)}".strip()))
    qs = [q for q in project["draft"]["questions"] if q.get("answer")]
    if qs:
        B.append(("h1", "부록. 전임자 인터뷰 기록"))
        B.append(("table", ["질문", "전임자 답변"], [[q["q"], q["answer"]] for q in qs], [1, 1]))
    B.append(("h1", "근거 목록"))
    B.append(("table", ["번호", "근거(파일 · 위치)"], [[f"[{n}]", f"{sid} – {label}"] for n, sid, label in refs], [1, 9]))
    h = project.get("handover", {})
    B.append(("h1", "인계·인수 확인"))
    B.append(("table", ["구분", "성명", "확인 일시"], [["전임자", project.get("from_name", ""), h.get("from_signed_at", "")],
                                                    ["후임자", project.get("to_name", ""), h.get("to_signed_at", "")]], [1, 2, 2]))
    B.append(("note", "※ 업무바통으로 자료에서 자동 작성한 뒤 전임자가 검수했습니다. 근거 번호는 원본 파일의 위치를 가리킵니다."))
    return B


GLOSSARY = {
    "온나라": "정부 업무관리(전자결재·문서관리) 시스템",
    "e호조": "지방자치단체 지방재정관리시스템(예산 편성·집행·회계)",
    "이호조": "지방자치단체 지방재정관리시스템(예산 편성·집행·회계)",
    "디브레인": "중앙부처 국가재정관리시스템(dBrain+)",
    "나라장터": "조달청 국가종합전자조달시스템(입찰·계약)",
    "새올": "시·군·구 행정정보시스템",
    "인사랑": "지방공무원 인사·급여 시스템",
    "e-사람": "중앙부처 인사·복무 시스템",
    "문서24": "기관 밖으로 공문을 주고받는 전자문서 유통 서비스",
    "GPKI": "행정전자서명 인증서(공무원 업무용 인증서)",
    "전결": "결재권자를 대신해 위임받은 사람이 최종 결재하는 것",
    "기안": "결재받기 위해 문서를 처음 작성하는 것",
    "수준진단": "개인정보보호 관리수준진단: 기관의 개인정보 관리 실태를 지표로 평가하는 제도",
    "관리실태 평가": "국가정보원 등이 실시하는 기관 정보보안 관리 실태 평가",
    "보안점검의 날": "매월 정해진 날 PC·문서 보안을 일제히 점검하는 날",
    "웹 접근성": "장애인·고령자도 홈페이지를 이용할 수 있게 하는 기준(인증 유효기간 있음)",
    "하자보수": "공사·용역 완료 후 정해진 기간 동안 결함을 고쳐 주는 의무",
    "착공": "공사를 시작함",
    "준공": "공사를 마침",
    "입찰공고": "계약 상대를 경쟁으로 정하기 위해 내는 공고",
    "수의계약": "경쟁 없이 특정 업체와 맺는 계약(금액·사유 제한)",
    "예산요구서": "다음 연도 예산을 예산부서에 요청하는 문서",
    "해빙기": "얼었던 땅이 녹는 2~3월(지반·축대 안전점검 시기)",
    "정기점검": "정해진 주기마다 하는 법정·계약상 점검",
    "R&R": "역할과 책임(Role & Responsibility), 업무분장",
}


def _due_date(meta: dict, start):
    """현안 기한 정보 → 착임일 기준 실제 날짜(연도 없으면 착임일 이후 가장 가까운 해)."""
    import datetime as dt

    d = (meta or {}).get("due_meta")
    if not d or not d.get("month"):
        return None
    day = d.get("day") or {"초": 5, "중순": 15, "말": 25}.get(d.get("part", ""), 28)
    for y in ([d["year"]] if d.get("year") else [start.year, start.year + 1]):
        try:
            c = dt.date(y, d["month"], min(day, 28 if d["month"] == 2 else 30 if d["month"] in (4, 6, 9, 11) else 31))
        except ValueError:
            continue
        if d.get("year") or c >= start - dt.timedelta(days=31):
            return c
    return None


def manual_blocks(project: dict, start: str | None = None, level: str = "new") -> list:
    """후임자 업무매뉴얼: 첫 주 할 일, 착임월부터 12개월 일정, 기한순 현안, 연락망, 노하우, (처음이면) 용어 풀이.

    start: 착임일(없으면 인수인계 기준일), level: new(처음 맡는 업무) | exp(유사 업무 경험 있음)
    """
    import datetime as dt

    from .plan import make_plan

    d = project["draft"]
    live = lambda items: [i for i in items if i["status"] not in ("deleted", "unsupported")]  # noqa: E731
    secs = {s["kind"]: s for s in d["sections"]}
    try:
        base = dt.date.fromisoformat(start or project.get("base_date") or dt.date.today().isoformat())
    except ValueError:
        base = dt.date.today()
    plan = make_plan(d, project["docs"], base, horizon=60)
    to = project.get("to_name") or "후임자"
    lv = "처음 맡는 업무 – 용어 풀이 포함" if level != "exp" else "유사 업무 경험 있음 – 기본 설명 생략"
    B = [("title", f"후임자 업무매뉴얼 – {project.get('name', '')}"),
         ("p", f"**{to}** 님을 위해 {project.get('from_name') or '전임자'}의 업무 자료와 인터뷰 답변으로 만든 매뉴얼입니다."),
         ("table", ["착임일", "경력", "전임자 확인"], [[str(base), lv, (project.get("handover") or {}).get("from_signed_at") or "확인 전 초안"]], [1, 2, 1]),
         ("h1", "1. 담당 업무 한눈에")]
    B += [("bullet", it["text"]) for it in live(secs.get("overview", {}).get("items", []))] or [("p", "(업무분장 자료 없음)")]

    B.append(("h1", "2. 첫 주에 할 일"))
    for w in plan["week1"]:
        hint = w.get("hint") or ""
        B.append(("bullet", f"[{w['type']}] {w['title']}" + (f" – {hint}" if hint and hint[:15] not in w["title"] else "")))
    soon = [t for t in plan["timeline"] if t["dday"] <= 30]
    if soon:
        B.append(("h2", "30일 안에 다가오는 일정"))
        B.append(("table", ["D-day", "날짜", "할 일"],
                  [[f"D-{t['dday']}", t["date"] + (" (대략)" if t["approx"] else ""), re.sub(r"^\[[^\]]*\]\s*", "", t["title"])]
                   for t in soon], [1, 2, 7]))

    B.append(("h1", "3. 착임월부터 12개월 일정"))
    cal = live(secs.get("calendar", {}).get("items", []))
    rows = []
    routine = [re.sub(r"^\[[^\]]*\]\s*", "", i["text"]) for i in cal if i["meta"].get("recur") in ("monthly", "quarterly")]
    if routine:
        rows.append(["매월·분기", "\n".join(routine)])
    for mth in [(base.month - 1 + k) % 12 + 1 for k in range(12)]:
        its = sorted((i for i in cal if i["meta"].get("month") == mth and i["meta"].get("recur") not in ("monthly", "quarterly")),
                     key=lambda i: i["meta"].get("day") or 15)
        if its:
            rows.append([f"{mth}월", "\n".join(("★ " if i["meta"].get("deadline") else "") + i["text"]
                                                + (f" ({i['meta']['timing']})" if i["meta"].get("timing") else "") for i in its)])
    B.append(("table", ["시기", "할 일 (★ 기한)"], rows, [1, 8]) if rows else ("p", "(일정 없음)"))

    B.append(("h1", "4. 진행 중인 현안 (기한 순)"))
    iss = live(secs.get("issues", {}).get("items", []))
    dated = sorted(((_due_date(i["meta"], base), i) for i in iss), key=lambda x: (x[0] is None, x[0] or base))
    rows = []
    for when, i in dated:
        left = "기한 없음" if not when else ("기한 지남" if when < base else f"D-{(when - base).days}")
        rows.append([i["text"], i["meta"].get("status", ""), left, i["meta"].get("next", "")])
    B.append(("table", ["현안", "상태", "남은 기간", "다음 할 일"], rows, [5, 1.2, 1.2, 3]) if rows else ("p", "(없음)"))

    B.append(("h1", "5. 꼭 알아둘 연락처"))
    people = (d.get("facts") or {}).get("people", [])
    if people:
        B.append(("table", ["이름", "소속·직위", "연락처", "관련 업무"],
                  [[p["name"], " ".join(x for x in (p.get("org"), p.get("title")) if x),
                    ", ".join(p["tels"] + p["emails"]) + (" ※번호 변경 메모 있음" if p.get("changed") else ""), ", ".join(p["topics"][:3])]
                   for p in people], [1.2, 2, 2.5, 3]))
    else:
        B.append(("p", "(없음)"))

    B.append(("h1", "6. 자료·시스템과 노하우"))
    for i in live(secs.get("resources", {}).get("items", [])) + live(secs.get("tips", {}).get("items", [])):
        B.append(("bullet", i["text"]))
    for q in d["questions"]:
        if q.get("answer") and q.get("type") in ("tacit", "llm", "successor"):
            B.append(("bullet", f"(전임자 구술) {q['q']} → {q['answer']}"))

    chk = [i for i in live(secs.get("checks", {}).get("items", [])) if not i["meta"].get("resolved")]
    if chk:
        B.append(("h1", "7. 아직 확인이 필요한 것"))
        B += [("bullet", i["text"]) for i in chk]

    corpus = " ".join(c["text"] for c in project["chunks"])
    terms = [(t, v) for t, v in GLOSSARY.items() if t in corpus]
    if terms and level != "exp":  # 유사 업무 경험자에게는 용어 풀이를 생략
        B.append(("h1", "8. 용어 풀이"))
        B.append(("table", ["용어", "뜻"], [[t, v] for t, v in terms], [1, 4]))
    B.append(("note", "※ 업무바통이 인수인계 자료로 자동 작성했습니다. 날짜·연락처는 근거 원문으로 한 번 더 확인하세요."))
    return B


def to_markdown(project: dict) -> str:
    from .render import to_md

    return to_md(handover_blocks(project)).decode("utf-8")


def to_html(project: dict) -> str:
    secs, refs = _collect(project)
    e = html.escape
    rows = "".join(f"<tr><th>{e(k)}</th><td>{e(str(v))}</td></tr>" for k, v in _meta_rows(project))
    body = []
    for s, items in secs:
        lis = "".join(
            f"<li><span class='tag {it['trust']}'>{TRUST_LABEL[it['trust']]}</span> {e(_item_text(it))}"
            + "".join(f"<sup>{n}</sup>" for n in nums) + "</li>" for it, nums in items) or "<li>(해당 없음)</li>"
        body.append(f"<h2>{e(s['title'])}</h2><ul>{lis}</ul>")
    qs = [q for q in project["draft"]["questions"] if q.get("answer")]
    if qs:
        body.append("<h2>부록. 전임자 인터뷰 기록</h2><dl>" + "".join(
            f"<dt>Q. {e(q['q'])}</dt><dd>A. {e(q['answer'])}</dd>" for q in qs) + "</dl>")
    body.append("<h2>근거 목록</h2><ol class='refs'>" + "".join(f"<li value='{n}'>{e(sid)} – {e(label)}</li>" for n, sid, label in refs) + "</ol>")
    h = project.get("handover", {})
    sign = (f"<table class='sign'><tr><th>전임자</th><td>{e(project.get('from_name', ''))} {e(h.get('from_signed_at', ''))}</td>"
            f"<th>후임자</th><td>{e(project.get('to_name', ''))} {e(h.get('to_signed_at', ''))}</td></tr></table>")
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{e(project.get('name', '인수인계서'))}</title>
<style>body{{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:860px;margin:32px auto;padding:0 16px;line-height:1.7;color:#1e2124}}
h1,h2{{font-family:'Nanum Myeongjo','바탕',Batang,AppleMyungjo,serif}}
h1{{font-size:25px;padding-bottom:10px;border-bottom:3px double #26221d;margin-bottom:6px}}
h2{{font-size:17px;margin-top:28px;color:#173b5c;border-left:4px solid #1f4e79;padding-left:8px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #c8cac8;padding:6px 8px;font-size:14px;text-align:left}}th{{background:#f4f4f1;width:150px}}
li{{margin:4px 0}}sup{{color:#b23a2e}}.tag{{font-size:11px;border-radius:3px;padding:1px 5px;background:#efe6d3}}.official{{background:#e1eee8}}.memo{{background:#f8ecd2}}
.mail{{background:#e2edf5}}.oral{{background:#efe3ee}}.refs{{font-size:12px;color:#5f656c}}.sign{{margin-top:32px}}dt{{font-weight:bold;margin-top:8px}}
@media print{{body{{margin:0}}}}</style></head><body>
<h1>{e(project.get('title') or '업무 인수인계서')} – {e(project.get('name', ''))}</h1><table>{rows}</table>{''.join(body)}{sign}</body></html>"""


# ───────────── 내 일정으로 내보내기(.ics): Outlook·그룹웨어·휴대폰 달력에 반복 일정으로 등록
def to_ics(project: dict) -> str:
    import datetime as dt

    from .plan import PART_DAY, _next_date

    base = dt.date.fromisoformat(project.get("base_date") or dt.date.today().isoformat())
    sec = next((s for s in project["draft"]["sections"] if s["kind"] == "calendar"), {"items": []})
    chunk_map = {c["id"]: c for c in project["chunks"]}
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def esc(s: str) -> str:
        for a, b in (("\\", "\\\\"), (";", "\\;"), (",", "\\,"), ("\n", "\\n")):
            s = s.replace(a, b)
        return s

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//업무바통//인수인계 업무 달력//KO", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{esc('업무바통 – ' + project.get('name', ''))}"]
    for it in sec["items"]:
        m = it.get("meta") or {}
        if it["status"] in ("deleted", "unsupported") or not m.get("recur"):
            continue
        rrule = ""
        if m["recur"] == "quarterly":
            # 분기 업무는 기준일 이후 가장 가까운 분기 말 달(3·6·9·12월) 15일부터 3개월마다(날짜는 대략)
            qm = next(mm for mm in (3, 6, 9, 12, 15) if mm > base.month or (mm == base.month and base.day <= 15))
            start = dt.date(base.year + (qm > 12), (qm - 1) % 12 + 1, 15)
            rrule = "FREQ=MONTHLY;INTERVAL=3"
        else:
            start = _next_date(m, base)
            if not start:
                continue
            if m["recur"] == "monthly":
                rrule = f"FREQ=MONTHLY;BYMONTHDAY={m.get('day') or PART_DAY.get(m.get('part', ''), 15)}"
            elif m["recur"] == "yearly":
                rrule = "FREQ=YEARLY"
        title = re.sub(r"^\[[^\]]*\]\s*", "", it["text"])
        src = "; ".join(f"{chunk_map[s]['file']} · {chunk_map[s]['where']}" for s in it["sources"] if s in chunk_map)
        lines += ["BEGIN:VEVENT", f"UID:{project['id']}-{it['id']}@baton", f"DTSTAMP:{stamp}",
                  f"DTSTART;VALUE=DATE:{start:%Y%m%d}", f"DTEND;VALUE=DATE:{start + dt.timedelta(days=1):%Y%m%d}",
                  f"SUMMARY:{esc(('[기한] ' if m.get('deadline') else '') + title[:120])}",
                  f"DESCRIPTION:{esc('근거: ' + src + (' / 날짜는 대략(초·중순·말·분기)' if not m.get('day') else ''))}"]
        if rrule:
            lines.append(f"RRULE:{rrule}")
        if m.get("deadline"):
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P3D", f"DESCRIPTION:{esc('3일 전: ' + title[:60])}", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


# ───────────── 바통 파일(.baton): 다음 담당자에게 이어지는 지식 릴레이
def to_baton(project: dict) -> str:
    import datetime as dt
    import json

    d = project["draft"]
    keep = ("verified", "edited")
    sections = []
    for s in d["sections"]:
        items = [{"text": _item_text(i), "trust": i["trust"]} for i in s["items"]
                 if i["status"] in keep and s["kind"] != "checks"]
        if items:
            sections.append({"kind": s["kind"], "title": s["title"], "items": items})
    lineage = list(project.get("lineage", []))
    lineage.append({"name": project.get("from_name", ""), "handed_to": project.get("to_name", ""),
                    "date": project.get("base_date", ""), "work": project.get("name", "")})
    data = {
        "format": "baton/1",
        "meta": {k: project.get(k, "") for k in ("name", "org", "dept", "from_name", "to_name", "base_date")},
        "lineage": lineage,
        "sections": sections,
        "interview": [{"q": q["q"], "a": q["answer"]} for q in d["questions"] if q.get("answer")],
        "exported_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "note": "검수(확인·수정)된 항목과 인터뷰 답변만 담았습니다. 다음 인수인계 때 자료 폴더에 함께 넣으면 근거로 이어집니다.",
    }
    return json.dumps(data, ensure_ascii=False, indent=1)
