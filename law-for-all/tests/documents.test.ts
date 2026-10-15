import { describe, expect, it } from "vitest";
import { attachmentArticles, citedOnly, civilReply, draftDocument, reviewReport } from "@/lib/documents";

async function sample() {
  for (const k of ["LAW_API_OC", "LAW_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  const { ask } = await import("@/lib/answer/ask");
  return ask({ query: "질의민원 처리기간과 기간 계산 방법", mode: "officer" });
}

describe("공무원 문서 한 번에 작성", () => {
  it("검토 보고서: 결론·근거·검토 내용·판례·끝 표시", async () => {
    const r = await sample();
    const t = reviewReport(r, { dept: "민원정책과", author: "홍길동", cases: [{ kind: "판례", id: "1", title: "민원처리 사건", caseNo: "2025두1", court: "대법원", date: "20260101", url: "" }] });
    expect(t).toContain("민원정책과 (담당: 홍길동)");
    expect(t).toContain("2. 관련 근거");
    expect(t).toContain("「민원 처리에 관한 법률」 제18조(질의민원 등의 처리기간 등)");
    expect(t).toContain("대법원 2026. 1. 1. 2025두1 판결");
    expect(t.trim().endsWith("끝.")).toBe(true);
    expect(t).not.toMatch(/\[\[/);
  });
  it("기안문: 수신·제목·관련·붙임·끝", async () => {
    const t = draftDocument(await sample(), { dept: "민원정책과", author: "홍길동", phone: "02-000-0000" });
    expect(t.startsWith("수신  내부결재")).toBe(true);
    expect(t).toMatch(/제목 {2}.+검토 결과 보고/);
    expect(t).toContain("1. 관련\n  가. 「민원 처리에 관한 법률」");
    expect(t).toContain("2. 관련 조문 원문 1부.  끝.");
    expect(t).toContain("☎ 02-000-0000");
  });
  it("민원 회신문: 회신 문체·관련 법령·문의처", async () => {
    const t = civilReply(await sample(), { dept: "민원정책과" });
    expect(t).toContain("관계 법령을 검토한 결과를 다음과 같이 알려 드립니다");
    expect(t).not.toMatch(/함\./);
    expect(t.trim().endsWith("끝.")).toBe(true);
  });
  it("붙임: 인용 조문 원문", async () => {
    const r = await sample();
    expect(attachmentArticles(r)).toContain(citedOnly(r)[0].text.slice(0, 20));
  });
});

describe("문체 변환", async () => {
  const { toReportStyle, toFormalStyle } = await import("@/lib/documents");
  it("해요체 → 보고서체 / 합니다체", () => {
    expect(toReportStyle("처리 기한이 정해져 있어요. 토요일은 빼고 계산해요.")).toBe("처리 기한이 정해져 있음. 토요일은 빼고 계산함.");
    expect(toFormalStyle("기한이 정해져 있어요. 7일 이내예요. 검토함.")).toBe("기한이 정해져 있습니다. 7일 이내입니다. 검토합니다.");
  });
});
