import { LLMError, type GenerateOptions, type GenerateResult, type LLMProvider } from "../llm/types";
import { parseLooseJson } from "./guard";

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

/** 검증에 걸린 답을 한 번 다시 쓰게 할 때의 지시(검증은 그대로 엄격 — 다시 쓴 답도 같은 가드를 통과해야 함) */
export const RETRY_PROMPT = (reason: string) =>
  `방금 답변이 근거 검증에 걸렸다: ${reason}\n근거 조문 원문에 없는 수치·기간·금액·조문은 모두 빼고, 같은 JSON 형식으로 답변 전체를 다시 써라. 확실하지 않은 내용은 쓰지 않는다.`;

/**
 * 생성 → 가드 검증. 가드에 걸리면(연결 실패 제외) 걸린 이유를 알려 주고 한 번만 다시 쓰게 한다.
 * 다시 쓴 답도 같은 가드를 통과하지 못하면 예외 → 호출한 쪽이 규칙기반 답변으로 대체
 */
export async function generateGuarded<T>(provider: LLMProvider, opts: GenerateOptions, guard: (raw: unknown) => T): Promise<{ res: GenerateResult; g: T; retried: boolean }> {
  const res = await provider.generate(opts);
  try {
    return { res, g: guard(parseLooseJson(res.text)), retried: false };
  } catch (e) {
    if (e instanceof LLMError) throw e;
    const again = await provider.generate({ ...opts, messages: [...opts.messages, { role: "assistant", content: res.text }, { role: "user", content: RETRY_PROMPT((e as Error).message) }] });
    return { res: again, g: guard(parseLooseJson(again.text)), retried: true };
  }
}
