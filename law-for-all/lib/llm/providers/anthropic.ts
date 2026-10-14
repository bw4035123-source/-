import { postJson } from "../http";
import type { GenerateOptions, GenerateResult, LLMProvider } from "../types";

interface Cfg { apiKey: string; model: string; baseUrl: string; timeoutMs: number }

/** Anthropic Messages API 어댑터 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly kind = "llm" as const;
  readonly label = "Anthropic Claude";
  constructor(private readonly cfg: Cfg) {}
  get model() {
    return this.cfg.model;
  }
  isConfigured() {
    return !!this.cfg.apiKey;
  }
  async generate(o: GenerateOptions): Promise<GenerateResult> {
    type Res = { content: { type: string; text?: string }[]; model: string; usage?: { input_tokens: number; output_tokens: number } };
    const system = o.json ? `${o.system}\n\n반드시 하나의 JSON 객체만 출력하고, 코드블록 표시나 설명 문장을 덧붙이지 마세요.` : o.system;
    const res = await postJson<Res>(
      this.id,
      `${this.cfg.baseUrl.replace(/\/$/, "")}/v1/messages`,
      {
        model: this.cfg.model,
        max_tokens: o.maxTokens ?? 2000,
        temperature: o.temperature ?? 0.2,
        system,
        messages: o.messages,
      },
      { "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      this.cfg.timeoutMs,
      o.signal,
    );
    return {
      text: res.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "",
      model: res.model ?? this.cfg.model,
      usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
    };
  }
}
