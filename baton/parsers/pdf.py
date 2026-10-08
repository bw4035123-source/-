"""PDF 텍스트 추출(쪽 단위)."""
from __future__ import annotations


def parse_pdf(path: str):
    from pypdf import PdfReader

    reader = PdfReader(path)
    info = {"format": "PDF", "pages": len(reader.pages)}
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            info["note"] = "암호가 걸린 PDF"
            return [], info
    segs = []
    for i, page in enumerate(reader.pages, 1):
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t.strip():
            segs.append((t, f"{i}쪽", {"page": i}))
    if not segs:
        info["note"] = "텍스트가 없는 PDF(스캔본일 수 있음, OCR 필요)"
    return segs, info
