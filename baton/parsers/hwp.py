"""한글(HWP 5.x 바이너리 / HWPX) 텍스트 추출.

- HWP 5.x: OLE 복합문서의 BodyText/SectionN 스트림을 (압축 시 raw deflate 해제 후)
  레코드 단위로 읽어 HWPTAG_PARA_TEXT(67)의 UTF-16LE 텍스트를 꺼낸다.
  암호화·배포용 문서 등 본문을 읽지 못하면 미리보기 텍스트(PrvText)로 대체한다.
- HWPX: OWPML(zip+xml)의 Contents/section*.xml 에서 문단(hp:p)별 글자(hp:t)를 모은다.
"""
from __future__ import annotations

import re
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET

HWPTAG_PARA_TEXT = 67

# HWP 제어문자: 아래 코드는 8 WCHAR(16바이트)를 차지하는 인라인/확장 컨트롤
_WIDE_CTRL = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def _para_text(data: bytes) -> str:
    out = []
    i, n = 0, len(data) - 1
    while i < n:
        ch = data[i] | (data[i + 1] << 8)
        if ch < 32:
            if ch in _WIDE_CTRL:
                if ch == 9:
                    out.append("\t")
                i += 16
                continue
            if ch in (10, 13):
                out.append("\n")
            i += 2
            continue
        out.append(chr(ch))
        i += 2
    return "".join(out)


def _records(stream: bytes):
    pos, n = 0, len(stream)
    while pos + 4 <= n:
        (header,) = struct.unpack_from("<I", stream, pos)
        pos += 4
        tag = header & 0x3FF
        size = (header >> 20) & 0xFFF
        if size == 0xFFF:
            if pos + 4 > n:
                break
            (size,) = struct.unpack_from("<I", stream, pos)
            pos += 4
        yield tag, stream[pos:pos + size]
        pos += size


def parse_hwp(path: str):
    import olefile

    segs, info = [], {"format": "HWP 5.x"}
    with olefile.OleFileIO(path) as ole:
        header = ole.openstream("FileHeader").read()
        flags = struct.unpack_from("<I", header, 36)[0] if len(header) >= 40 else 0
        compressed, encrypted = bool(flags & 1), bool(flags & 2)
        sections = sorted(
            (e for e in ole.listdir() if len(e) == 2 and e[0] == "BodyText"),
            key=lambda e: int(re.sub(r"\D", "", e[1]) or 0),
        )
        para_no = 0
        if not encrypted:
            for entry in sections:
                raw = ole.openstream(entry).read()
                try:
                    data = zlib.decompress(raw, -15) if compressed else raw
                except zlib.error:
                    continue
                for tag, body in _records(data):
                    if tag != HWPTAG_PARA_TEXT:
                        continue
                    t = _para_text(body).strip()
                    if t:
                        para_no += 1
                        segs.append((t, f"문단 {para_no}", {}))
        if not segs and ole.exists("PrvText"):
            prv = ole.openstream("PrvText").read().decode("utf-16-le", errors="ignore")
            info["note"] = "본문 대신 미리보기 텍스트로 추출(암호화·배포용 문서 등)"
            for k, line in enumerate(l for l in prv.splitlines() if l.strip()):
                segs.append((line, f"미리보기 {k + 1}행", {}))
    return segs, info


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_hwpx(path: str):
    segs, info = [], {"format": "HWPX"}
    with zipfile.ZipFile(path) as z:
        names = sorted(
            (n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)),
            key=lambda n: int(re.findall(r"\d+", n)[-1]),
        )
        para_no = 0
        for name in names:
            root = ET.fromstring(z.read(name))
            paragraphs: list[str] = []

            # 표 안의 문단처럼 중첩된 hp:p 도 각각 하나의 문단으로 취급
            def walk(el, buf):
                tag = _local(el.tag)
                if tag == "p":
                    mine: list[str] = []
                    for child in el:
                        walk(child, mine)
                    paragraphs.append("".join(mine))
                    return
                if tag == "t":
                    if el.text:
                        buf.append(el.text)
                    for child in el:
                        if _local(child.tag) == "tab":
                            buf.append("\t")
                        if child.tail:
                            buf.append(child.tail)
                    return
                if tag == "lineBreak":
                    buf.append("\n")
                for child in el:
                    walk(child, buf)

            walk(root, [])
            for t in paragraphs:
                if t.strip():
                    para_no += 1
                    segs.append((t, f"문단 {para_no}", {}))
        if not segs and "Preview/PrvText.txt" in z.namelist():
            prv = z.read("Preview/PrvText.txt").decode("utf-8", errors="ignore")
            for k, line in enumerate(l for l in prv.splitlines() if l.strip()):
                segs.append((line, f"미리보기 {k + 1}행", {}))
    return segs, info
