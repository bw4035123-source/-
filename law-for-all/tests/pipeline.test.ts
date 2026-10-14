import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 질의응답 파이프라인 통합 테스트 — LLM 호출은 fetch 모킹으로 대체 */
async function loadAsk(env: Record<string, string>) {
  vi.resetModules();
  for (const k of ["LAW_API_OC", "LAW_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  return (await import("@/lib/answer/ask")).ask;
}

describe("ask 파이프라인", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("키 없이: 규칙엔진 + 내장데이터로 시민·공무원 답변 모두 생성", async () => {
    const ask = await loadAsk({});
    const r = await ask({ query: "윗집 층간소음 기준이 어떻게 되나요?", mode: "citizen" });
    expect(r.provider.id).toBe("mock");
    expect(r.topic?.id).toBe("floor-noise");
    expect(r.citations[0].key).toBe("apartment-mgmt:20");
    expect(r.citizen?.steps).toHaveLength(3);
    expect(r.officer?.keyPoints.length).toBeGreaterThan(0);
    expect(r.guard.passed).toBe(true);
    expect(r.dataSource).toBe("mock");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("미설정 공급자 선택 시 규칙엔진으로 안전 대체", async () => {
    const ask = await loadAsk({});
    const r = await ask({ query: "육아휴직 급여", mode: "citizen", provider: "anthropic" });
    expect(r.provider.id).toBe("mock");
    expect(r.notices.join()).toContain("규칙기반 엔진");
  });

  it("OpenAI 어댑터: 가짜 인용 제거 + 조문 언급 검증", async () => {
    const ask = await loadAsk({ OPENAI_API_KEY: "sk-test", LLM_PROVIDER: "openai" });
    const content = JSON.stringify({
      summary: "음주운전 기준은 0.03% 이상이에요 [[road-traffic:44]]. 「도로교통법」 제999조도 있어요 [[road-traffic:999]].",
      easyTerms: [{ term: "혈중알코올농도", meaning: "피 속 알코올 비율" }],
      steps: [
        { title: "운전 금지", detail: "마셨으면 운전하지 마세요", ref: "road-traffic:44" },
        { title: "측정 응하기", detail: "측정에 응하세요", ref: "" },
        { title: "불복", detail: "행정심판", ref: "" },
      ],
      citations: ["road-traffic:44", "road-traffic:999"],
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content } }] }), { status: 200 }));
    const r = await ask({ query: "음주운전 처벌 기준", mode: "citizen" });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body).response_format).toEqual({ type: "json_object" });
    expect(r.provider).toMatchObject({ id: "openai", model: "gpt-test" });
    expect(r.guard.removedCitations).toContain("road-traffic:999");
    expect(r.guard.unverifiedMentions).toContain("「도로교통법」 제999조");
    expect(r.summary).not.toContain("road-traffic:999");
    expect(r.citations[0].key).toBe("road-traffic:44");
  });

  it("Anthropic 어댑터: 요청 형식 + 잘못된 JSON이면 규칙엔진 대체", async () => {
    const ask = await loadAsk({ ANTHROPIC_API_KEY: "test-key" });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text: "죄송하지만 JSON이 아닙니다" }] }), { status: 200 }),
    );
    const r = await ask({ query: "민원 처리 기한", mode: "officer", provider: "anthropic" });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(r.provider.id).toBe("mock");
    expect(r.guard.fallbackReason).toContain("Anthropic");
    expect(r.officer?.keyPoints.length).toBeGreaterThan(0);
  });

  it("Ollama 어댑터: 로컬 /api/chat + format=json", async () => {
    const ask = await loadAsk({ LLM_PROVIDER: "ollama" });
    const content = JSON.stringify({
      summary: "질의민원은 법령 해석 14일 이내 처리함 [[civil-petition-decree:14]].",
      background: "민원처리법 제18조 위임 [[civil-petition:18]]",
      keyPoints: ["법령 질의 14일 [[civil-petition-decree:14]]"],
      adminNotes: [],
      checklist: ["접수일 확인"],
      citations: ["civil-petition-decree:14", "civil-petition:18"],
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ model: "exaone3.5:7.8b", message: { content } }), { status: 200 }));
    const r = await ask({ query: "질의민원 처리기간", mode: "officer" });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("http://localhost:11434/api/chat");
    expect(JSON.parse(init.body).format).toBe("json");
    expect(r.provider.id).toBe("ollama");
    expect(r.guard.passed).toBe(true);
    expect(r.citations.slice(0, 2).map((c) => c.key)).toEqual(["civil-petition-decree:14", "civil-petition:18"]);
  });

  it("근거가 없으면 LLM을 호출하지 않음", async () => {
    const ask = await loadAsk({ OPENAI_API_KEY: "sk-test", LLM_PROVIDER: "openai" });
    const r = await ask({ query: "zzqq xxyy", mode: "citizen" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(r.citations).toHaveLength(0);
    expect(r.guard.fallbackReason).toBeDefined();
  });
});
