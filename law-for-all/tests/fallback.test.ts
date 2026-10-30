import { describe, expect, it } from "vitest";
import { llmFallback } from "@/lib/answer/fallback";
import { LLMError } from "@/lib/llm/types";

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
