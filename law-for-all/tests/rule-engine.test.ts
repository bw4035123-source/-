import { describe, expect, it } from "vitest";
import { ask } from "@/lib/answer/ask";

describe("규칙기반 답변", () => {
  it("질문이 토픽 안의 특정 조문을 가리키면 그 조문을 먼저 — 금액이 든 시행령 별표로(외부강의 사례금 → 시행령 제25조·40만원)", async () => {
    const r = await ask({ query: "청탁금지법상 공무원 외부강의 사례금 상한은?", mode: "officer" });
    expect(r.topic?.id).toBe("anti-graft");
    expect(r.summary.startsWith("「부정청탁 및 금품등 수수의 금지에 관한 법률 시행령」 제25조")).toBe(true);
    expect(r.summary).toContain("40만원");
    // 글자만 겹친 다른 법(주택임대차 '상한')은 근거에 섞이지 않음
    expect(r.citations.every((c) => c.key.startsWith("anti-graft"))).toBe(true);
    expect(r.guard.passed).toBe(true);
  });

  it("흔한 말 하나로는 붙이지 않음(보증금·과태료)", async () => {
    for (const query of ["재계약할 때 보증금 올릴 수 있는 한도", "과태료 처분이 부당해서 불복하려고요"]) {
      const r = await ask({ query, mode: "citizen" });
      expect(r.summary.startsWith("「")).toBe(false);
    }
  });

  it("한국어가 없는 질문은 한국어로 묻도록 안내", async () => {
    const r = await ask({ query: "How can I get my deposit back?", mode: "citizen" });
    expect(r.citations).toEqual([]);
    expect(r.summary).toContain("한국어 질문");
  });
});
