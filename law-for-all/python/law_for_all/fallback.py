"""생성형 AI 답변을 쓰지 못했을 때의 안내 — lib/answer/fallback.ts 와 같음
연결 실패(제한시간·인증·크레딧 등)와 검증 실패(근거 밖 인용·수치 불일치·형식 오류)를 구분해
화면 안내(notice)는 쉬운 말로, 기술 정보는 검증 상세(reason)에만 남긴다"""
from __future__ import annotations

from .llm import LLMError

NO_EVIDENCE_REASON = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다."
NO_EVIDENCE = {"kind": "no-evidence", "notice": NO_EVIDENCE_REASON, "reason": NO_EVIDENCE_REASON}


def llm_fallback(label: str, e: Exception, what: str = "답변") -> dict:
    connection = isinstance(e, LLMError)
    notice = (
        f"AI({label})에 연결하지 못해 사람이 검수한 규칙기반 {what}으로 안내합니다."
        if connection
        else f"AI({label})의 {what}이 근거 검증을 통과하지 못해 사람이 검수한 규칙기반 {what}으로 대신 안내합니다."
    )
    return {"kind": "connection" if connection else "guard", "notice": notice, "reason": f"{notice} (기술 정보: {e})"}
