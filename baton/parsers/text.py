"""텍스트·마크다운 메모."""
from __future__ import annotations


def read_text(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "cp949", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse_text(path: str):
    body = read_text(path)
    segs, buf, start = [], [], 1
    lines = body.splitlines()
    for no, line in enumerate(lines, 1):
        if line.strip():
            if not buf:
                start = no
            buf.append(line)
        if (not line.strip() or no == len(lines)) and buf:
            end = start + len(buf) - 1
            segs.append(("\n".join(buf), f"{start}행" if start == end else f"{start}~{end}행", {}))
            buf = []
    return segs, {"format": "텍스트"}
