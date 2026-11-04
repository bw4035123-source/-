"""상위법 개정 전후 비교 — 국가법령정보 신구법 비교(target=oldAndNew) 응답을 조문 단위로 정리하고
바뀐 용어·수치·신설·삭제 조문을 결정적으로 뽑는다(lib/upper-change.ts 와 같음, 우리 규정 영향 점검은 화면에서)"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .numbers import extract_quantities, quantity_label

_SNAP: dict | None = None


def snapshot(name: str):
    """내장 스냅샷(실시간 조회가 안 될 때) — lib/law-api/mock/old-and-new.json 을 내보낸 것"""
    global _SNAP
    if _SNAP is None:
        p = Path(__file__).parent / "data" / "old_and_new.json"
        _SNAP = json.loads(p.read_text("utf-8")) if p.exists() else {}
    return _SNAP.get(re.sub(r"\s", "", name))


def _as_list(v) -> list:
    return v if isinstance(v, list) else [v] if isinstance(v, dict) else []


def _s(v) -> str:
    return v if isinstance(v, str) else "" if v is None else str(v)


def _ymd(s: str) -> str:
    return f"{int(s[:4])}. {int(s[4:6])}. {int(s[6:8])}." if re.fullmatch(r"\d{8}", s) else s


def _info(v) -> dict:
    o = v or {}
    return {"name": _s(o.get("법령명")), "kind": _s(o.get("법종구분")), "promulgated": _ymd(_s(o.get("공포일자"))), "effective": _ymd(_s(o.get("시행일자"))), "type": _s(o.get("제개정구분명")), "number": _s(o.get("공포번호"))}


def parts(content: str) -> list[dict]:
    out, at = [], 0
    for m in re.finditer(r"<P>([\s\S]*?)</P>", content):
        if m.start() > at:
            out.append({"t": content[at:m.start()], "m": False})
        out.append({"t": m.group(1), "m": True})
        at = m.end()
    if at < len(content):
        out.append({"t": content[at:], "m": False})
    return [p for p in out if p["t"]]


def plain(ps: list[dict]) -> str:
    return "".join(p["t"] for p in ps)


_HEAD = re.compile(r"^\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:\(([^)]*)\))?")
_SKIP = re.compile(r"^\s*(?:[①-⑳]\s*(?:∼|~)\s*[①-⑳]\s*|\d+\.\s*)?\((?:생\s*략|현행과\s*같음)\)\s*$")


def _is_mark(s: str, w: str) -> bool:
    return bool(re.fullmatch(rf"\s*<\s*{w[0]}\s*{w[1]}\s*>\s*", s))


def parse_old_and_new(data) -> dict | None:
    root = (data or {}).get("OldAndNewService", data) if isinstance(data, dict) else {}
    olds = _as_list((root.get("구조문목록") or {}).get("조문"))
    news = _as_list((root.get("신조문목록") or {}).get("조문"))
    before, after = _info(root.get("구조문_기본정보")), _info(root.get("신조문_기본정보"))
    if not olds and not news:
        return {"law": after["name"], "before": before, "after": after, "rows": [], "terms": [], "numbers": [], "added": [], "deleted": [], "amended": [], "noTable": True} if after["name"] else None
    rows, article, title = [], "", ""
    for i in range(max(len(olds), len(news))):
        o = _s(olds[i].get("content")) if i < len(olds) else ""
        n = _s(news[i].get("content")) if i < len(news) else ""
        op, np_ = parts(o), parts(n)
        ot, nt = plain(op), plain(np_)
        if _SKIP.match(ot) and _SKIP.match(nt):
            continue
        head = _HEAD.match(nt) or _HEAD.match(ot)
        if head:
            article = f"제{head.group(1)}조" + (f"의{head.group(2)}" if head.group(2) else "")
            title = head.group(3) or ""
        if not article:
            continue
        kind = "신설" if _is_mark(ot, "신설") else "삭제" if _is_mark(nt, "삭제") else "개정"
        if kind == "개정" and not any(p["m"] for p in op) and not any(p["m"] for p in np_):
            continue
        rows.append({"article": article, "title": title, "kind": kind, "old": [] if kind == "신설" else op, "new": [] if kind == "삭제" else np_})

    def head_kind(k: str) -> list[str]:
        return list(dict.fromkeys(r["article"] for r in rows if r["kind"] == k and _HEAD.match(plain(r["new"] if k == "신설" else r["old"]))))

    added, deleted = head_kind("신설"), head_kind("삭제")
    amended = [a for a in dict.fromkeys(r["article"] for r in rows) if a not in added and a not in deleted]
    return {"law": after["name"] or before["name"], "before": before, "after": after, "rows": rows, "terms": term_changes(rows), "numbers": number_changes(rows), "added": added, "deleted": deleted, "amended": amended}


_PARTICLE = re.compile(r"(?:으로서|으로써|에게서|에서는|으로|에게|에서|까지|부터|이나|이며|이고|와|과|의|이|가|을|를|은|는|에|로|도|만)$")


def _stem(w: str) -> str:
    return _PARTICLE.sub("", w) if len(w) > 3 else w


# 용어(명사)만 — 동사·형용사 활용형(수입하거나·제출한다·해당하는)은 제외
_VERBISH = re.compile(r"(?:하거나|하고|하며|하여|하여야|한다|하는|하지|되거나|되는|된다|되어|하게|할|한|함|된|됨|있는|없는|이다|이며)$")


def _words(s: str) -> list[str]:
    return [w for w in (_stem(m.group(0)) for m in re.finditer(r"[가-힣]{2,}", s) if not _VERBISH.search(m.group(0))) if len(w) >= 3]


def _common_end(a: str, b: str) -> int:
    k = 0
    while k < len(a) and k < len(b) and a[-1 - k] == b[-1 - k]:
        k += 1
    return k


def _common_start(a: str, b: str) -> int:
    k = 0
    while k < len(a) and k < len(b) and a[k] == b[k]:
        k += 1
    return k


def term_changes(rows: list[dict]) -> list[dict]:
    all_old = "\n".join(plain(r["old"]) for r in rows)
    all_new = "\n".join(plain(r["new"]) for r in rows)
    found: dict[str, dict] = {}
    for r in (x for x in rows if x["kind"] == "개정"):
        gone = [w for w in _words(" ".join(p["t"] for p in r["old"] if p["m"])) if w not in all_new]
        came = list(dict.fromkeys(w for w in _words(" ".join(p["t"] for p in r["new"] if p["m"])) if w not in all_old))
        for g in dict.fromkeys(gone):
            cands = [(c, max(_common_end(g, c), _common_start(g, c))) for c in came]
            cands = [x for x in cands if x[1] >= 2 and abs(len(x[0]) - len(g)) <= 3 and _common_start(g, x[0]) < min(len(g), len(x[0])) - 1]
            if not cands:
                continue
            best = sorted(cands, key=lambda x: -x[1])[0][0]
            t = found.setdefault(f"{g}→{best}", {"from": g, "to": best, "count": 0, "articles": []})
            if r["article"] not in t["articles"]:
                t["articles"].append(r["article"])
    for t in found.values():
        t["count"] = all_old.count(t["from"])
    return sorted(found.values(), key=lambda t: -t["count"])


def number_changes(rows: list[dict]) -> list[dict]:
    out = []
    for r in (x for x in rows if x["kind"] == "개정"):
        o, n = extract_quantities(plain(r["old"])), extract_quantities(plain(r["new"]))
        fr, to = [q for q in o if q not in n], [q for q in n if q not in o]
        if fr or to:
            out.append({"article": r["article"], "from": [quantity_label(q) for q in fr], "to": [quantity_label(q) for q in to]})
    return out
