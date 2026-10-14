"""LLM 프롬프트 — 시스템 프롬프트는 Next.js 판(lib/answer/prompts.ts)에서 내보낸 data/prompts.json 을 그대로 사용"""
from __future__ import annotations

import json
from pathlib import Path

from .data import article_label

_P = json.loads((Path(__file__).resolve().parent / "data" / "prompts.json").read_text(encoding="utf-8"))


def system_prompt(mode: str) -> str:
    return _P["citizen"] if mode == "citizen" else _P["officer"]


ANALYSIS_SYSTEM: str = _P["analysis"]


def context_block(citations: list[dict]) -> str:
    return "\n\n".join(f"<<{c['key']}>> 「{c['lawName']}」({c['lawKind']}) {article_label(c['articleNo'])}({c['title']})\n{c['text']}" for c in citations)


def user_prompt(query: str, citations: list[dict]) -> str:
    return f"<근거조문>\n{context_block(citations)}\n</근거조문>\n\n<질문>\n{query}\n</질문>\n\n위 근거조문만 사용하여 JSON으로 답하라."


def analysis_prompt(situation: str, citations: list[dict]) -> str:
    return f"<근거조문>\n{context_block(citations)}\n</근거조문>\n\n<상황>\n{situation}\n</상황>\n\n위 근거조문만 사용하여 세 관점의 분석을 JSON으로 작성하라."
