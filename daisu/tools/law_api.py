"""국가법령정보 공동활용(law.go.kr) Open API – 로컬 PC에서 바로 실행하는 연동 코드.

다이수 본체(daisu/lawapi.py)는 추가 설치 없이 돌도록 표준 라이브러리로 JSON을 받습니다.
이 파일은 그와 별개로, 담당자 PC에서 인증키가 실제로 동작하는지 확인하고 법령을 검색·조회할 때 쓰는
독립 실행 도구입니다(requests + XML 응답 파싱).

■ 설치
    pip install requests
    (XML 파싱은 파이썬 기본 xml.etree.ElementTree 를 쓰므로 xmltodict·BeautifulSoup 은 필요 없습니다)

■ 인증키(OC) 넣는 방법 – 셋 중 하나(위에서부터 우선)
    1) 명령줄:      python tools/law_api.py --oc 내OC값 search 산업안전보건법
    2) 환경변수:    set LAW_OC=내OC값            (Windows 명령 프롬프트)
                    $env:LAW_OC="내OC값"          (PowerShell)
                    export LAW_OC=내OC값          (macOS·리눅스)
    3) 이 파일 위쪽 OC_DEFAULT 에 직접 적기(다른 사람과 공유하는 파일이면 비워 두세요)
    ※ 다이수 설정 화면에 저장한 키(config/settings.local.json)도 자동으로 읽습니다.
    ※ OC는 open.law.go.kr 신청 시 쓴 이메일의 @ 앞부분(ID)입니다. 신청할 때 등록한 IP·도메인에서만 응답합니다.

■ 사용 예
    python tools/law_api.py search 산업안전보건법
    python tools/law_api.py search 개인정보 --display 5
    python tools/law_api.py law 산업안전보건법                 # 이름으로 찾아 현행 본문 전체
    python tools/law_api.py law 산업안전보건법 --jo 29         # 제29조만
    python tools/law_api.py law --mst 276853 --jo 10-2         # 법령일련번호로, 제10조의2
    python tools/law_api.py law 산업안전보건법 --save 산안법.json   # 파싱 결과 저장
    python tools/law_api.py search 청렴 --raw                  # 받은 XML 원문 그대로 보기(문제 확인용)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET

try:
    import requests
except ImportError:  # 설치 안내 후 종료
    sys.exit("requests 가 없습니다. 먼저 설치하세요:  pip install requests")

# ───────────── 설정(필요하면 여기만 고치세요)
OC_DEFAULT = ""                     # 인증키(OC). 비워 두면 환경변수 LAW_OC → 다이수 설정 순으로 찾습니다.
BASE_URL = "https://www.law.go.kr/DRF"
TIMEOUT = (5, 20)                   # (연결, 응답) 초
RETRIES = 2                         # 시간 초과·일시 오류 시 다시 시도할 횟수
# 기본 User-Agent(python-requests/x.y)는 일부 기관 방화벽·서버에서 막히는 경우가 있어 일반 브라우저 형식으로 보냅니다.
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) daisu-law-client/1.0",
           "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8"}


class LawAPIError(Exception):
    """연결 실패·인증 실패·응답 형식 오류를 한 가지 예외로 알립니다(메시지는 담당자가 읽을 수 있는 한국어)."""


def get_oc(cli_oc: str | None = None) -> str:
    if cli_oc:
        return cli_oc.strip()
    if OC_DEFAULT:
        return OC_DEFAULT.strip()
    if os.environ.get("LAW_OC"):
        return os.environ["LAW_OC"].strip()
    # 다이수 설정 화면에 저장한 값(이 PC에만 있는 파일)
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(here, "..", "config", "settings.local.json"),):
        try:
            with open(p, encoding="utf-8") as f:
                v = (json.load(f).get("law") or {}).get("oc", "")
            if v:
                return v.strip()
        except (OSError, ValueError):
            pass
    return ""


# ───────────── 1. 기본 호출
def call(endpoint: str, params: dict, oc: str) -> ET.Element:
    """law.go.kr DRF 호출 → XML 루트 요소. endpoint 는 'lawSearch.do' 또는 'lawService.do'."""
    if not oc:
        raise LawAPIError("인증키(OC)가 없습니다. --oc 옵션, 환경변수 LAW_OC, 또는 파일 위쪽 OC_DEFAULT 중 하나로 넣어 주세요.")
    q = {"OC": oc, "type": "XML", **{k: v for k, v in params.items() if v not in (None, "")}}
    url = f"{BASE_URL}/{endpoint}"
    last = None
    for attempt in range(RETRIES + 1):
        try:
            r = requests.get(url, params=q, headers=HEADERS, timeout=TIMEOUT)
            break
        except requests.exceptions.Timeout as e:
            last = LawAPIError(f"응답 시간 초과({TIMEOUT[1]}초). 잠시 뒤 다시 시도하거나 인터넷 연결을 확인하세요.")
            last.__cause__ = e
        except requests.exceptions.SSLError as e:
            raise LawAPIError("보안 연결(SSL) 오류입니다. 기관 보안 프로그램이 HTTPS를 가로채는지 전산 담당에게 확인하세요.") from e
        except requests.exceptions.ConnectionError as e:
            last = LawAPIError("law.go.kr 에 연결하지 못했습니다(인터넷·방화벽·프록시 확인). 내부망 PC라면 외부 인터넷 허용이 필요합니다.")
            last.__cause__ = e
        if attempt < RETRIES:
            time.sleep(1.5 * (attempt + 1))
    else:
        raise last

    if r.status_code != 200:
        raise LawAPIError(f"서버가 오류 코드 {r.status_code} 를 보냈습니다. 주소·파라미터를 확인하세요.")
    r.encoding = "utf-8"  # 응답 헤더에 문자 인코딩이 빠지는 경우가 있어 UTF-8로 고정
    text = r.text.strip()
    # 인증키가 틀리거나 신청 시 등록한 IP·도메인이 아니면 XML 대신 HTML 안내 페이지가 옵니다.
    is_html = text[:200].lower().startswith(("<!doctype html", "<html")) or "<html" in text[:200].lower()
    if is_html or not text.startswith("<"):
        hint = re.sub(r"<[^>]+>|\s+", " ", text)[:200].strip()
        raise LawAPIError("XML이 아닌 응답을 받았습니다. 인증키(OC)가 맞는지, 신청 때 등록한 IP·도메인에서 실행하는지 확인하세요."
                          + (f"\n  서버 안내: {hint}" if hint else ""))
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError as e:
        raise LawAPIError(f"XML을 읽지 못했습니다: {e}") from e
    # 일부 오류는 XML 형태로 옵니다(예: <Law>일치하는 법령이 없습니다...</Law>)
    if len(root) == 0 and (root.text or "").strip():
        raise LawAPIError(f"서버 응답: {root.text.strip()}")
    return root


def raw(endpoint: str, params: dict, oc: str) -> str:
    """문제 확인용: 받은 원문 그대로."""
    r = requests.get(f"{BASE_URL}/{endpoint}", params={"OC": oc, "type": "XML", **params}, headers=HEADERS, timeout=TIMEOUT)
    r.encoding = "utf-8"
    return r.text


# ───────────── 3. XML → 딕셔너리
def to_dict(el: ET.Element):
    """XML 요소를 딕셔너리로(xmltodict 와 비슷). 같은 이름 자식이 여러 개면 리스트, 속성은 '@이름'."""
    kids = list(el)
    if not kids:
        txt = (el.text or "").strip()
        return {**{f"@{k}": v for k, v in el.attrib.items()}, "#text": txt} if el.attrib else txt
    out: dict = {f"@{k}": v for k, v in el.attrib.items()}
    for c in kids:
        v = to_dict(c)
        if c.tag in out:
            out[c.tag] = out[c.tag] if isinstance(out[c.tag], list) else [out[c.tag]]
            out[c.tag].append(v)
        else:
            out[c.tag] = v
    return out


def _t(el: ET.Element | None, tag: str) -> str:
    x = el.find(tag) if el is not None else None
    return (x.text or "").strip() if x is not None else ""


# ───────────── 2-1. 법령 검색(lawSearch.do)
def search_law(query: str, oc: str, display: int = 20, page: int = 1, search_body: bool = False) -> dict:
    """현행 법령 목록 검색. search_body=True 면 법령명이 아니라 본문에서 찾습니다."""
    root = call("lawSearch.do", {"target": "law", "query": query, "display": display, "page": page,
                                 "search": 2 if search_body else 1}, oc)
    items = []
    for it in root.iter("law"):
        items.append({
            "법령명": _t(it, "법령명한글"),
            "약칭": _t(it, "법령약칭명"),
            "법령일련번호(MST)": _t(it, "법령일련번호"),
            "법령ID": _t(it, "법령ID"),
            "법령구분": _t(it, "법령구분명"),
            "소관부처": _t(it, "소관부처명"),
            "공포일자": _t(it, "공포일자"),
            "시행일자": _t(it, "시행일자"),
            "제개정구분": _t(it, "제개정구분명"),
            "현행여부": _t(it, "현행연혁코드"),
            "상세링크": ("https://www.law.go.kr" + _t(it, "법령상세링크")) if _t(it, "법령상세링크") else "",
        })
    return {"검색어": _t(root, "키워드") or query, "전체건수": int(_t(root, "totalCnt") or 0),
            "페이지": int(_t(root, "page") or page), "목록": items}


# ───────────── 2-2. 법령 본문 상세(lawService.do)
def jo_code(jo: str) -> str:
    """'29' → '002900', '10-2'·'10의2' → '001002' (조 4자리 + 가지번호 2자리)."""
    m = re.fullmatch(r"\s*제?(\d+)\s*조?\s*(?:(?:-|의)\s*(\d+))?\s*", str(jo))
    if not m:
        raise ValueError(f"조문 번호 형식을 알 수 없습니다: {jo} (예: 29, 10-2, 제10조의2)")
    return f"{int(m.group(1)):04d}{int(m.group(2) or 0):02d}"


def get_law(oc: str, mst: str = "", law_id: str = "", jo: str = "") -> dict:
    """법령 본문. mst(법령일련번호) 또는 law_id(법령ID) 중 하나. jo 를 주면 그 조문만."""
    if not (mst or law_id):
        raise ValueError("mst 또는 law_id 가 필요합니다(검색 결과에 있습니다).")
    params = {"target": "law", "MST": mst} if mst else {"target": "law", "ID": law_id}
    if jo:
        params["JO"] = jo_code(jo)
    root = call("lawService.do", params, oc)
    info = root.find("기본정보")
    basic = {k: _t(info, k) for k in ("법령ID", "법령명_한글", "법령명약칭", "법종구분", "소관부처", "공포일자", "공포번호",
                                       "시행일자", "제개정구분", "연락부서")} if info is not None else {}
    articles = []
    for u in root.iter("조문단위"):
        if _t(u, "조문여부") == "전문":      # 장·절 제목 줄
            articles.append({"구분": "전문", "내용": _t(u, "조문내용")})
            continue
        no, br = _t(u, "조문번호"), _t(u, "조문가지번호")
        a = {"구분": "조문", "조문": f"제{no}조" + (f"의{br}" if br and br != "0" else ""), "제목": _t(u, "조문제목"),
             "시행일자": _t(u, "조문시행일자"), "내용": _t(u, "조문내용"), "항": []}
        for hang in u.findall("항"):
            h = {"번호": _t(hang, "항번호"), "내용": _t(hang, "항내용"), "호": []}
            for ho in hang.findall("호"):
                h["호"].append({"번호": _t(ho, "호번호"), "내용": _t(ho, "호내용"),
                               "목": [{"번호": _t(mok, "목번호"), "내용": _t(mok, "목내용")} for mok in ho.findall("목")]})
            a["항"].append(h)
        articles.append(a)
    return {"기본정보": basic, "조문": articles,
            "부칙수": len(root.findall(".//부칙단위"))}


def article_text(a: dict) -> str:
    """조문 하나를 사람이 읽는 문장으로."""
    if a["구분"] == "전문":
        return f"\n{a['내용']}"
    lines = [a["내용"]] if a["내용"] else [f"{a['조문']}({a['제목']})"]
    for h in a["항"]:
        if h["내용"]:
            lines.append(f"  {h['내용']}")
        for ho in h["호"]:
            lines.append(f"    {ho['내용']}")
            for m in ho["목"]:
                lines.append(f"      {m['내용']}")
    return "\n".join(lines)


def find_law(name: str, oc: str) -> dict:
    """이름으로 검색해 정확히 같은 이름(없으면 첫 번째) 현행 법령을 고릅니다."""
    res = search_law(name, oc, display=20)["목록"]
    if not res:
        raise LawAPIError(f"‘{name}’ 이(가) 이름에 들어간 현행 법령을 찾지 못했습니다.")
    return next((x for x in res if x["법령명"] == name), res[0])


# ───────────── 명령줄
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="국가법령정보(law.go.kr) Open API 검색·본문 조회")
    ap.add_argument("--oc", help="인증키(OC). 없으면 환경변수 LAW_OC 사용")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search", help="법령 검색(lawSearch.do)")
    s.add_argument("query")
    s.add_argument("--display", type=int, default=20)
    s.add_argument("--page", type=int, default=1)
    s.add_argument("--body", action="store_true", help="법령명 대신 본문에서 검색")
    s.add_argument("--raw", action="store_true", help="받은 XML 원문 출력")
    l_ = sub.add_parser("law", help="법령 본문 조회(lawService.do)")
    l_.add_argument("name", nargs="?", default="", help="법령명(정확한 이름 권장)")
    l_.add_argument("--mst", default="", help="법령일련번호")
    l_.add_argument("--id", default="", help="법령ID")
    l_.add_argument("--jo", default="", help="조문 번호(예: 29, 10-2)")
    l_.add_argument("--save", default="", help="파싱 결과를 JSON 파일로 저장")
    l_.add_argument("--raw", action="store_true", help="받은 XML 원문 출력")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows 콘솔 한글 깨짐 방지
    oc = get_oc(a.oc)
    try:
        if a.cmd == "search":
            if a.raw:
                print(raw("lawSearch.do", {"target": "law", "query": a.query, "display": a.display}, oc))
                return 0
            r = search_law(a.query, oc, a.display, a.page, a.body)
            print(f"‘{r['검색어']}’ 검색 결과 {r['전체건수']}건 (페이지 {r['페이지']})")
            for i, x in enumerate(r["목록"], 1):
                print(f"{i:>2}. {x['법령명']} [{x['법령구분']}] 시행 {x['시행일자']} · {x['소관부처']} · MST {x['법령일련번호(MST)']}")
            return 0
        mst, lid = a.mst, a.id
        if not (mst or lid):
            if not a.name:
                ap.error("법령명 또는 --mst/--id 가 필요합니다.")
            hit = find_law(a.name, oc)
            mst = hit["법령일련번호(MST)"]
            print(f"선택: {hit['법령명']} (MST {mst}, 시행 {hit['시행일자']})")
        if a.raw:
            p = {"target": "law", **({"MST": mst} if mst else {"ID": lid}), **({"JO": jo_code(a.jo)} if a.jo else {})}
            print(raw("lawService.do", p, oc))
            return 0
        law = get_law(oc, mst=mst, law_id=lid, jo=a.jo)
        b = law["기본정보"]
        print(f"\n■ {b.get('법령명_한글', '')}  ({b.get('법종구분', '')}, 시행 {b.get('시행일자', '')}, 공포 {b.get('공포일자', '')} 제{b.get('공포번호', '')}호)")
        print(f"  소관: {b.get('소관부처', '')}  · 조문 {sum(1 for x in law['조문'] if x['구분'] == '조문')}개\n")
        for art in law["조문"]:
            print(article_text(art))
        if a.save:
            with open(a.save, "w", encoding="utf-8") as f:
                json.dump(law, f, ensure_ascii=False, indent=1)
            print(f"\n저장했습니다: {a.save}")
        return 0
    except (LawAPIError, ValueError) as e:
        print(f"[오류] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
