import type { ServerConfig } from "../config";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { OpenAIProvider } from "./providers/openai";
import type { LLMProvider, ProviderId, ProviderInfo } from "./types";

export const PROVIDER_IDS: ProviderId[] = ["mock", "openai", "anthropic", "ollama"];
export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as string[]).includes(v);

/** 환경설정 → 공급자 인스턴스(Adapter) 생성 */
export function createProviders(cfg: ServerConfig["llm"]): Record<ProviderId, LLMProvider> {
  const t = cfg.timeoutMs;
  return {
    mock: new MockProvider(),
    openai: new OpenAIProvider({ ...cfg.openai, timeoutMs: t }),
    anthropic: new AnthropicProvider({ ...cfg.anthropic, timeoutMs: t }),
    ollama: new OllamaProvider({ ...cfg.ollama, timeoutMs: t }),
  };
}

export function defaultProviderId(cfg: ServerConfig["llm"]): ProviderId {
  return isProviderId(cfg.defaultProvider) ? cfg.defaultProvider : "mock";
}

/**
 * 요청 공급자 결정: 요청값 → 환경변수 기본값 → mock 순.
 * 설정되지 않은 공급자를 고르면 규칙엔진으로 안전하게 대체하고 사유를 반환한다.
 */
export function resolveProvider(cfg: ServerConfig["llm"], requested?: string): { provider: LLMProvider; notice?: string } {
  const all = createProviders(cfg);
  const id = isProviderId(requested) ? requested : defaultProviderId(cfg);
  const p = all[id];
  if (p.isConfigured()) return { provider: p };
  return { provider: all.mock, notice: `${p.label} 설정(API 키 등)이 없어 규칙기반 엔진으로 답변했습니다.` };
}

const HINTS: Record<ProviderId, string> = {
  mock: "설정 불필요 · 내장 법령 토픽으로 즉시 답변",
  openai: "OPENAI_API_KEY 필요(OPENAI_BASE_URL로 Solar·vLLM 등 호환 서버 사용 가능)",
  anthropic: "ANTHROPIC_API_KEY 필요",
  ollama: "로컬 Ollama 실행 + OLLAMA_MODEL 내려받기 필요",
};

export async function listProviders(cfg: ServerConfig["llm"], probe = true): Promise<ProviderInfo[]> {
  const all = createProviders(cfg);
  const def = defaultProviderId(cfg);
  return Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const p = all[id];
      let configured = p.isConfigured();
      if (configured && probe && p.healthCheck) configured = await p.healthCheck();
      return { id, label: p.label, model: p.model, kind: p.kind, configured, isDefault: id === def, hint: HINTS[id] };
    }),
  );
}
