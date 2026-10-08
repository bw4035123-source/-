"""바통 파일(.baton): 이전 담당자가 넘긴 인수인계서를 다시 근거로 읽는다(지식 릴레이).

한 업무가 여러 사람을 거치며 검증된 내용과 인터뷰 답변이 계속 쌓이도록 한다.
"""
from __future__ import annotations

import json


def parse_baton(path: str):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != "baton/1":
        raise ValueError("업무바통 파일 형식이 아닙니다")
    meta = data.get("meta", {})
    holder = meta.get("from_name") or "이전 담당자"
    segs = []
    for sec in data.get("sections", []):
        for it in sec.get("items", []):
            segs.append((it["text"], f"{holder} 인수인계서 · {sec.get('title', '')}", {}))
    for qa in data.get("interview", []):
        segs.append((f"{qa['q']}\n→ {qa['a']}", f"{holder} 인터뷰 답변", {}))
    info = {"format": "업무바통 파일", "lineage": data.get("lineage", []), "from": [], "to": [],
            "subject": f"{meta.get('name', '')} – {holder} 인수인계서"}
    return segs, info
