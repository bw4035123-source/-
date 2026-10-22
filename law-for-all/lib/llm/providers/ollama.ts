import { postJson } from "../http";
import type { GenerateOptions, GenerateResult, LLMProvider } from "../types";

interface Cfg { baseUrl: string; model: string; timeoutMs: number; numCtx?: number }

/**
 * Ollama 어댑터 — 폐쇄망·온프레미스 환경의 로컬 LLM(EXAONE, Gemma, Llama, Solar 등).
 * 데이터가 기관 외부로 나가지 않는 구성이 가능하다.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly kind = "llm" as const;
  readonly label = "Ollama(로컬 LLM)";
  constructor(private readonly cfg: Cfg) {}
  get model() {
    return this.cfg.model;
  }
  isConfigured() {
    return !!this.cfg.baseUrl && !!this.cfg.model;
  }
  async healthCheck(signal?: AbortSignal) {
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: signal ?? AbortSignal.timeout(1500), cache: "no-store" });
      if (!res.ok) return false;
      const j = (await res.json()) as { models?: { name: string }[] };
      const want = this.cfg.model.includes(":") ? this.cfg.model : `${this.cfg.model}:latest`;
      return !!j.models?.some((m) => m.name === want || m.name === this.cfg.model);
    } catch {
      return false;
    }
  }
  async generate(o: GenerateOptions): Promise<GenerateResult> {
    type Res = { message?: { content: string }; model: string; prompt_eval_count?: number; eval_count?: number };
    const res = await postJson<Res>(
      this.id,
      `${this.cfg.baseUrl.replace(/\/$/, "")}/api/chat`,
      {
        model: this.cfg.model,
        stream: false,
        // 스키마가 있으면 구조화 출력(JSON 스키마)으로 강제 — 소형 모델도 형식을 지키게
        ...(o.json ? { format: o.schema ?? "json" } : {}),
        // 문맥 길이: 기본 4096이면 근거 조문 블록 뒤의 질문이 잘려 나간다
        options: { temperature: o.temperature ?? 0.2, num_predict: o.maxTokens ?? 2000, num_ctx: this.cfg.numCtx ?? 8192 },
        messages: [{ role: "system", content: o.system }, ...o.messages],
      },
      {},
      this.cfg.timeoutMs,
      o.signal,
    );
    return { text: res.message?.content ?? "", model: res.model ?? this.cfg.model, usage: { inputTokens: res.prompt_eval_count, outputTokens: res.eval_count } };
  }
}
