import { describe, expect, it } from "vitest";
import { buildCompliancePrompt, guardCompliance, type AiArticleInput } from "@/lib/compliance-ai";

const UP = { key: "labor-standards:50", label: "「근로기준법」 제50조(근로시간)", text: "① 1주 간의 근로시간은 휴게시간을 제외하고 40시간을 초과할 수 없다." };
const A: AiArticleInput[] = [
  { no: "8", label: "제8조(근무시간)", text: "직원의 근무시간은 1주 45시간으로 한다.", upper: [UP] },
  { no: "9", label: "제9조(서식)", text: "신청서 서식은 별지와 같다.", upper: [] },
];

describe("자체규정 AI 검토 가드", () => {
  it("근거 키가 붙은 지적만 남기고, 조문 번호 표기 차이는 맞춰 줌", () => {
    const r = guardCompliance(
      { articles: [{ no: "제8조", verdict: "상충", issues: [{ point: "1주 45시간은 법정 40시간을 초과함", basis: ["[[labor-standards:50]]"], suggestion: "1주 40시간 이내로 고침" }] }, { no: "9", verdict: "적합", issues: [] }] },
      A,
    );
    expect(r[0]).toMatchObject({ no: "8", verdict: "상충", dropped: 0 });
    expect(r[0].issues[0].basis).toEqual(["labor-standards:50"]);
    // 상위 조문이 없는 조문의 '적합'은 판단 보류
    expect(r[1].verdict).toBe("판단 보류");
  });
  it("근거 밖 조문·지어낸 수치 지적은 버리고, 남은 지적이 없으면 판단 보류", () => {
    const r = guardCompliance({ articles: [{ no: "8", verdict: "상충", issues: [{ point: "주 52시간 초과", basis: ["labor-standards:50"], suggestion: "" }, { point: "연장근로 제한 위반", basis: ["labor-standards:53"], suggestion: "" }] }] }, A);
    expect(r[0]).toMatchObject({ verdict: "판단 보류", issues: [], dropped: 2 });
    expect(r[0].note).toContain("2건");
  });
  it("답이 없거나 형식이 깨지면 판단 보류", () => {
    expect(guardCompliance(null, A).map((x) => x.verdict)).toEqual(["판단 보류", "판단 보류"]);
    expect(guardCompliance({ articles: [{ no: "8", verdict: "위반임", issues: [] }] }, A)[0].verdict).toBe("판단 보류");
  });
  it("프롬프트에 조문별 상위 조문 키와 원문", () => {
    const p = buildCompliancePrompt("복무 규정", "지방공기업", A);
    expect(p).toContain("<<조문 no=8>> 제8조(근무시간)");
    expect(p).toContain("[[labor-standards:50]] 「근로기준법」 제50조(근로시간)");
    expect(p).toContain("(찾은 상위조문 없음)");
  });
});
