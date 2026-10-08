"""자료 투입: 폴더 탐색 → 원본 해시 기록 → 파싱 → 민감정보 가림 → 근거조각(청크) 생성 → 문서 성격 분류."""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import re

from .parsers import is_supported, parse_file

CHUNK_MAX = 700  # 근거조각 최대 글자 수
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".baton"}

KIND_LABEL = {
    "official": "공식문서",
    "data": "데이터·대장",
    "doc": "일반문서",
    "mail": "메일",
    "memo": "개인메모",
    "relay": "이전 인수인계",
}
# 신뢰 등급(높을수록 공식 근거) – 공식 문서와 개인 메모를 구분해 표시하기 위함
KIND_TRUST = {"official": 3, "data": 3, "relay": 2, "doc": 2, "mail": 1, "memo": 0}

_OFFICIAL_NAME = re.compile(r"공문|시행|계획|보고|결과|지침|규정|훈령|예규|조례|업무분장|분장표|매뉴얼|편람|협약|계약|회의록|대장|현황")
_OFFICIAL_BODY = re.compile(r"수\s*신\s*[:：]?|시행\s*[가-힣]*\s*-?\d|문서번호|기\s*안\s*자|결\s*재|붙\s*임|끝\.")
_MEMO_NAME = re.compile(r"메모|memo|노트|note|todo|to-do|할\s*일|개인\s*(?:메모|노트|정리)|팁|tip", re.I)

SENSITIVE = [
    (re.compile(r"\b\d{6}\s*-\s*[1-4]\d{6}\b"), "[주민등록번호 가림]"),
    (re.compile(r"(비밀번호|패스워드|password|passwd|PW|P/W|암호)(\s*[:：=]\s*)([^\s,;)]{3,})", re.I),
     r"\1: [가림 – 별도 전달]"),
    (re.compile(r"\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b"), "[휴대전화 가림]"),
    (re.compile(r"\b\d{3,6}-\d{2,6}-\d{4,8}(?=\s*(\(|계좌|은행))"), "[계좌번호 가림]"),
]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def mask_sensitive(text: str) -> tuple[str, int]:
    count = 0
    for pat, rep in SENSITIVE:
        text, n = pat.subn(rep, text)
        count += n
    return text, count


def classify(rel: str, ext: str, text: str) -> str:
    name = os.path.basename(rel)
    if ext in (".eml", ".msg"):
        return "mail"
    if ext == ".baton":
        return "relay"
    if ext in (".txt", ".md"):
        return "memo"
    if ext in (".xlsx", ".xlsm", ".csv"):
        return "data"
    if _OFFICIAL_NAME.search(name) or len(_OFFICIAL_BODY.findall(text[:4000])) >= 2:
        return "official"
    if _MEMO_NAME.search(name):
        return "memo"
    return "doc"


def list_files(root: str) -> list[str]:
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        for fn in sorted(files):
            if fn.startswith(("~$", ".")):
                continue
            out.append(os.path.join(d, fn))
    return out


def _split(text: str, limit: int = CHUNK_MAX) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts, buf = [], ""
    for piece in re.split(r"(?<=[.다요음함됨\n])\s+", text):
        if len(buf) + len(piece) + 1 > limit and buf:
            parts.append(buf)
            buf = ""
        while len(piece) > limit:
            parts.append(piece[:limit])
            piece = piece[limit:]
        buf = f"{buf} {piece}".strip() if buf else piece
    if buf:
        parts.append(buf)
    return parts


def _merge_where(a: str, b: str) -> str:
    ma, mb = re.match(r"(.*?)(\d+)(\D*)$", a), re.match(r"(.*?)(\d+)(\D*)$", b)
    if ma and mb and ma.group(1) == mb.group(1) and "~" not in a:
        return f"{ma.group(1)}{ma.group(2)}~{mb.group(2)}{mb.group(3)}"
    if ma and mb and "~" in a:
        return re.sub(r"~\d+", f"~{mb.group(2)}", a)
    return a


def make_chunks(segments, doc_id: str) -> list[dict]:
    """짧은 문단은 이어 붙이고 긴 문단은 나눠, 출처 위치를 유지한 근거조각을 만든다."""
    chunks: list[dict] = []
    cur = None
    for seg in segments:
        for piece in _split(seg.text):
            if cur and len(cur["text"]) + len(piece) < CHUNK_MAX // 2 and not cur["text"].startswith("보낸사람"):
                cur["text"] += "\n" + piece
                cur["where"] = _merge_where(cur["where"], seg.where)
            else:
                cur = {"doc_id": doc_id, "where": seg.where, "text": piece}
                chunks.append(cur)
    return chunks


def ingest_folder(root: str, progress=None) -> dict:
    """폴더 전체를 읽어 docs/chunks/원본해시를 만든다. 원본은 읽기만 한다."""
    root = os.path.abspath(root)
    files = list_files(root)
    docs, chunks, skipped = [], [], []
    for i, path in enumerate(files):
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        ext = os.path.splitext(path)[1].lower()
        if progress:
            progress(i, len(files), rel)
        if not is_supported(path):
            skipped.append({"file": rel, "reason": f"미지원 형식({ext or '확장자 없음'})"})
            continue
        st = os.stat(path)
        doc = {
            "id": f"D{len(docs) + 1:03d}",
            "file": rel,
            "ext": ext,
            "size": st.st_size,
            "mtime": dt.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "sha256": sha256(path),
            "masked": 0,
            "info": {},
        }
        try:
            segs, info = parse_file(path)
            doc["info"] = info
        except Exception as e:  # 한 파일 실패가 전체를 멈추지 않도록
            doc.update(kind="doc", kind_label="읽기 실패", error=f"{type(e).__name__}: {e}", n_chunks=0, preview="")
            docs.append(doc)
            continue
        for s in segs:
            s.text, n = mask_sensitive(s.text)
            doc["masked"] += n
        full = "\n".join(s.text for s in segs)
        doc["kind"] = classify(rel, ext, full)
        doc["kind_label"] = KIND_LABEL[doc["kind"]]
        doc["preview"] = re.sub(r"\s+", " ", full)[:160]
        doc["chars"] = len(full)
        new = make_chunks(segs, doc["id"])
        for c in new:
            c["id"] = f"S{len(chunks) + 1:04d}"
            c["file"] = rel
            c["kind"] = doc["kind"]
            chunks.append(c)
        doc["n_chunks"] = len(new)
        if not new and "note" in info:
            doc["error"] = info["note"]
        docs.append(doc)
    if progress:
        progress(len(files), len(files), "")
    return {"root": root, "docs": docs, "chunks": chunks, "skipped": skipped}


def verify_originals(root: str, docs: list[dict]) -> dict:
    """처리 후 원본 해시를 다시 계산해 '원본 무변경'을 증명한다."""
    changed = []
    for d in docs:
        p = os.path.join(root, d["file"])
        if not os.path.exists(p) or sha256(p) != d["sha256"]:
            changed.append(d["file"])
    return {"checked": len(docs), "changed": changed, "ok": not changed,
            "at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
