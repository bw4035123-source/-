import { describe, expect, it } from "vitest";
import { extractQuantities, unverifiedQuantities } from "@/lib/answer/numbers";
import { guardLLMOutput } from "@/lib/answer/guard";
import type { Citation } from "@/lib/law-api/types";
import cases from "./fixtures/quantity-cases.json";

describe("수치 대조(금액·기간·비율)", () => {
  it("표기가 달라도 같은 값으로 읽음 — Python 판과 같은 고정 사례", () => {
    for (const c of cases.extract) expect(extractQuantities(c.text), c.text).toEqual(c.expect);
  });
  it("근거 원문에 없는 수치만 골라냄(같은 값의 다른 표기·별표 단위·사용자 질문 값은 통과)", () => {
    for (const c of cases.verify) expect(unverifiedQuantities(c.answer, c.sources), c.answer.join(" ")).toEqual(c.expect);
  });
  it("생성형 AI 답변의 숫자가 원문과 다르면 가드가 답변을 쓰지 않음(상위에서 규칙기반으로 대체)", () => {
    const ctx: Citation[] = [{ key: "labor-standards:36", lawId: "labor-standards", lawName: "근로기준법", lawKind: "법률", articleNo: "36", title: "금품 청산", text: "사용자는 근로자가 사망 또는 퇴직한 경우에는 그 지급 사유가 발생한 때부터 14일 이내에 임금, 보상금, 그 밖의 모든 금품을 지급하여야 한다.", url: "", source: "mock" }];
    const ok = { summary: "퇴직 후 14일 이내에 받아야 해요 [[labor-standards:36]]", steps: [], easyTerms: [], citations: ["labor-standards:36"] };
    expect(guardLLMOutput(ok, "citizen", ctx).summary).toContain("14일");
    expect(() => guardLLMOutput({ ...ok, summary: "퇴직 후 30일 이내에 받아야 해요 [[labor-standards:36]]" }, "citizen", ctx)).toThrow(/확인되지 않은 수치 1건: 30일/);
    // 사용자가 질문에 쓴 금액은 답변에 나와도 됨
    const withUser = { ...ok, summary: "못 받은 180만원은 14일 이내에 받아야 해요 [[labor-standards:36]]" };
    expect(() => guardLLMOutput(withUser, "citizen", ctx)).toThrow();
    expect(guardLLMOutput(withUser, "citizen", ctx, ["마지막 월급 180만원을 못 받았어요"]).summary).toContain("180만원");
  });
});
