/**
 * LLM 비종속성 계층 — Adapter Pattern.
 * 모든 공급자(OpenAI·Anthropic·Ollama/로컬·규칙엔진)는 동일한 LLMProvider 인터페이스를 구현하며,
 * 상위 로직(answer)은 공급자 종류를 알지 못한 채 generate()만 호출한다.
 */
export type ProviderId = "mock" | "openai" | "anthropic" | "ollama";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  system: string;
  messages: ChatMessage[];
  /** JSON 객체 출력 강제(지원 공급자는 네이티브 모드 사용) */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  /** rule: LLM 없이 규칙기반으로 답변(generate 미사용) */
  readonly kind: "llm" | "rule";
  /** 필수 설정(키 등)이 갖춰졌는지 — 네트워크 확인 없이 즉시 판단 */
  isConfigured(): boolean;
  /** 실제 연결 확인(선택) */
  healthCheck?(signal?: AbortSignal): Promise<boolean>;
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  model: string;
  kind: "llm" | "rule";
  configured: boolean;
  isDefault: boolean;
  hint: string;
}

export class LLMError extends Error {
  constructor(message: string, readonly provider: ProviderId, readonly status?: number) {
    super(message);
  }
}
