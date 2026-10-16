"""내장 법령 데이터(Next.js 판 lib/law-api/mock 에서 내보낸 JSON)와 조문 유틸"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

_DIR = Path(__file__).resolve().parent / "data"


def _load(name: str):
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


_laws = _load("laws.json")
DATASET_DATE: str = _laws["datasetDate"]
LAWS: list[dict] = _laws["laws"]
TOPICS: list[dict] = _load("topics.json")
PERSPECTIVES: dict = _load("perspectives.json")

_BY_ID = {l["id"]: l for l in LAWS}
_BY_NAME = {l["name"].replace(" ", ""): l for l in LAWS}


def get_law(law_id: str) -> dict | None:
    return _BY_ID.get(law_id)


def get_law_by_name(name: str) -> dict | None:
    return _BY_NAME.get(name.replace(" ", ""))


def get_topic(topic_id: str) -> dict | None:
    return next((t for t in TOPICS if t["id"] == topic_id), None)


def article_key(law_id: str, no: str) -> str:
    return f"{law_id}:{no}"


def parse_key(key: str):
    i = key.find(":")
    if i <= 0:
        return None
    return key[:i], key[i + 1:]


def article_label(no: str) -> str:
    if not no[:1].isdigit():  # 조문 형식이 아닌 행정규칙 본문 등
        return no
    main, _, branch = no.partition("의")
    return f"제{main}조" + (f"의{branch}" if branch else "")


def law_go_kr_url(name: str, no: str | None = None) -> str:
    base = "https://www.law.go.kr/법령/" + quote(name)
    return f"{base}/{quote(article_label(no))}" if no else base


def to_citation(law: dict, art: dict) -> dict:
    return {
        "key": article_key(law["id"], art["no"]),
        "lawId": law["id"],
        "lawName": law["name"],
        "lawKind": law["kind"],
        "articleNo": art["no"],
        "title": art["title"],
        "text": art["text"],
        "url": law_go_kr_url(law["name"], art["no"]),
        "source": law.get("source", "mock"),
    }


def article_exists(key: str) -> bool:
    p = parse_key(key)
    if not p:
        return False
    law = get_law(p[0])
    return bool(law and any(a["no"] == p[1] for a in law["articles"]))
