"""환각(Hallucination) 방지 가드 — Next.js 판 lib/answer/guard.ts 와 동일 규칙
 1) 인용 키 화이트리스트: 근거 목록에 없는 [[키]] 제거
 2) 조문 언급 검증: "「법령」 제N조" 표현을 근거 원문과 대조
 3) 인용이 하나도 없으면 예외 → 상위에서 규칙엔진으로 대체"""
from __future__ import annotations

import json
import re

MARKER = re.compile(r"\[\[([^\]\s]+)\]\]")


class GuardError(ValueError):
    pass


def extract_markers(text: str) -> list[str]:
    return MARKER.findall(text)


def sanitize_markers(text: str, allowed: set[str]):
    removed: list[str] = []
    used: list[str] = []

    def rep(m):
        k = m.group(1)
        if k in allowed:
            if k not in used:
                used.append(k)
            return f"[[{k}]]"
        removed.append(k)
        return ""

    out = MARKER.sub(rep, text)
    out = re.sub(r" {2,}", " ", re.sub(r"\s+([.,])", r"\1", out)).strip()
    return out, removed, used


def _norm(s: str) -> str:
    return re.sub(r"\s|ㆍ|·", "", s)


_NAMED = re.compile(r"「([^」]{2,60})」\s*(?:시행령\s*|시행규칙\s*)?제(\d+)조(?:의(\d+))?")
_BARE = re.compile(r"(?:같은\s*법\s*)?제(\d+)조(?:의(\d+))?")


def find_unverified_mentions(text: str, citations: list[dict]) -> list[str]:
    plain = MARKER.sub("", text)
    corpus = "|".join(_norm(c["text"]) for c in citations)
    bad: list[str] = []
    spans = []
    for m in _NAMED.finditer(plain):
        spans.append((m.start(), m.end()))
        no = f"{m.group(2)}의{m.group(3)}" if m.group(3) else m.group(2)
        name = _norm(m.group(1))
        ok = any(_norm(c["lawName"]) == name and c["articleNo"] == no for c in citations) or any(
            _norm(c["lawName"]).startswith(name) and c["articleNo"] == no for c in citations
        ) or _norm(m.group(0)) in corpus
        if not ok and m.group(0).strip() not in bad:
            bad.append(m.group(0).strip())
    for m in _BARE.finditer(plain):
        if any(s <= m.start() < e for s, e in spans):
            continue
        no = f"{m.group(1)}의{m.group(2)}" if m.group(2) else m.group(1)
        ok = any(c["articleNo"] == no for c in citations) or _norm(m.group(0)) in corpus
        if not ok and m.group(0).strip() not in bad:
            bad.append(m.group(0).strip())
    return bad


def parse_loose_json(text: str):
    t = re.sub(r"```(?:json)?", "", text, flags=re.I).strip()
    s, e = t.find("{"), t.rfind("}")
    if s < 0 or e <= s:
        raise GuardError("JSON 객체를 찾지 못했습니다")
    try:
        return json.loads(t[s:e + 1])
    except ValueError as ex:
        raise GuardError(f"JSON 형식 오류: {ex}") from ex


# ───────────── 소형 모델 출력 보정(형식만 고치고 내용·근거는 그대로 검증)
SUMMARY_ALIASES = ("answer", "response", "result", "답변", "요약")


def unwrap_llm_json(raw, keys: tuple):
    """{"answer": {...}} 처럼 한 겹 감싼 출력은 벗기고, summary 가 없으면 answer 등 같은 뜻의 키를 쓴다"""
    known = (*keys, *SUMMARY_ALIASES) if "summary" in keys else keys
    has = lambda v: any(k in v and not (k in SUMMARY_ALIASES and isinstance(v[k], dict)) for k in known)  # noqa: E731
    for _ in range(2):
        if not isinstance(raw, dict) or has(raw):
            break
        inner = [v for v in raw.values() if isinstance(v, dict) and any(k in v for k in known)]
        if len(inner) != 1:
            break
        raw = inner[0]
    if isinstance(raw, dict) and "summary" in keys and not raw.get("summary"):
        alias = next((raw[k] for k in SUMMARY_ALIASES if isinstance(raw.get(k), str) and raw[k].strip()), None)
        if alias:
            raw = {**raw, "summary": alias}
    return raw


def infer_citation_keys(texts: list[str], context: list[dict]) -> list[str]:
    """[[키]] 표시를 빠뜨린 경우: 본문이 근거 목록의 조문을 이름·번호로 정확히 언급했을 때만 그 조문을 인용으로 인정"""
    plain = _norm(MARKER.sub("", "\n".join(texts)))
    out: list[str] = []
    for c in context:
        name, no = _norm(c["lawName"]), c["articleNo"]
        label = re.sub(r"^(\d+)의(\d+)$", r"\1조의\2", no) if "의" in no else no + "조"
        if re.search(re.escape(name) + r"」?제" + re.escape(label) + r"(?![의\d])", plain) and c["key"] not in out:
            out.append(c["key"])
    return out


# ───────────── 느슨한 스키마 변환(zod preprocess 와 같은 동작)
def _s(v) -> str:
    if v is None:
        return ""
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)


def _sl(v) -> list[str]:
    if isinstance(v, list):
        return [_s(x) for x in v]
    return [_s(v)] if v else []


def _objs(v, keys: tuple) -> list[dict]:
    if not isinstance(v, list) or not all(isinstance(x, dict) for x in v):
        return []
    return [{k: x.get(k) for k in keys} for x in v]


class _Cleaner:
    def __init__(self, context: list[dict]):
        self.allowed = {c["key"] for c in context}
        self.removed: list[str] = []
        self.used: list[str] = []
        self.texts: list[str] = []

    def __call__(self, s) -> str:
        out, rem, used = sanitize_markers(_s(s), self.allowed)
        self.removed += rem
        for u in used:
            if u not in self.used:
                self.used.append(u)
        if out:
            self.texts.append(out)
        return out

    def declare(self, keys: list[str]):
        for k in keys:
            if k in self.allowed:
                if k not in self.used:
                    self.used.append(k)
            elif k not in self.removed:
                self.removed.append(k)

    def removed_unique(self) -> list[str]:
        return list(dict.fromkeys(self.removed))


def guard_llm_output(raw, mode: str, context: list[dict]) -> dict:
    raw = unwrap_llm_json(raw, ("summary", "steps", "keyPoints", "background"))
    if not isinstance(raw, dict):
        raise GuardError("JSON 객체가 아닙니다")
    c = _Cleaner(context)
    citizen = officer = None
    summary = c(raw.get("summary"))
    if mode == "citizen":
        steps = [s for s in _objs(raw.get("steps"), ("title", "detail", "ref")) if s["title"]][:3]
        citizen = {
            "easyTerms": [{"term": _s(t["term"]), "meaning": _s(t["meaning"])} for t in _objs(raw.get("easyTerms"), ("term", "meaning")) if t["term"] and t["meaning"]][:5],
            "steps": [{"title": c(s["title"]), "detail": c(s["detail"]), **({"ref": s["ref"]} if s["ref"] in c.allowed else {})} for s in steps],
        }
        if raw.get("tip"):
            citizen["tip"] = c(raw.get("tip"))
    else:
        officer = {
            "background": c(raw.get("background")),
            "keyPoints": [x for x in map(c, _sl(raw.get("keyPoints"))) if x][:6],
            "adminNotes": [x for x in map(c, _sl(raw.get("adminNotes"))) if x][:4],
            "checklist": [x for x in map(c, _sl(raw.get("checklist"))) if x][:6],
        }
    c.declare(_sl(raw.get("citations")))
    if not c.used:
        c.declare(infer_citation_keys(c.texts, context))
    if not summary:
        raise GuardError("요약이 비어 있습니다")
    if not c.used:
        raise GuardError("근거 조문 인용이 없습니다")
    return {"summary": summary, "citizen": citizen, "officer": officer, "citationKeys": c.used, "removed": c.removed_unique(), "unverified": find_unverified_mentions("\n".join(c.texts), context)}


def guard_analysis_output(raw, context: list[dict]) -> dict:
    raw = unwrap_llm_json(raw, ("lawyer", "prosecutor", "judge"))
    if not isinstance(raw, dict):
        raise GuardError("JSON 객체가 아닙니다")
    c = _Cleaner(context)
    lst = lambda v, n=6: [x for x in map(c, _sl(v)) if x][:n]  # noqa: E731
    lw, pr, jd = (raw.get(k) if isinstance(raw.get(k), dict) else {} for k in ("lawyer", "prosecutor", "judge"))
    reqs = []
    for r in _objs(jd.get("requirements"), ("label", "ref", "status", "basis"))[:8]:
        ref = r["ref"] if r["ref"] in c.allowed else None
        if ref and ref not in c.used:
            c.used.append(ref)
        if r["ref"] and not ref:
            c.removed.append(_s(r["ref"]))
        item = {"label": c(r["label"]), "status": r["status"] if r["status"] in ("met", "unmet") else "unclear", "basis": c(r["basis"])}
        if ref:
            item["ref"] = ref
        reqs.append(item)
    perspectives = {
        "lawyer": {"stance": c(lw.get("stance")), "arguments": lst(lw.get("arguments")), "evidence": lst(lw.get("evidence")), "strategy": lst(lw.get("strategy"))},
        "prosecutor": {"stance": c(pr.get("stance")), "violations": lst(pr.get("violations")), "sanctions": lst(pr.get("sanctions")), "proofPoints": lst(pr.get("proofPoints"))},
        "judge": {"stance": c(jd.get("stance")), "issues": lst(jd.get("issues")), "requirements": reqs, "outlook": c(jd.get("outlook"))},
    }
    c.declare(_sl(raw.get("citations")))
    if not c.used:
        c.declare(infer_citation_keys(c.texts, context))
    if not perspectives["lawyer"]["stance"] or not perspectives["judge"]["stance"]:
        raise GuardError("관점 분석이 비어 있습니다")
    if not c.used:
        raise GuardError("근거 조문 인용이 없습니다")
    return {"perspectives": perspectives, "citationKeys": c.used, "removed": c.removed_unique(), "unverified": find_unverified_mentions("\n".join(c.texts), context)}
