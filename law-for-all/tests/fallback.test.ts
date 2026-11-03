import { describe, expect, it } from "vitest";
import { generateGuarded, llmFallback } from "@/lib/answer/fallback";
import { LLMError, type GenerateOptions, type LLMProvider } from "@/lib/llm/types";

describe("생성형 AI 대체 안내", () => {
  it("연결 실패와 검증 실패를 구분하고, 화면 안내에는 기술 정보를 넣지 않음", () => {
    const c = llmFallback("업스테이지 Solar", new LLMError("openai 연결 실패: 응답 제한시간(45초) 초과", "openai"));
    expect(c.kind).toBe("connection");
    expect(c.notice).toBe("AI(업스테이지 Solar)에 연결하지 못해 사람이 검수한 규칙기반 답변으로 안내합니다.");
    expect(c.reason).toContain("제한시간");
    const g = llmFallback("업스테이지 Solar", new Error("근거에 없는 수치: 90일"), "분석");
    expect(g.kind).toBe("guard");
    expect(g.notice).not.toContain("90일");
    expect(g.notice).toContain("근거 검증을 통과하지 못해");
  });
});

/** 차례대로 정해진 답(또는 예외)을 돌려주는 가짜 공급자 */
function fake(outputs: (string | Error)[]) {
  const calls: GenerateOptions[] = [];
  const provider = {
    id: "openai", label: "테스트", model: "t", kind: "llm",
    isConfigured: () => true,
    async generate(o: GenerateOptions) {
      calls.push(o);
      const out = outputs[calls.length - 1];
      if (out instanceof Error) throw out;
      return { text: out, model: "t" };
    },
  } as unknown as LLMProvider;
  return { provider, calls };
}
const guard = (raw: unknown) => {
  const v = (raw as { n?: number }).n;
  if (v !== 14) throw new Error(`근거 원문에서 확인되지 않은 수치 1건: ${v}일`);
  return v;
};
const opts: GenerateOptions = { system: "s", messages: [{ role: "user", content: "q" }], json: true };

describe("검증 실패 시 한 번 다시 쓰기", () => {
  it("첫 답이 가드에 걸리면 이유를 알려 주고 다시 쓴 답을 같은 가드로 검증", async () => {
    const { provider, calls } = fake(['{"n":60}', '{"n":14}']);
    const r = await generateGuarded(provider, opts, guard);
    expect(r).toMatchObject({ g: 14, retried: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1)?.content).toContain("60일");
    expect(calls[1].messages[1]).toEqual({ role: "assistant", content: '{"n":60}' });
  });
  it("통과하면 다시 부르지 않고, 다시 쓴 답도 걸리면 예외(→ 규칙기반 대체)", async () => {
    const ok = fake(['{"n":14}']);
    expect(await generateGuarded(ok.provider, opts, guard)).toMatchObject({ g: 14, retried: false });
    expect(ok.calls).toHaveLength(1);
    const bad = fake(['{"n":60}', '{"n":30}']);
    await expect(generateGuarded(bad.provider, opts, guard)).rejects.toThrow("30일");
  });
  it("연결 실패는 다시 부르지 않음", async () => {
    const f = fake([new LLMError("openai 연결 실패: 429", "openai")]);
    await expect(generateGuarded(f.provider, opts, guard)).rejects.toBeInstanceOf(LLMError);
    expect(f.calls).toHaveLength(1);
  });
});
