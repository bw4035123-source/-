"""규정 문서 → 구조화된 청크(LangChain Document).

조(條) 단위로 먼저 자르고, 긴 조문만 항(①②…) 경계에서 다시 나눈다. 청크마다 메타데이터를 붙여
검색 결과가 '어느 법령 몇 조 몇 항, 언제 시행본'인지 바로 근거로 쓸 수 있게 한다.

    law_name · article(제5조) · article_title · paragraphs(['①','②']) · effective_date(ISO) ·
    version_key(law_name|article: 같은 조문의 신·구판을 묶는 키) · chunk_id · source
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .parser import ART, CIRCLED

EFFECTIVE = re.compile(r"시행\s*(?:일)?\s*[:：]?\s*(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")


def find_effective_date(text: str) -> dt.date | None:
    """문서 머리의 '시행 2026. 1. 1.' 을 읽는다."""
    m = EFFECTIVE.search(text[:2000])
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def split_regulation(text: str, law_name: str, effective_date: dt.date | None = None, source: str = "",
                     chunk_size: int = 600, chunk_overlap: int = 60) -> list[Document]:
    eff = effective_date or find_effective_date(text)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap, keep_separator=True,
        separators=[f"\n{c}" for c in CIRCLED] + ["\n", "다. ", ". ", " "])
    arts = list(ART.finditer(text))
    pieces: list[tuple[str, str, str]] = []
    if not arts:
        pieces.append(("", "", text))
    else:
        if text[:arts[0].start()].strip():
            pieces.append(("", "머리말", text[:arts[0].start()]))
        for i, a in enumerate(arts):
            pieces.append((a.group(1), a.group(4) or "", text[a.start(): arts[i + 1].start() if i + 1 < len(arts) else len(text)]))
    docs = []
    for art, title, body in pieces:
        body = body.strip()
        if not body:
            continue
        parts = [body] if len(body) <= chunk_size else splitter.split_text(body)
        for k, part in enumerate(parts):
            # 잘린 뒤쪽 조각에도 '어느 조문'인지 머리를 달아 검색·인용이 끊기지 않게
            content = part if k == 0 or not art else f"{art}({title}) … {part.strip()}"
            meta = {"law_name": law_name, "article": art, "article_title": title,
                    "paragraphs": [c for c in CIRCLED if c in part],
                    "effective_date": eff.isoformat() if eff else None,
                    "version_key": f"{law_name}|{art}" if art else f"{law_name}|{title}",
                    "source": source, "part": k}
            meta["chunk_id"] = hashlib.sha1(f"{law_name}|{eff}|{art}|{k}|{part}".encode()).hexdigest()[:12]
            docs.append(Document(page_content=content.strip(), metadata=meta))
    return docs
