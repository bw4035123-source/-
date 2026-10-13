"""질문하기: '김민수 뭐 남았어?', '체육시설팀 미이수자', '기간제도 청렴교육 대상이야?' 같은 질문에
이수 판정 결과·교육 규칙표·기관 지침만 근거로 답한다. 근거를 찾지 못하면 모른다고 답한다."""
from __future__ import annotations

import datetime as dt
import re

from .llm import LLMError, get_client
from .reports import open_items
from .util import dept_core, fmt_h, kdate

JOSA = re.compile(r"(은|는|이|가|을|를|도|에|의|로|으로|와|과|랑|이랑|에게|께|만|까지|부터|이야|야|요|인가요|인가|이에요|예요|해|해요|돼|되나요|되나)$")
STOP = {"교육", "알려줘", "알려", "주세요", "뭐야", "뭐", "어떻게", "누가", "누구", "몇", "명", "있어", "있나요", "해야", "하나요", "언제", "대상"}


def words(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[가-힣A-Za-z0-9]+", text or ""):
        w2 = JOSA.sub("", w)
        if len(w2) >= 2 and w2 not in STOP:
            out.append(w2)
    return out


def _rule_hit(q: str, rules: dict) -> dict | None:
    best, score = None, 0
    for r in rules["courses"]:
        names = [r["name"], r["name"].replace(" 교육", "").replace("교육", "")] + r.get("keywords", [])
        sc = max((len(k) for k in names if k and k in q), default=0)
        if sc > score:
            best, score = r, sc
    return best


def _guide_hits(q: str, texts: list[dict], k=3) -> list[dict]:
    qw = words(q)
    scored = []
    for t in texts:
        hit = [w for w in qw if w[:2] in t["text"] and (w in t["text"] or len(w) <= 3)]
        # 두 단어 이상 겹치거나, 세 글자 이상의 구체적인 단어가 겹쳐야 근거로 본다('등록' 한 단어로는 부족)
        if len(hit) >= 2 or any(len(w) >= 3 for w in hit):
            scored.append((len(hit), t))
    scored.sort(key=lambda x: -x[0])
    return [t for sc, t in scored[:k] if sc == scored[0][0]]


def _src(file, where, text=""):
    return {"file": file, "where": where, "text": text[:200]}


def ask(res: dict, question: str) -> dict:
    q = question.strip()
    base = dt.date.fromisoformat(res["base"])
    people = res["people"]
    cols = {c["key"]: c for c in res["columns"]}
    rule = _rule_hit(q, res["rules"])

    # 1) 사람
    named = [p for p in people if p["name"] in q]
    if named:
        lines, srcs = [], []
        for p in named[:3]:
            items = open_items(res, p["id"], mandatory_only=False)
            head = f"{p['name']}({p['dept']}{', ' + p['team'] + '조' if p.get('team') else ''}, {p['shift']})"
            if p.get("left") and p["left"] <= res["base"]:
                lines.append(f"• {head}: 퇴사({p['left']})")
                continue
            if p.get("leave") and p["leave"][0] <= res["base"] <= p["leave"][1]:
                head += f" – 휴직 중(~{p['leave'][1]})"
            if not items:
                lines.append(f"• {head}: 대상 교육을 모두 이수했습니다.")
            else:
                lines.append(f"• {head}: 남은 교육 {len(items)}개")
                for i in sorted(items, key=lambda x: x["due"]):
                    lines.append(f"   - {i['label']} {fmt_h(i['remain'])}시간 남음 · "
                                 + ("기한 지남" if i["overdue"] else f"기한 {kdate(dt.date.fromisoformat(i['due']), False)}(D-{i['dday']})"))
            done = [c for c in res["columns"] if res["cells"][p["id"]][c["key"]]["s"] == "done"]
            if done:
                lines.append("   이수 완료: " + ", ".join(c["label"] for c in done))
            srcs.append(_src(p["src"]["file"], p["src"]["where"], "직원 명단"))
        note = "\n※ 같은 이름이 여러 명이라 모두 보여 드립니다." if len(named) > 1 and len({p['name'] for p in named}) == 1 else ""
        return {"answer": "\n".join(lines) + note, "sources": srcs, "mode": "person"}

    # 2) 부서 + 미이수
    dept = next((d for d in res["depts"] if dept_core(d) and dept_core(d) in q), None)
    want_missing = re.search(r"미이수|안\s*들|못\s*들|안\s*한|남은|누가|누구", q)
    if dept and want_missing:
        lines = []
        for p in [x for x in people if x["dept"] == dept]:
            items = [i for i in open_items(res, p["id"]) if not rule or i["key"].split("@")[0] == rule["id"]]
            if items:
                lines.append(f"• {p['name']}{('(' + p['team'] + '조)') if p.get('team') else ''}: "
                             + ", ".join(i["label"] + (" ⚠기한 지남" if i["overdue"] else "") for i in items))
        title = f"{dept}" + (f" {rule['name']}" if rule else "") + " 미이수자"
        return {"answer": f"{title} {len(lines)}명입니다.\n" + "\n".join(lines) if lines else f"{title}가 없습니다.",
                "sources": [], "mode": "dept"}

    # 3) 교육 현황(몇 명·이수율·누가)
    if rule and re.search(r"미이수|이수율|몇\s*명|현황|누가|누구|안\s*들|못\s*들", q):
        out = []
        for c in [c for c in res["summary"] if c["rule"] == rule["id"]]:
            miss = [p for p in people if res["cells"][p["id"]][c["key"]]["s"] in ("none", "partial")]
            out.append(f"• {c['label']}: 대상 {c['target']}명 중 이수 {c['done']}명({c['rate']}%), 미이수 {len(miss)}명"
                       + (f", 기한 지남 {c['overdue']}명" if c["overdue"] else ""))
            if miss:
                out.append("   " + ", ".join(f"{p['name']}({dept_core(p['dept'])})" for p in miss[:20]) + (" 외" if len(miss) > 20 else ""))
        return {"answer": "\n".join(out), "sources": [], "mode": "course"}

    # 4) 기한·급한 일
    if re.search(r"급한|기한|마감|이번\s*달|지난|밀린", q) and not rule:
        rows = sorted([s for s in res["summary"] if s["mandatory"] and (s["partial"] + s["none"])], key=lambda s: (not s["overdue"], s["next_due"] or ""))
        lines = []
        for s in rows[:8]:
            due = dt.date.fromisoformat(s["next_due"]) if s["next_due"] else None
            when = "기한 지남" if s["overdue"] else (f"D-{(due - base).days} ({kdate(due, False)})" if due else "")
            lines.append(f"• {s['label']}: 미이수 {s['partial'] + s['none']}명 – {when}")
        return {"answer": f"기준일 {kdate(base)} 기준으로 먼저 챙길 교육입니다.\n" + "\n".join(lines), "sources": [], "mode": "due"}

    # 5) 규칙·지침 질문(대상·시간·근거)
    hits = _guide_hits(q, res["texts"])
    if rule:
        tgt = rule.get("target") or {}
        who = ("전 직원(고용형태 구분 없음)" if not tgt else
               f"{tgt['flag']}" if tgt.get("flag") else
               f"전 직원({tgt['exclude_flag']} 제외 – 별도 과정)" if tgt.get("exclude_flag") else
               "올해 입사자" if tgt.get("hired_this_year") else "기관 지정")
        hours = rule["hours"]
        hours_t = " / ".join(f"{k} {v}시간" for k, v in hours.items()) if isinstance(hours, dict) else f"{hours}시간"
        cyc = {"year": "연 1회", "half": "반기마다", "hire": "채용 시"}.get(rule.get("cycle"), "")
        ans = [f"{rule['name']}: 대상 {who}, {cyc} {hours_t}" + ("" if rule.get("mandatory", True) else " (법정 의무 아님·권장)"),
               f"근거: {rule['law']}"]
        if rule.get("note"):
            ans.append(f"참고: {rule['note']}")
        law_src = []
        try:  # 국가법령정보에서 받아 둔 조문 원문(저장본만 사용 – 질문 응답이 네트워크를 기다리지 않도록)
            from . import lawapi
            r0 = lawapi.refs(rule.get("law", ""))[:1]
            if r0:
                a = lawapi.article(r0[0]["name"], r0[0]["jo"], r0[0]["branch"], cache_only=True)
                ans.append(f"조문 원문({a['law']} 제{a['jo']}조 {a['title']}, 시행 {a['effective']}):\n  " + a["text"][:400].replace("\n", "\n  ")
                           + ("…" if len(a["text"]) > 400 else ""))
                law_src.append(_src("국가법령정보", f"{a['law']} 제{a['jo']}조", a["url"]))
        except Exception:
            pass
        if hits:
            ans.append("기관 지침:")
            ans += [f"  “{h['text']}” [{h['file']} {h['where']}]" for h in hits[:2]]
        return {"answer": "\n".join(ans), "sources": [_src("config/rules.json", rule["id"], rule["law"])] + law_src +
                [_src(h["file"], h["where"], h["text"]) for h in hits[:2]], "mode": "rule"}

    if hits:
        client = get_client()
        if client.available:
            ctx = "\n".join(f"[{i + 1}] {h['text']}" for i, h in enumerate(hits))
            try:
                out = client.chat([{"role": "system", "content": "기관 교육 지침만 근거로 짧게 답하고 문장 끝에 [번호]를 붙이세요. 근거에 없으면 '지침에서 찾을 수 없습니다'라고 답하세요."},
                                   {"role": "user", "content": f"{ctx}\n\n질문: {q}"}])
                if re.search(r"\[\d\]", out):
                    return {"answer": out, "sources": [_src(h["file"], h["where"], h["text"]) for h in hits], "mode": "llm"}
            except LLMError:
                pass
        return {"answer": "기관 지침에서 찾은 내용입니다.\n" + "\n".join(f"• {h['text']}" for h in hits),
                "sources": [_src(h["file"], h["where"], h["text"]) for h in hits], "mode": "guide"}
    return {"answer": "자료와 지침에서 답을 찾지 못했습니다. 사람 이름, 부서, 교육 이름을 넣어 다시 물어보세요.", "sources": [], "mode": "none"}
