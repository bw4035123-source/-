"""생성형 AI 답변을 쓰지 못했을 때의 안내 — lib/answer/fallback.ts 와 같음
연결 실패(제한시간·인증·크레딧 등)와 검증 실패(근거 밖 인용·수치 불일치·형식 오류)를 구분해
화면 안내(notice)는 쉬운 말로, 기술 정보는 검증 상세(reason)에만 남긴다"""
from __future__ import annotations

from .guard import parse_loose_json
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


def retry_prompt(reason: str) -> str:
    return f"방금 답변이 근거 검증에 걸렸다: {reason}\n근거 조문 원문에 없는 수치·기간·금액·조문은 모두 빼고, 같은 JSON 형식으로 답변 전체를 다시 써라. 확실하지 않은 내용은 쓰지 않는다."


def generate_guarded(p, guard, **opts):
    """생성 → 가드 검증. 가드에 걸리면(연결 실패 제외) 이유를 알려 주고 한 번만 다시 쓰게 한다(lib/answer/fallback.ts generateGuarded 와 같음)"""
    res = p.generate(**opts)
    try:
        return res, guard(parse_loose_json(res["text"])), False
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001 — 가드 실패만 한 번 재시도
        msgs = [*opts["messages"], {"role": "assistant", "content": res["text"]}, {"role": "user", "content": retry_prompt(str(e))}]
        again = p.generate(**{**opts, "messages": msgs})
        return again, guard(parse_loose_json(again["text"])), True
