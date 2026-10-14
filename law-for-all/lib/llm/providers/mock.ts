import type { GenerateResult, LLMProvider } from "../types";

/**
 * 규칙기반 엔진(No-LLM) — API 키·GPU 없이도 완전한 시연이 가능하도록
 * 검증된 법령 토픽 사전과 조문 검색 결과로 답변을 조립한다(lib/answer/rule-engine.ts).
 * 생성형 문장을 만들지 않으므로 환각이 원천적으로 발생하지 않는다.
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock" as const;
  readonly kind = "rule" as const;
  readonly label = "규칙기반 엔진(LLM 없음)";
  readonly model = "law-rule-engine-v1";
  isConfigured() {
    return true;
  }
  async generate(): Promise<GenerateResult> {
    throw new Error("규칙기반 엔진은 generate()를 사용하지 않습니다.");
  }
}
