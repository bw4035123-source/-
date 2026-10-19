import { describe, expect, it } from "vitest";
import { findUnverifiedMentions, guardAnalysisOutput, guardLLMOutput, parseLooseJson, sanitizeMarkers } from "@/lib/answer/guard";
import { getMockLaw } from "@/lib/law-api/mock";
import { toCitation } from "@/lib/law-api/util";

const law = getMockLaw("housing-lease")!;
const ctx = ["3", "3의2", "3의3"].map((no) => toCitation(law, law.articles.find((a) => a.no === no)!));

describe("환각 방지 가드", () => {
  it("근거 목록 밖 인용 키 제거", () => {
    const r = sanitizeMarkers("대항력이 생겨요 [[housing-lease:3]]. 가짜 [[fake-law:99]].", new Set(ctx.map((c) => c.key)));
    expect(r.removed).toEqual(["fake-law:99"]);
    expect(r.used).toEqual(["housing-lease:3"]);
    expect(r.text).not.toContain("fake-law");
  });

  it("근거에 없는 조문 언급 탐지, 있는 조문은 통과", () => {
    const bad = findUnverifiedMentions("「주택임대차보호법」 제3조와 「주택임대차보호법」 제99조, 「민법」 제618조에 따라", ctx);
    expect(bad).toContain("「주택임대차보호법」 제99조");
    expect(bad).toContain("「민법」 제618조");
    expect(bad).not.toContain("「주택임대차보호법」 제3조");
  });

  it("근거 원문 안에 등장하는 타법 조문은 확인된 것으로 처리", () => {
    // 제3조의2 원문에 「민사집행법」 제41조가 등장
    expect(findUnverifiedMentions("「민사집행법」 제41조에도 불구하고", ctx)).toEqual([]);
  });

  it("코드블록에 싸인 JSON 파싱", () => {
    expect(parseLooseJson('여기 있습니다\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("LLM 출력 검증: 가짜 인용 제거 후 사용 인용만 반환", () => {
    const g = guardLLMOutput(
      {
        summary: "전입신고 다음 날부터 대항력이 생겨요 [[housing-lease:3]]. 소송하세요 [[civil-act:750]].",
        easyTerms: [{ term: "대항력", meaning: "주장할 수 있는 힘" }],
        steps: [{ title: "전입신고", detail: "하세요", ref: "housing-lease:3" }, { title: "확정일자", detail: "받으세요", ref: "nope:1" }],
        citations: ["housing-lease:3", "ghost:1"],
      },
      "citizen",
      ctx,
    );
    expect(g.citationKeys).toEqual(["housing-lease:3"]);
    expect(g.removed.sort()).toEqual(["civil-act:750", "ghost:1"]);
    expect(g.citizen!.steps[1].ref).toBeUndefined();
  });

  it("인용이 하나도 없으면 예외(규칙엔진 대체 유도)", () => {
    expect(() => guardLLMOutput({ summary: "근거 없이 말함", citations: [] }, "officer", ctx)).toThrow();
  });

  it("소형 모델 출력 보정: 감싼 JSON·answer 키·[[키]] 누락도 근거 조문 언급으로만 인정", () => {
    const g = guardLLMOutput({ answer: { answer: "「주택임대차보호법」 제3조에 따라 전입 다음 날 대항력이 생겨요." } }, "citizen", ctx);
    expect(g.summary).toContain("대항력");
    expect(g.citationKeys).toEqual(["housing-lease:3"]);
    // 근거 목록에 없는 조문만 언급하면 여전히 거절(규칙엔진 대체)
    expect(() => guardLLMOutput({ summary: "「주택임대차보호법」 제30조를 보세요." }, "citizen", ctx)).toThrow("근거 조문 인용이 없습니다");
    // 제3조의2 언급이 제3조로 잘못 잡히지 않음
    expect(guardLLMOutput({ summary: "주택임대차보호법 제3조의2에 따라 우선변제" }, "officer", ctx).citationKeys).toEqual(["housing-lease:3의2"]);
    const a = guardAnalysisOutput({ result: { lawyer: { stance: "「주택임대차보호법」 제3조 대항력 주장" }, prosecutor: { stance: "" }, judge: { stance: "요건 검토" } } }, ctx);
    expect(a.citationKeys).toEqual(["housing-lease:3"]);
  });
});
