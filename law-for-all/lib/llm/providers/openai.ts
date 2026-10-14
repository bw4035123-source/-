import { postJson } from "../http";
import type { GenerateOptions, GenerateResult, LLMProvider } from "../types";

interface Cfg { apiKey: string; model: string; baseUrl: string; timeoutMs: number }

/**
 * OpenAI Chat Completions 어댑터.
 * OPENAI_BASE_URL 을 바꾸면 Upstage Solar, vLLM, LM Studio 등 OpenAI 호환 서버에도 그대로 사용 가능.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  readonly kind = "llm" as const;
  readonly label: string;
  constructor(private readonly cfg: Cfg) {
    this.label = /api\.openai\.com/.test(cfg.baseUrl) ? "OpenAI" : "OpenAI 호환(Solar·vLLM 등)";
  }
  get model() {
    return this.cfg.model;
  }
  isConfigured() {
    // 공식 엔드포인트는 키 필수, 사내 호환 서버는 키 없이도 허용
    return !!this.cfg.apiKey || !/api\.openai\.com/.test(this.cfg.baseUrl);
  }
  async generate(o: GenerateOptions): Promise<GenerateResult> {
    type Res = { choices: { message: { content: string } }[]; model: string; usage?: { prompt_tokens: number; completion_tokens: number } };
    const res = await postJson<Res>(
      this.id,
      `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        model: this.cfg.model,
        temperature: o.temperature ?? 0.2,
        max_tokens: o.maxTokens ?? 2000,
        ...(o.json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: o.system }, ...o.messages],
      },
      this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {},
      this.cfg.timeoutMs,
      o.signal,
    );
    return {
      text: res.choices?.[0]?.message?.content ?? "",
      model: res.model ?? this.cfg.model,
      usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens },
    };
  }
}
