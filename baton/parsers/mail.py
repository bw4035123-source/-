"""메일(EML/MSG): 보낸사람·받는사람·날짜·제목을 함께 남겨 '협의 관계'를 추적한다.

첨부파일 중 지원 형식은 임시 폴더에 풀어 같이 읽는다(원본 메일은 건드리지 않음).
"""
from __future__ import annotations

import email
import html
import os
import re
import tempfile
from email import policy
from email.utils import getaddresses, parsedate_to_datetime


def _strip_html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(re.sub(r"[ \t]+", " ", s))


def _strip_quoted(body: str) -> str:
    """회신 메일의 이전 인용문(-----Original Message----- 등)은 잘라낸다."""
    m = re.search(r"(?m)^(-{3,}\s*(Original Message|원본 메시지|Forwarded)|>{1}\s|\s*On .+wrote:)", body)
    return body[: m.start()] if m and m.start() > 40 else body


def _headers_text(frm, to, cc, date, subject):
    lines = [f"보낸사람: {frm}", f"받는사람: {to}"]
    if cc:
        lines.append(f"참조: {cc}")
    lines += [f"날짜: {date}", f"제목: {subject}"]
    return "\n".join(lines)


def _parse_attachments(atts):
    from . import PARSERS  # 순환 import 회피

    segs = []
    for fname, payload in atts:
        ext = os.path.splitext(fname)[1].lower()
        if ext not in PARSERS or ext in (".eml", ".msg"):
            continue
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "att" + ext)
            with open(p, "wb") as f:
                f.write(payload)
            try:
                sub, _ = PARSERS[ext](p)
            except Exception:
                continue
        segs += [(t, f"첨부 '{fname}' {w}", m) for t, w, m in sub]
    return segs


def parse_eml(path: str):
    with open(path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)
    frm, to, cc = str(msg.get("From", "")), str(msg.get("To", "")), str(msg.get("Cc", ""))
    subject = str(msg.get("Subject", ""))
    try:
        d = parsedate_to_datetime(msg["Date"]) if msg["Date"] else None
        date = f"{d.year}. {d.month}. {d.day}. {d:%H:%M}" if d else ""
    except Exception:
        date = str(msg.get("Date", ""))
    body_part = msg.get_body(preferencelist=("plain", "html"))
    body = ""
    if body_part is not None:
        body = body_part.get_content()
        if body_part.get_content_type() == "text/html":
            body = _strip_html(body)
    atts = []
    for part in msg.iter_attachments():
        fn = part.get_filename()
        if fn:
            atts.append((fn, part.get_payload(decode=True) or b""))
    info = {
        "format": "메일",
        "from": getaddresses([frm]),
        "to": getaddresses([to, cc]),
        "date": date,
        "subject": subject,
        "attachments": [a[0] for a in atts],
    }
    segs = [(_headers_text(frm, to, cc, date, subject) + "\n\n" + _strip_quoted(body).strip(), "메일 본문", {})]
    return segs + _parse_attachments(atts), info


def parse_msg(path: str):
    try:
        import extract_msg  # 선택 의존성
    except ImportError:
        return [], {"format": "Outlook MSG", "note": "extract-msg 패키지를 설치하면 .msg 도 읽을 수 있습니다"}
    m = extract_msg.Message(path)
    try:
        date = str(m.date or "")
        info = {"format": "메일", "from": getaddresses([m.sender or ""]), "to": getaddresses([m.to or "", m.cc or ""]),
                "date": date, "subject": m.subject or "", "attachments": []}
        body = _strip_quoted(m.body or "")
        segs = [(_headers_text(m.sender, m.to, m.cc, date, m.subject) + "\n\n" + body, "메일 본문", {})]
        atts = [(a.longFilename or a.shortFilename or "", a.data) for a in m.attachments if isinstance(a.data, bytes)]
        info["attachments"] = [a[0] for a in atts]
        return segs + _parse_attachments(atts), info
    finally:
        m.close()
