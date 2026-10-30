import { LLMError } from "../llm/types";

export type FallbackKind = "no-evidence" | "connection" | "guard";

/**
 * 생성형 AI 답변을 쓰지 못했을 때의 안내 — 연결 실패(제한시간·인증·크레딧 등)와 검증 실패(근거 밖 인용·수치 불일치·형식 오류)를 구분해
 * 화면 안내(notice)는 쉬운 말로, 기술 정보는 검증 상세(reason)에만 남긴다
 */
export function llmFallback(label: string, e: unknown, what: "답변" | "분석" = "답변"): { kind: FallbackKind; notice: string; reason: string } {
  const connection = e instanceof LLMError;
  const notice = connection
    ? `AI(${label})에 연결하지 못해 사람이 검수한 규칙기반 ${what}으로 안내합니다.`
    : `AI(${label})의 ${what}이 근거 검증을 통과하지 못해 사람이 검수한 규칙기반 ${what}으로 대신 안내합니다.`;
  return { kind: connection ? "connection" : "guard", notice, reason: `${notice} (기술 정보: ${(e as Error).message})` };
}

export const NO_EVIDENCE_REASON = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다.";
