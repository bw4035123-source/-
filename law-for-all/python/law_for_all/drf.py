"""국가법령정보 공동활용 Open API(DRF) 클라이언트 — lawSearch.do / lawService.do
요청 호스트는 law.go.kr 로 고정(인증키가 다른 곳으로 전송되지 않도록)."""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DRF_BASE = "https://www.law.go.kr/DRF"
CACHE_TTL = 60 * 60 * 6
RETRIES = 3
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


class LawApiError(Exception):
    pass


def drf_get(path: str, params: dict, oc: str, timeout: float = 20):
    cache_key = path + "?" + urllib.parse.urlencode(params)
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    url = f"{DRF_BASE}/{path}?" + urllib.parse.urlencode({"OC": oc, "type": "JSON", **params})
    raw = None
    last_err: Exception | None = None
    # 국가법령정보센터는 간헐적으로 연결을 끊는 경우가 있어 짧게 재시도(총 4회)
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "law-on/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", errors="replace")
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last_err = e
            if attempt < RETRIES:
                time.sleep(0.8 * (attempt + 1))
    if raw is None:
        if hit:
            return hit[1]
        raise LawApiError(f"국가법령정보센터 연결 실패: {getattr(last_err, 'reason', last_err)}") from last_err
    try:
        data = json.loads(raw)
    except ValueError:
        hint = re.sub(r"<[^>]+>|\s+", " ", raw).strip()[:120]
        raise LawApiError(f"국가법령정보센터가 JSON이 아닌 응답을 보냈습니다. OC 인증키와 등록 IP/도메인을 확인하세요. ({hint})")
    _raise_if_rejected(data)
    with _lock:
        _cache[cache_key] = (time.time(), data)
    return data


def _raise_if_rejected(data) -> None:
    """인증키 오류·미등록 IP는 HTTP 200 + {"result": "...", "msg": "..."} JSON으로 온다 → 명확한 오류로 변환"""
    if isinstance(data, dict) and "result" in data and set(data) <= {"result", "msg"}:
        raise LawApiError(f"국가법령정보센터 인증 실패: {data.get('result', '')} {data.get('msg', '')}".strip())


# ───────────── 응답 구조 탐색(키 이름 기준)
def find_all(obj, key: str) -> list:
    out: list = []

    def walk(o):
        if isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, dict):
            for k, v in o.items():
                if k == key:
                    out.extend(v if isinstance(v, list) else [v])
                else:
                    walk(v)

    walk(obj)
    return out


def txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return "\n".join(x for x in (txt(i) for i in v) if x)
    if isinstance(v, dict):
        return txt(v.get("content", ""))
    return str(v).strip()


def _as_list(v) -> list:
    return v if isinstance(v, list) else ([v] if v else [])


def _rec(v) -> dict:
    return v if isinstance(v, dict) else {}


def parse_law_list(data) -> list[dict]:
    out = []
    for it in map(_rec, find_all(data, "law")):
        x = {
            "name": txt(it.get("법령명한글")), "mst": txt(it.get("법령일련번호")), "lawId": txt(it.get("법령ID")),
            "kind": txt(it.get("법령구분명")), "ministry": txt(it.get("소관부처명")), "effective": txt(it.get("시행일자")),
            "status": txt(it.get("현행연혁코드")),
        }
        if x["name"] and x["mst"]:
            out.append(x)
    return out


def to_law_kind(s: str) -> str:
    if s in ("법률", "대통령령", "총리령", "부령"):
        return s
    return "부령" if "부령" in s else "법률"


_HEAD = re.compile(r"^제\d+조(의\d+)?\s*(\([^)]*\))?\s*")


def parse_articles(data) -> list[dict]:
    arts = []
    for u in map(_rec, find_all(data, "조문단위")):
        kind = txt(u.get("조문여부"))
        if kind and kind != "조문":
            continue
        lines = []
        head = txt(u.get("조문내용"))
        if head:
            lines.append(head)
        for hang in map(_rec, _as_list(u.get("항"))):
            h = txt(hang.get("항내용"))
            if h:
                lines.append(h)
            for ho in map(_rec, _as_list(hang.get("호"))):
                t = txt(ho.get("호내용"))
                if t:
                    lines.append("  " + t)
                for mok in map(_rec, _as_list(ho.get("목"))):
                    m = txt(mok.get("목내용"))
                    if m:
                        lines.append("    " + m)
        jo, branch = txt(u.get("조문번호")), txt(u.get("조문가지번호"))
        if not jo:
            continue
        if lines:
            lines[0] = _HEAD.sub("", lines[0])
        arts.append({"no": f"{jo}의{branch}" if branch and branch != "0" else jo, "title": txt(u.get("조문제목")), "text": "\n".join(l for l in lines if l)})
    return arts


def parse_law_doc(data, law_id: str, name: str, mst: str) -> dict:
    basic = _rec((find_all(data, "기본정보") or [None])[0])
    reason = "\n".join(txt(x) for x in find_all(data, "제개정이유내용")).strip()

    def content(v):
        return txt(_rec(v).get("content") if isinstance(v, dict) else v)

    return {
        "id": law_id, "name": txt(basic.get("법령명_한글")) or name, "kind": to_law_kind(content(basic.get("법종구분"))),
        "ministry": content(basic.get("소관부처")), "effectiveDate": txt(basic.get("시행일자")) or None,
        "revisionReason": reason or None, "articles": parse_articles(data), "source": "live", "mst": mst,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def _case_url(kind: str, case_no: str) -> str:
    # 공개 주소 형식(인증키를 브라우저로 노출하지 않음)
    seg = "판례" if kind == "판례" else "법령해석례"
    return f"https://www.law.go.kr/{seg}/({urllib.parse.quote(case_no)})" if case_no else "https://www.law.go.kr/"


def parse_case_list(data, kind: str) -> list[dict]:
    key = "prec" if kind == "판례" else "expc"
    out = []
    for it in map(_rec, find_all(data, key)):
        case_no = txt(it.get("사건번호") or it.get("안건번호"))
        title = txt(it.get("사건명") or it.get("안건명"))
        if not title:
            continue
        out.append({
            "kind": kind, "id": txt(it.get("판례일련번호") or it.get("법령해석례일련번호")), "title": title,
            "caseNo": case_no or None, "court": txt(it.get("법원명") or it.get("회신기관명")) or None,
            "date": txt(it.get("선고일자") or it.get("회신일자")) or None, "url": _case_url(kind, case_no),
        })
    return out


def clean_case_text(raw: str) -> str:
    """판례 본문의 HTML 줄바꿈·태그를 일반 텍스트로(화면에는 텍스트로만 출력 — HTML 주입 방지)"""
    t = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    for a, b in (("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"), ("&amp;", "&")):
        t = t.replace(a, b)
    t = re.sub(r"[ \t]+\n", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


PREC_SECTIONS = [("판시사항", "판시사항"), ("판결요지", "판결요지"), ("참조조문", "참조조문"), ("참조판례", "참조판례"), ("판례내용", "판결 전문")]
EXPC_SECTIONS = [("질의요지", "질의요지"), ("회답", "회답"), ("이유", "이유")]


def parse_case_detail(data, kind: str, case_id: str) -> dict | None:
    body = _rec((find_all(data, "PrecService" if kind == "판례" else "ExpcService") or [None])[0])
    title = txt(body.get("사건명") or body.get("안건명"))
    if not title:
        return None
    case_no = txt(body.get("사건번호") or body.get("안건번호"))
    sections = [{"label": label, "text": clean_case_text(txt(body.get(key)))} for key, label in (PREC_SECTIONS if kind == "판례" else EXPC_SECTIONS)]
    d = {
        "kind": kind, "id": case_id, "title": title, "caseNo": case_no or None,
        "court": txt(body.get("법원명") or body.get("해석기관명")) or None,
        "date": txt(body.get("선고일자") or body.get("해석일자")) or None,
        "judgmentType": txt(body.get("판결유형")) or None,
        "sections": [x for x in sections if x["text"]], "url": _case_url(kind, case_no),
    }
    return d
