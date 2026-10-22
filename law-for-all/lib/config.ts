/** 서버 전용 환경설정 — 브라우저 번들에 포함되지 않도록 Route Handler/서버 컴포넌트에서만 import */
import "server-only";
import { lawProxy } from "./law-api/proxy";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const serverConfig = {
  lawApiOc: env("LAW_API_OC") || env("LAW_OC"),
  /** 법령 API 중계 서버(기본: Render) — null 이면 law.go.kr 직접 호출 */
  get lawProxy() {
    return lawProxy();
  },
  /** 실시간 조회 가능 여부 겸 LawService 인자: 중계 서버가 있으면 그것으로, 없으면 OC 로 */
  get lawAccess(): string {
    return this.lawProxy ? "proxy" : this.lawApiOc;
  },
  llm: {
    defaultProvider: env("LLM_PROVIDER", "mock"),
    timeoutMs: Number(env("LLM_TIMEOUT_MS", "45000")) || 45000,
    openai: { apiKey: env("OPENAI_API_KEY"), model: env("OPENAI_MODEL", "gpt-4o-mini"), baseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1") },
    anthropic: { apiKey: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"), baseUrl: env("ANTHROPIC_BASE_URL", "https://api.anthropic.com") },
    // numCtx: 근거 조문이 길어 기본 문맥(4096)이면 질문이 잘려 나가므로 넉넉히
    ollama: { baseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434"), model: env("OLLAMA_MODEL", "exaone3.5:7.8b"), numCtx: Number(env("OLLAMA_NUM_CTX", "8192")) || 8192 },
  },
};
export type ServerConfig = typeof serverConfig;
