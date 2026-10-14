"""상황 서술에서 사실관계 단서 추출(규칙기반) — Next.js 판 lib/answer/facts.ts 와 동일"""
from __future__ import annotations

import re

PARTIES = [
    (r"집주인|임대인|건물주", "임대인(집주인)"),
    (r"세입자|임차인|전세\s*들|월세\s*들", "임차인(세입자)"),
    (r"회사|사장|사업주|대표|사용자", "사용자(회사)"),
    (r"근로자|직원|알바|아르바이트", "근로자"),
    (r"윗집|위층|아랫집|아래층|옆집|이웃", "이웃 세대"),
    (r"관리사무소|관리실|관리소", "관리주체(관리사무소)"),
    (r"구청|시청|주민센터|행정기관|공무원|기관", "행정기관"),
    (r"경찰", "경찰"),
    (r"중개사|부동산", "공인중개사"),
]

ACTS = [
    (r"안\s*돌려|못\s*받|안\s*줘|반환하지|돌려주지|지급하지", "금전 미지급·미반환"),
    (r"소음|시끄|쿵쿵|발소리", "소음 피해"),
    (r"해고|잘렸|짤렸|나가라|나오지\s*말라|나오지\s*마라", "해고"),
    (r"퇴사|퇴직|그만뒀|그만두", "퇴사"),
    (r"사기|속였|속아|기망|잠적|연락\s*두절", "기망·연락 두절 정황"),
    (r"경매|공매", "경매·공매 진행"),
    (r"음주|술.*운전|운전.*술", "음주운전"),
    (r"거부|반려|불허|비공개", "거부·비공개 처분"),
    (r"육아휴직|출산", "육아휴직·출산"),
    (r"계약", "계약 체결·종료"),
    (r"이사", "이사(전출입)"),
]

_AMOUNT = re.compile(r"(\d[\d,.]*\s*(?:억|천만|백만|만)(?:\s*\d[\d,]*\s*(?:천만|백만|만))?\s*원?|\d{1,3}(?:,\d{3})+\s*원)")
_PERIOD = re.compile(r"(\d+\s*(?:년|개월|달|주|일|시간)\s*(?:째|전|후|동안|이상|이내|넘게)?)")
_WHEN = re.compile(r"(어제|오늘|지난주|지난달|작년|올해|이번 달|새벽|밤마다|매일|주말마다)")
_BAC = re.compile(r"(0\.\d+\s*%)")
_PLACE = re.compile(r"(아파트|빌라|오피스텔|다세대|원룸|회사|사무실)")


def extract_facts(text: str) -> list[dict]:
    out: list[dict] = []

    def add(kind, value):
        if not any(f["kind"] == kind and f["value"] == value for f in out):
            out.append({"kind": kind, "value": value})

    for pat, label in PARTIES:
        if re.search(pat, text):
            add("당사자", label)
    for m in _AMOUNT.finditer(text):
        add("금액", re.sub(r"원?$", "원", re.sub(r"\s+", "", m.group(1)), count=1))
    for m in _PERIOD.finditer(text):
        add("기간·시점", re.sub(r"\s+", " ", m.group(1)).strip())
    for m in _WHEN.finditer(text):
        add("기간·시점", m.group(1))
    for m in _BAC.finditer(text):
        add("행위·사건", "혈중알코올농도 " + re.sub(r"\s", "", m.group(1)))
    for pat, label in ACTS:
        if re.search(pat, text):
            add("행위·사건", label)
    for m in _PLACE.finditer(text):
        add("장소", m.group(1))
    return out[:16]
