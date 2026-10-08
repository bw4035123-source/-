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


def parse_docx(path: str):
    segs = []
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    for k, t in enumerate((t for t in _paragraph_texts(root, "p", "t") if t.strip()), 1):
        segs.append((t, f"문단 {k}", {}))
    return segs, {"format": "Word"}


def parse_pptx(path: str):
    segs = []
    with zipfile.ZipFile(path) as z:
        slides = sorted(
            (n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=lambda n: int(re.findall(r"\d+", n)[-1]),
        )
        for i, name in enumerate(slides, 1):
            root = ET.fromstring(z.read(name))
            text = "\n".join(t for t in _paragraph_texts(root, "p", "t") if t.strip())
            if text.strip():
                segs.append((text, f"슬라이드 {i}", {}))
    return segs, {"format": "PowerPoint"}
