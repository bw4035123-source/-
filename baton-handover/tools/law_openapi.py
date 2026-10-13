"""국가법령정보 공동활용(law.go.kr) Open API 실사용 클라이언트 — 업무바통 연동용.

내 PC(인터넷이 되고 www.law.go.kr 접속이 허용된 곳)에서 바로 실행한다.

설치
    pip install requests            # 필수
    pip install xmltodict           # 선택: 응답 전체를 딕셔너리로 보고 싶을 때(없으면 표준 라이브러리로 변환)

인증키(OC)
    아래 OC 변수 또는 환경변수 LAW_OC 로 넣는다(환경변수가 우선).
      Windows(cmd)      set LAW_OC=bw40351
      Windows(PowerShell) $env:LAW_OC="bw40351"
      macOS·Linux       export LAW_OC=bw40351

실행 예
    python tools/law_openapi.py check                         # 인증키·접속 점검
    python tools/law_openapi.py search 체육시설                # 법령 이름으로 찾기
    python tools/law_openapi.py search 수질 --body            # 본문에 '수질'이 든 법령 찾기
    python tools/law_openapi.py law --mst 123456              # 법령 전체 조문
    python tools/law_openapi.py law --mst 123456 --jo 3       # 제3조만
    python tools/law_openapi.py law --id 001234 --jo 10-2     # 제10조의2 (법령ID로)
    python tools/law_openapi.py search 지방자치법 --raw        # 받은 XML을 딕셔너리로 그대로 보기

다른 코드에서 쓰기
    from tools.law_openapi import search_laws, get_law
    for x in search_laws("지방계약법")["items"]:
        print(x["법령명"], x["시행일자"], x["MST"])
    law = get_law(mst="123456", jo="3")
    print(law["조문"][0]["본문"])

응답 특성(반영한 것)
    - type=XML 로 받아 파싱한다(JSON보다 필드 이름이 안정적이다).
    - 인증 실패·미등록 IP 등은 오류 코드 대신 HTML/짧은 XML 안내문으로 온다 → 내용을 읽어 LawApiError 로 알린다.
    - 결과가 1건이면 목록이 아니라 한 건만 오는 등 모양이 바뀌므로 태그를 직접 찾아 읽는다.
    - 기본 User-Agent(python-requests)는 일부 기관망·웹방화벽에서 막히는 경우가 있어 브라우저형 값을 넣는다.
    - 접속 5초·응답 20초 제한, 시간 초과·일시 오류(5xx)는 2번까지 다시 시도한다.
"""
import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET

import requests

# ------------------------------------------------------------------ 설정(여기만 바꾸면 된다)
OC = os.environ.get("LAW_OC", "bw40351")          # 국가법령정보 공동활용에서 승인받은 인증키
BASE_URL = os.environ.get("LAW_API_BASE", "https://www.law.go.kr/DRF")
TIMEOUT = (5, 20)                                 # (접속, 응답) 초
RETRIES = 2                                       # 시간 초과·5xx 때 다시 시도하는 횟수
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36 BatonHandover/1.0",
    "Accept": "application/xml, text/xml;q=0.9, */*;q=0.5",
    "Accept-Language": "ko-KR,ko;q=0.9",
}
TARGETS = {"law": "현행 법령", "eflaw": "시행일 법령", "admrul": "행정규칙", "ordin": "자치법규"}


class LawApiError(Exception):
    """법령 API가 결과 대신 오류·안내를 돌려줬거나, 접속하지 못했을 때."""


# ------------------------------------------------------------------ 1. 기본 호출
_session = requests.Session()
_session.headers.update(HEADERS)


def call_drf(endpoint, params, oc=None):
    """DRF 엔드포인트(lawSearch.do·lawService.do)를 불러 XML 문자열을 돌려준다.

    - OC·type=XML 은 자동으로 붙인다.
    - 시간 초과·접속 끊김·5xx 는 RETRIES 만큼 다시 시도(1초, 2초 쉬고).
    - 결과가 XML이 아니면(인증 실패 안내 HTML 등) 안내 문구를 뽑아 LawApiError 로 올린다.
    """
    oc = (oc or OC or "").strip()
    if not oc:
        raise LawApiError("인증키(OC)가 없습니다. 파일 위쪽 OC 변수나 환경변수 LAW_OC 를 설정하세요.")
    query = {"OC": oc, "type": "XML", **{k: v for k, v in params.items() if v not in (None, "")}}
    url = f"{BASE_URL.rstrip('/')}/{endpoint}"
    last = None
    for attempt in range(RETRIES + 1):
        try:
            r = _session.get(url, params=query, timeout=TIMEOUT)
            if r.status_code >= 500:
                raise requests.HTTPError(f"서버 오류 {r.status_code}", response=r)
            r.raise_for_status()
            r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
            text = r.text.strip()
            _check_payload(text)
            return text
        except requests.Timeout as e:
            last = LawApiError(f"응답 시간 초과({TIMEOUT[1]}초). 잠시 뒤 다시 시도하세요.")
            last.__cause__ = e
        except requests.ConnectionError as e:
            last = LawApiError("www.law.go.kr 에 접속하지 못했습니다. 인터넷 연결, 기관 방화벽(www.law.go.kr 허용), 프록시 설정을 확인하세요.")
            last.__cause__ = e
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else "?"
            if isinstance(code, int) and code < 500:
                raise LawApiError(f"법령 API HTTP 오류 {code}") from e
            last = LawApiError(f"법령 API 서버 오류({code}). 잠시 뒤 다시 시도하세요.")
            last.__cause__ = e
        if attempt < RETRIES:
            time.sleep(2 ** attempt)
    raise last


def _check_payload(text):
    """정상 XML인지 본다. 인증 실패·IP 미등록 같은 안내는 HTML이나 짧은 문구로 온다."""
    if not text:
        raise LawApiError("법령 API가 빈 응답을 보냈습니다.")
    head = text[:300].lower()
    if head.startswith("<!doctype html") or "<html" in head:
        msg = re.sub(r"<script.*?</script>|<style.*?</style>", " ", text, flags=re.S | re.I)
        msg = re.sub(r"<[^>]+>", " ", msg)
        msg = re.sub(r"\s+", " ", msg).strip()[:200]
        raise LawApiError(f"법령 API가 결과 대신 안내 페이지를 보냈습니다: {msg or '(내용 없음)'}\n"
                          "→ 인증키(OC), 신청한 API 종류(법령 등), 신청 때 등록한 서버 IP·도메인을 확인하세요.")
    if not text.startswith("<"):
        raise LawApiError(f"법령 API 안내: {text[:200]}")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise LawApiError(f"XML을 읽지 못했습니다: {e}") from e
    # 일부 오류는 <result>·<msg> 같은 짧은 XML로 온다
    if root.tag.lower() in ("result", "error", "response") and not list(root.iter("law")):
        msg = " ".join(t.strip() for t in root.itertext() if t.strip())
        if msg:
            raise LawApiError(f"법령 API 안내: {msg[:200]}")


# ------------------------------------------------------------------ 3. XML → 딕셔너리
def xml_to_dict(text):
    """응답 XML 전체를 딕셔너리로. xmltodict 가 있으면 쓰고, 없으면 표준 라이브러리로 같은 모양을 만든다."""
    try:
        import xmltodict
        return xmltodict.parse(text)
    except ImportError:
        root = ET.fromstring(text)
        return {root.tag: _el_to_dict(root)}


def _el_to_dict(el):
    kids = list(el)
    if not kids and not el.attrib:
        return (el.text or "").strip()
    d = {f"@{k}": v for k, v in el.attrib.items()}
    for c in kids:
        v = _el_to_dict(c)
        if c.tag in d:  # 같은 태그가 여러 번이면 목록으로
            if not isinstance(d[c.tag], list):
                d[c.tag] = [d[c.tag]]
            d[c.tag].append(v)
        else:
            d[c.tag] = v
    text = (el.text or "").strip()
    if text:
        d["#text"] = text
    return d


def _t(el, tag):
    """하위 태그 글자(없으면 빈 문자열). CDATA·앞뒤 공백 정리."""
    x = el.find(tag)
    return re.sub(r"[ \t]+", " ", "".join(x.itertext())).strip() if x is not None else ""


def _date(s):
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if re.fullmatch(r"\d{8}", s or "") else (s or "")


# ------------------------------------------------------------------ 2-1. 법령 검색(lawSearch.do)
def search_laws(query, target="law", display=20, page=1, body=False, sort=None, oc=None):
    """법령 이름(또는 본문)으로 찾기.

    query   찾을 말(예: '체육시설', '지방계약법')
    target  law(현행 법령)·eflaw(시행일 법령)·admrul(행정규칙)·ordin(자치법규)
    display 한 번에 받을 개수(최대 100), page 쪽 번호
    body    True 면 본문 검색(search=2), False 면 이름 검색(search=1)
    sort    lasc·ldes(법령명), dasc·ddes(공포일자), efasc·efdes(시행일자) 등
    반환 {"total": 전체 건수, "page": 쪽, "items": [{법령명, MST, 법령ID, 구분, 소관부처, 공포일자, 시행일자, 제개정, 링크}]}
    """
    if target not in TARGETS:
        raise ValueError(f"target 은 {', '.join(TARGETS)} 중 하나여야 합니다")
    xml = call_drf("lawSearch.do", {"target": target, "query": query, "display": min(int(display), 100),
                                    "page": page, "search": 2 if body else 1, "sort": sort}, oc)
    root = ET.fromstring(xml)
    items = []
    # 법령은 <law>, 행정규칙은 <admrul>, 자치법규는 <law> 또는 <ordin> 등으로 온다
    for el in root:
        if el.tag in ("totalCnt", "page", "target", "키워드", "section", "resultCode", "resultMsg", "numOfRows"):
            continue
        name = _t(el, "법령명한글") or _t(el, "행정규칙명") or _t(el, "자치법규명") or _t(el, "법령명")
        if not name:
            continue
        link = _t(el, "법령상세링크") or _t(el, "행정규칙상세링크") or _t(el, "자치법규상세링크")
        items.append({
            "법령명": name,
            "약칭": _t(el, "법령약칭명"),
            "MST": _t(el, "법령일련번호") or _t(el, "행정규칙일련번호") or _t(el, "자치법규일련번호"),
            "법령ID": _t(el, "법령ID") or _t(el, "행정규칙ID") or _t(el, "자치법규ID"),
            "구분": _t(el, "법령구분명") or _t(el, "행정규칙종류") or _t(el, "자치법규종류"),
            "소관부처": _t(el, "소관부처명") or _t(el, "지자체기관명"),
            "공포일자": _date(_t(el, "공포일자") or _t(el, "발령일자")),
            "시행일자": _date(_t(el, "시행일자")),
            "제개정": _t(el, "제개정구분명"),
            "링크": ("https://www.law.go.kr" + link) if link.startswith("/") else link,
        })
    total = _t(root, "totalCnt")
    return {"total": int(total) if total.isdigit() else len(items), "page": page, "items": items}


# ------------------------------------------------------------------ 2-2. 법령 본문 조회(lawService.do)
def jo_code(jo):
    """'3' → '000300'(제3조), '10-2'·'10의2' → '001002'(제10조의2). 이미 6자리면 그대로."""
    jo = str(jo).strip()
    if re.fullmatch(r"\d{6}", jo):
        return jo
    m = re.fullmatch(r"제?\s*(\d{1,4})\s*조?\s*(?:(?:-|의)\s*(\d{1,2}))?", jo)
    if not m:
        raise ValueError("조 번호는 3, 10-2, 10의2, 001002 같은 꼴로 넣어 주세요")
    return f"{int(m.group(1)):04d}{int(m.group(2) or 0):02d}"


def get_law(mst=None, law_id=None, jo=None, target="law", ef_date=None, oc=None):
    """법령 본문(기본정보 + 조문) 조회.

    mst     법령일련번호(검색 결과의 'MST'). 특정 시점 버전을 가리킨다
    law_id  법령ID(검색 결과의 '법령ID'). 현행 버전을 가리킨다. mst 와 law_id 중 하나만
    jo      특정 조만(예: 3, '10-2'). 없으면 전체 조문
    ef_date 시행일 법령(target='eflaw')을 볼 때 시행일자(YYYYMMDD)
    반환 {"기본정보": {...}, "조문": [{조문번호, 가지번호, 조문제목, 시행일자, 본문, 항:[...]}], "부칙": [...], "개정이유": str}
    """
    if not (mst or law_id) or (mst and law_id):
        raise ValueError("mst(법령일련번호)와 law_id(법령ID) 중 하나만 넣어 주세요")
    params = {"target": target, "MST": mst, "ID": law_id, "efYd": ef_date}
    if jo:
        params["JO"] = jo_code(jo)
    root = ET.fromstring(call_drf("lawService.do", params, oc))
    info_el = root.find("기본정보")
    info = {}
    if info_el is not None:
        for c in info_el:
            v = re.sub(r"\s+", " ", "".join(c.itertext())).strip()
            info[c.tag] = _date(v) if c.tag.endswith("일자") else v
    articles = []
    for u in root.iter("조문단위"):
        if _t(u, "조문여부") == "전문":  # '제1장 총칙' 같은 장·절 제목
            articles.append({"조문번호": "", "가지번호": "", "조문제목": _t(u, "조문내용"), "시행일자": "", "본문": _t(u, "조문내용"),
                             "항": [], "장절": True})
            continue
        paras = []
        for p in u.findall("항"):
            items = []
            for h in p.findall("호"):
                items.append({"호번호": _t(h, "호번호"), "호내용": _t(h, "호내용"),
                              "목": [{"목번호": _t(m, "목번호"), "목내용": _t(m, "목내용")} for m in h.findall("목")]})
            paras.append({"항번호": _t(p, "항번호"), "항내용": _t(p, "항내용"), "호": items})
        # 항 없이 바로 호가 오는 조문도 있다
        loose = [{"호번호": _t(h, "호번호"), "호내용": _t(h, "호내용"),
                  "목": [{"목번호": _t(m, "목번호"), "목내용": _t(m, "목내용")} for m in h.findall("목")]} for h in u.findall("호")]
        if loose:
            paras.append({"항번호": "", "항내용": "", "호": loose})
        art = {"조문번호": _t(u, "조문번호"), "가지번호": _t(u, "조문가지번호"), "조문제목": _t(u, "조문제목"),
               "시행일자": _date(_t(u, "조문시행일자")), "항": paras, "장절": False}
        art["본문"] = _article_text(_t(u, "조문내용"), paras)
        articles.append(art)
    addenda = [{"공포일자": _date(_t(b, "부칙공포일자")), "공포번호": _t(b, "부칙공포번호"), "내용": _t(b, "부칙내용")}
               for b in root.iter("부칙단위")]
    reason = " ".join(t.strip() for e in root.iter("제개정이유내용") for t in e.itertext() if t.strip())
    if not info and not articles:
        raise LawApiError("본문을 찾지 못했습니다. MST·법령ID 와 조 번호를 확인하세요.")
    return {"기본정보": info, "조문": articles, "부칙": addenda, "개정이유": reason}


def _article_text(head, paras):
    """조문내용 + 항·호·목을 사람이 읽는 한 덩어리 글로."""
    lines = [head] if head else []
    for p in paras:
        if p["항내용"]:
            lines.append(p["항내용"])
        for h in p["호"]:
            lines.append("  " + h["호내용"])
            for m in h["목"]:
                lines.append("    " + m["목내용"])
    return "\n".join(x for x in lines if x.strip())


def article_title(a):
    no = f"제{a['조문번호']}조" + (f"의{a['가지번호']}" if a.get("가지번호") not in ("", "0", None) else "")
    return f"{no}({a['조문제목']})" if a.get("조문제목") else no


# ------------------------------------------------------------------ 실행(명령줄)
def main(argv=None):
    ap = argparse.ArgumentParser(description="국가법령정보 공동활용 Open API(law.go.kr) 조회")
    ap.add_argument("--oc", help="인증키(OC). 없으면 환경변수 LAW_OC 또는 파일 위쪽 OC 값")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search", help="법령 찾기(lawSearch.do)")
    s.add_argument("query")
    s.add_argument("--target", default="law", choices=list(TARGETS))
    s.add_argument("--display", type=int, default=10)
    s.add_argument("--page", type=int, default=1)
    s.add_argument("--body", action="store_true", help="본문 검색")
    s.add_argument("--raw", action="store_true", help="받은 XML을 딕셔너리로 그대로 출력")
    g = sub.add_parser("law", help="법령 본문(lawService.do)")
    g.add_argument("--mst")
    g.add_argument("--id")
    g.add_argument("--jo", help="조 번호(예: 3, 10-2)")
    g.add_argument("--target", default="law", choices=list(TARGETS))
    g.add_argument("--json", action="store_true", help="결과를 JSON으로 출력")
    sub.add_parser("check", help="인증키·접속 점검")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "check":
            r = search_laws("지방자치법", display=1, oc=a.oc)
            print(f"정상: 인증키({(a.oc or OC)[:3]}…)로 검색됨 — '{r['items'][0]['법령명'] if r['items'] else '결과 없음'}' 외 {r['total']}건")
        elif a.cmd == "search":
            if a.raw:
                xml = call_drf("lawSearch.do", {"target": a.target, "query": a.query, "display": a.display, "page": a.page,
                                                "search": 2 if a.body else 1}, a.oc)
                print(json.dumps(xml_to_dict(xml), ensure_ascii=False, indent=2))
                return 0
            r = search_laws(a.query, a.target, a.display, a.page, a.body, oc=a.oc)
            print(f"'{a.query}' {TARGETS[a.target]} {r['total']}건 (쪽 {r['page']})")
            for i, x in enumerate(r["items"], 1):
                print(f"{i:>2}. {x['법령명']} [{x['구분']}] 소관 {x['소관부처'] or '-'} · 시행 {x['시행일자'] or '-'} · MST {x['MST']} · ID {x['법령ID']}")
        else:
            law = get_law(a.mst, a.id, a.jo, a.target, oc=a.oc)
            if a.json:
                print(json.dumps(law, ensure_ascii=False, indent=2))
                return 0
            b = law["기본정보"]
            print(f"{b.get('법령명_한글') or b.get('법령명한글', '')} (시행 {b.get('시행일자', '-')}, 공포 {b.get('공포일자', '-')}, 소관 {b.get('소관부처', '-')})")
            for art in law["조문"]:
                print()
                print(art["본문"] if art["장절"] else f"{article_title(art)}\n{art['본문']}")
    except LawApiError as e:
        print(f"[법령 API] {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"[입력] {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
