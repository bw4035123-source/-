/** 서버 전용 환경설정 — 브라우저 번들에 포함되지 않도록 Route Handler/서버 컴포넌트에서만 import */
import "server-only";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const serverConfig = {
  lawApiOc: env("LAW_API_OC") || env("LAW_OC"),
  llm: {
    defaultProvider: env("LLM_PROVIDER", "mock"),
    timeoutMs: Number(env("LLM_TIMEOUT_MS", "45000")) || 45000,
    openai: { apiKey: env("OPENAI_API_KEY"), model: env("OPENAI_MODEL", "gpt-4o-mini"), baseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1") },
    anthropic: { apiKey: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"), baseUrl: env("ANTHROPIC_BASE_URL", "https://api.anthropic.com") },
    ollama: { baseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434"), model: env("OLLAMA_MODEL", "exaone3.5:7.8b") },
  },
};
export type ServerConfig = typeof serverConfig;
