"""문서 파서 모음.

모든 파서는 원본 파일을 '읽기 전용'으로만 연다(공통 개발 규칙: 원본 보호).
반환값은 Segment 목록이며, 각 Segment는 본문과 '출처 위치(where)'를 가진다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from . import office, hwp, mail, pdf, relay, sheet, text


@dataclass
class Segment:
    text: str
    where: str  # 예: "3쪽", "시트 '예산' 5~24행", "문단 12", "메일 본문"
    meta: dict = field(default_factory=dict)


PARSERS = {
    ".hwp": hwp.parse_hwp,
    ".hwpx": hwp.parse_hwpx,
    ".pdf": pdf.parse_pdf,
    ".xlsx": sheet.parse_xlsx,
    ".xlsm": sheet.parse_xlsx,
    ".csv": sheet.parse_csv,
    ".docx": office.parse_docx,
    ".pptx": office.parse_pptx,
    ".eml": mail.parse_eml,
    ".msg": mail.parse_msg,
    ".txt": text.parse_text,
    ".md": text.parse_text,
    ".log": text.parse_text,
    ".baton": relay.parse_baton,
}

SUPPORTED = sorted(PARSERS)


def is_supported(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in PARSERS


def parse_file(path: str) -> tuple[list[Segment], dict]:
    """파일을 파싱해 (segments, info)를 돌려준다. info에는 메일 헤더 등 부가정보."""
    ext = os.path.splitext(path)[1].lower()
    fn = PARSERS.get(ext)
    if fn is None:
        raise ValueError(f"지원하지 않는 형식: {ext}")
    raw_segments, info = fn(path)
    segs = [Segment(t.strip(), w, m) for t, w, m in raw_segments if t and t.strip()]
    return segs, info
