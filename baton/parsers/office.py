"""DOCX·PPTX: 표준 라이브러리(zip+xml)만으로 텍스트 추출."""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _paragraph_texts(root, p_tag: str, t_tag: str):
    for p in root.iter():
        if _local(p.tag) != p_tag:
            continue
        buf = []
        for el in p.iter():
            name = _local(el.tag)
            if name == t_tag and el.text:
                buf.append(el.text)
            elif name == "tab":
                buf.append("\t")
            elif name in ("br", "cr"):
                buf.append("\n")
        yield "".join(buf)


def _cell_text(tc) -> str:
    paras = ["".join(t.text or "" for t in p.iter() if _local(t.tag) == "t") for p in tc.iter() if _local(p.tag) == "p"]
    return ", ".join(x.strip() for x in paras if x.strip())


def parse_docx(path: str):
    """문단과 표를 문서 순서대로 읽는다. 표는 '머리글: 값' 행 문장으로 바꾼다."""
    from .sheet import table_rows

    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    body = next((el for el in root if _local(el.tag) == "body"), root)
    segs, para_no, tbl_no = [], 0, 0
    for el in body:
        tag = _local(el.tag)
        if tag == "p":
            t = next(_paragraph_texts(el, "p", "t"), "")
            if t.strip():
                para_no += 1
                segs.append((t, f"문단 {para_no}", {}))
        elif tag == "tbl":
            tbl_no += 1
            rows = [[_cell_text(tc) for tc in tr if _local(tc.tag) == "tc"] for tr in el if _local(tr.tag) == "tr"]
            titles, lines, _, first = table_rows(rows)
            for k, line in enumerate(titles + lines):
                segs.append((line, f"표 {tbl_no} {k + 1}행", {}))
    return segs, {"format": "Word"}


def parse_pptx(path: str):
    """슬라이드 본문과 발표자 메모를 함께 읽는다(메모에 실무 노하우가 자주 있음)."""
    segs = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        slides = sorted(
            (n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=lambda n: int(re.findall(r"\d+", n)[-1]),
        )
        for i, name in enumerate(slides, 1):
            root = ET.fromstring(z.read(name))
            text = "\n".join(t for t in _paragraph_texts(root, "p", "t") if t.strip())
            if text.strip():
                segs.append((text, f"슬라이드 {i}", {}))
            num = re.findall(r"\d+", name)[-1]
            note = f"ppt/notesSlides/notesSlide{num}.xml"
            if note in names:
                nroot = ET.fromstring(z.read(note))
                ntext = "\n".join(t for t in _paragraph_texts(nroot, "p", "t") if t.strip() and not t.strip().isdigit())
                if ntext.strip():
                    segs.append((ntext, f"슬라이드 {i} 발표자 메모", {}))
    return segs, {"format": "PowerPoint"}
