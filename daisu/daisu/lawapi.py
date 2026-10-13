"""국가법령정보 공동활용 Open API(law.go.kr DRF) 연동.

- 인증키(OC)는 설정 화면에서 입력하며 config/settings.local.json(이 PC에만, 저장소 제외) 또는 환경변수 LAW_OC 에서 읽는다.
- 요청 주소는 law.go.kr 로 고정(설정으로 바꿀 수 없게 해 인증키가 다른 곳으로 가지 않도록 함).
- 받은 법령은 workspace/law_cache.json 에 저장해 인터넷이 끊겨도 마지막 원문을 보여 준다(기본 7일마다 새로 확인).
- 응답 구조가 조금 달라도 동작하도록 키 이름으로 찾아 들어간다.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from . import config

BASE = "https://www.law.go.kr/DRF"
CACHE_DAYS = 7
_LOCK = threading.Lock()


class LawError(Exception):
    pass


def oc() -> str:
    return (config.settings().get("law") or {}).get("oc") or os.environ.get("LAW_OC", "")


def _cache_path():
    return os.path.join(config.WORKSPACE, "law_cache.json")


def _cache() -> dict:
    try:
        with open(_cache_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _cache_put(key: str, data) -> None:
    with _LOCK:
        c = _cache()
        c[key] = {"at": dt.datetime.now().isoformat(timespec="seconds"), "data": data}
        os.makedirs(config.WORKSPACE, exist_ok=True)
        tmp = _cache_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(tmp, _cache_path())


def _get(path: str, params: dict, fresh=False, cache_only=False):
    """DRF 호출(JSON). 캐시가 있고 7일이 안 지났으면 캐시를 쓴다. 실패하면 오래된 캐시라도 돌려준다."""
    key = path + "?" + urllib.parse.urlencode(sorted(params.items()))
    cached = _cache().get(key)
    if cached and not fresh:
        age = dt.datetime.now() - dt.datetime.fromisoformat(cached["at"])
        if age.days < CACHE_DAYS:
            return cached["data"], cached["at"]
    if cache_only:
        if cached:
            return cached["data"], cached["at"]
        raise LawError("저장된 법령 원문이 없습니다(설정에서 ‘근거 법령 최신 확인’을 한 번 실행하세요).")
    key_oc = oc()
    if not key_oc:
        if cached:
            return cached["data"], cached["at"]
        raise LawError("국가법령정보 인증키(OC)가 설정되지 않았습니다. 설정 → 국가법령정보 연동에서 입력하세요.")
    url = f"{BASE}/{path}?" + urllib.parse.urlencode({"OC": key_oc, "type": "JSON", **params})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daisu/1.0"}), timeout=20) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        if cached:
            return cached["data"], cached["at"] + " (저장본)"
        raise LawError(f"국가법령정보센터에 연결하지 못했습니다(인터넷·방화벽 확인): {getattr(e, 'reason', e)}") from e
    try:
        data = json.loads(raw)
    except ValueError:
        # 인증키가 틀리거나 신청 시 등록한 IP·도메인이 아니면 JSON 대신 안내 페이지가 온다
        hint = re.sub(r"<[^>]+>|\s+", " ", raw)[:160].strip()
        raise LawError("국가법령정보센터가 JSON이 아닌 응답을 보냈습니다. 인증키(OC)와 신청 시 등록한 IP·도메인을 확인하세요."
                       + (f" (응답: {hint})" if hint else ""))
    _cache_put(key, data)
    return data, dt.datetime.now().isoformat(timespec="seconds")


# ───────────── 응답 구조 탐색(키 이름 기준)
def _find_lists(obj, key):
    """중첩 구조에서 key 의 값을 모두 찾는다(리스트·단일 객체 모두 리스트로)."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                out += v if isinstance(v, list) else [v]
            else:
                out += _find_lists(v, key)
    elif isinstance(obj, list):
        for v in obj:
            out += _find_lists(v, key)
    return out


def _first(obj, *keys):
    for k in keys:
        vals = _find_lists(obj, k)
        for v in vals:
            if isinstance(v, (str, int)) and str(v).strip():
                return str(v).strip()
            if isinstance(v, dict) and v.get("content"):
                return str(v["content"]).strip()
    return ""


def _txt(v) -> str:
    if isinstance(v, list):
        return "\n".join(_txt(x) for x in v if x)
    if isinstance(v, dict):
        return _txt(v.get("content", ""))
    return str(v or "").strip()


def search(query: str, target: str = "law", cache_only=False) -> list[dict]:
    data, _ = _get("lawSearch.do", {"target": target, "query": query, "display": 20}, cache_only=cache_only)
    items = _find_lists(data, "law") if target == "law" else _find_lists(data, target)
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append({"name": _txt(it.get("법령명한글") or it.get("행정규칙명") or it.get("자치법규명")),
                    "mst": _txt(it.get("법령일련번호") or it.get("행정규칙일련번호") or it.get("자치법규일련번호")),
                    "id": _txt(it.get("법령ID") or it.get("행정규칙ID")), "effective": _txt(it.get("시행일자")),
                    "promulgated": _txt(it.get("공포일자")), "kind": _txt(it.get("법령구분명") or it.get("법령종류")),
                    "status": _txt(it.get("현행연혁코드"))})
    return out


def law_text(name: str, cache_only=False) -> dict:
    """법령 이름(정확히 일치) → 기본정보 + 조문 목록."""
    found = [x for x in search(name, cache_only=cache_only) if x["name"].replace(" ", "") == name.replace(" ", "")]
    if not found:
        raise LawError(f"‘{name}’을(를) 국가법령정보에서 찾지 못했습니다(법령 이름을 정확히 적었는지 확인).")
    cur = [x for x in found if x["status"] in ("", "현행")] or found
    law = sorted(cur, key=lambda x: x["effective"], reverse=True)[0]
    data, at = _get("lawService.do", {"target": "law", "MST": law["mst"]}, cache_only=cache_only)
    arts = []
    for u in _find_lists(data, "조문단위"):
        if not isinstance(u, dict) or _txt(u.get("조문여부")) not in ("", "조문"):
            continue
        lines = [_txt(u.get("조문내용"))]
        for hang in (u.get("항") if isinstance(u.get("항"), list) else [u.get("항")] if u.get("항") else []):
            if not isinstance(hang, dict):
                continue
            lines.append(_txt(hang.get("항내용")))
            for ho in (hang.get("호") if isinstance(hang.get("호"), list) else [hang.get("호")] if hang.get("호") else []):
                if isinstance(ho, dict):
                    lines.append("  " + _txt(ho.get("호내용")))
                    for mok in (ho.get("목") if isinstance(ho.get("목"), list) else [ho.get("목")] if ho.get("목") else []):
                        if isinstance(mok, dict):
                            lines.append("    " + _txt(mok.get("목내용")))
        arts.append({"jo": _txt(u.get("조문번호")), "branch": _txt(u.get("조문가지번호")) or "0",
                     "title": _txt(u.get("조문제목")), "text": "\n".join(x for x in lines if x),
                     "effective": _txt(u.get("조문시행일자"))})
    effective = _first(data, "시행일자") or law["effective"]
    return {"name": law["name"], "mst": law["mst"], "effective": effective, "promulgated": _first(data, "공포일자") or law["promulgated"],
            "articles": arts, "fetched": at}


def link(name: str, jo: str = "", branch: str = "0") -> str:
    tail = f"/제{jo}조" + (f"의{branch}" if branch not in ("", "0") else "") if jo else ""
    return "https://www.law.go.kr/법령/" + urllib.parse.quote(name) + urllib.parse.quote(tail)


def article(name: str, jo: str, branch: str = "0", cache_only=False) -> dict:
    law = law_text(name, cache_only=cache_only)
    a = next((x for x in law["articles"] if x["jo"] == str(int(jo)) and (x["branch"] or "0") == str(int(branch or 0))), None)
    if not a:
        raise LawError(f"{law['name']} 제{jo}조를 찾지 못했습니다.")
    return {"law": law["name"], "effective": law["effective"], "jo": a["jo"], "branch": a["branch"], "title": a["title"],
            "text": a["text"], "url": link(law["name"], a["jo"], a["branch"]), "fetched": law["fetched"]}


# ───────────── 규칙표의 근거 문자열 → (법령명, 조, 가지)
_REF = re.compile(r"((?:같은 법|[가-힣·\s]+?(?:법률|법))(?:\s*시행령|\s*시행규칙)?)\s*제(\d+)조(?:의(\d+))?")


def refs(law_str: str) -> list[dict]:
    out, last = [], ""
    for m in _REF.finditer(law_str or ""):
        name = re.sub(r"\s+", " ", m.group(1)).strip(" ,·")
        if name.startswith("같은 법"):
            name = last + name[len("같은 법"):]
        else:
            last = re.sub(r"\s*(시행령|시행규칙)$", "", name)
        out.append({"name": name.replace(" 시행", " 시행"), "jo": m.group(2), "branch": m.group(3) or "0"})
    return out


def _status_path():
    return os.path.join(config.WORKSPACE, "law_status.json")


def last_status() -> dict:
    try:
        with open(_status_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def check_rules(rules: dict, fresh: bool = True) -> dict:
    """교육 규칙표의 근거 조문을 모두 조회하고, 지난 확인 때와 시행일자가 다르면 '개정'으로 표시."""
    prev = last_status().get("laws", {})
    results, laws = [], {}
    for c in rules["courses"]:
        for r in refs(c.get("law", "")):
            key = f"{r['name']}|{r['jo']}|{r['branch']}"
            item = {"course": c["name"], "course_id": c["id"], "ref": f"{r['name']} 제{r['jo']}조" + (f"의{r['branch']}" if r["branch"] != "0" else ""),
                    "url": link(r["name"], r["jo"], r["branch"])}
            try:
                if fresh:
                    # 같은 법은 한 번만 새로 받기
                    if r["name"] not in laws:
                        _get_fresh_law(r["name"])
                        laws[r["name"]] = True
                a = article(r["name"], r["jo"], r["branch"])
                old = prev.get(key, {}).get("effective")
                item.update(ok=True, title=a["title"], effective=a["effective"], text=a["text"][:1500],
                            changed=bool(old and old != a["effective"]), before=old or "")
            except LawError as e:
                item.update(ok=False, error=str(e))
            results.append(item)
    status = {"checked": dt.datetime.now().isoformat(timespec="seconds"), "items": results,
              "laws": {f"{i['ref'].split(' 제')[0]}|{_jo(i['ref'])}": {"effective": i.get("effective")} for i in results if i.get("ok")}}
    # 다음 비교 기준은 '확인한' 시행일자. 개정 표시는 담당자가 확인 처리할 때까지 유지
    status["pending"] = sorted({i["ref"] for i in results if i.get("changed")} | set(last_status().get("pending", [])))
    os.makedirs(config.WORKSPACE, exist_ok=True)
    with open(_status_path(), "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=1)
    return status


def _jo(ref: str) -> str:
    m = re.search(r"제(\d+)조(?:의(\d+))?", ref)
    return f"{m.group(1)}|{m.group(2) or '0'}" if m else ""


def _get_fresh_law(name: str) -> None:
    found = [x for x in search(name) if x["name"].replace(" ", "") == name.replace(" ", "")]
    if found:
        law = sorted(found, key=lambda x: x["effective"], reverse=True)[0]
        _get("lawService.do", {"target": "law", "MST": law["mst"]}, fresh=True)


def acknowledge(ref: str | None = None) -> dict:
    st = last_status()
    st["pending"] = [] if ref is None else [x for x in st.get("pending", []) if x != ref]
    os.makedirs(config.WORKSPACE, exist_ok=True)
    with open(_status_path(), "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    return st
