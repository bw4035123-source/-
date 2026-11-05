import { describe, expect, it } from "vitest";
import { amendDocs, complianceDocs, enactDocs, oldNewTableHtml, splitReason } from "@/lib/reg-report";

const D = new Date(2026, 10, 4);

describe("보고서 바로 만들기", () => {
  it("자체규정 점검 결과 보고: 집계·지적 사항·붙임", () => {
    const d = complianceDocs(
      {
        regName: "○○공단 취업규칙",
        orgType: "지방공기업",
        laws: ["근로기준법"],
        aiLabel: "업스테이지 Solar",
        items: [
          { label: "제3조(근무시간)", verdict: "상충", points: ["1주 근로시간이 법정 기준 초과 (근거: 「근로기준법」 제50조)"], current: "1주 44시간", amended: "1주 40시간" },
          { label: "제5조(휴가)", verdict: "적합", points: [] },
        ],
      },
      { dept: "경영지원팀", author: "홍길동", date: D },
    );
    expect(d.title).toBe("「○○공단 취업규칙」 상위법령 정합성 점검 결과 보고");
    expect(d.report).toContain("2026. 11. 4.  경영지원팀 (담당: 홍길동)");
    expect(d.report).toContain("상충 1건, 검토 필요 0건, 적합 1건, 판단 보류 0건");
    expect(d.report).toContain("가. 제3조(근무시간) — 상충");
    expect(d.report).toContain("「근로기준법」 제50조");
    expect(d.draft).toMatch(/^수신  내부결재/);
    expect(d.attachments.map((a) => a.title)).toEqual(["붙임 1. 조문별 점검 결과", "붙임 2. 신·구조문대비표"]);
    expect(d.attachments[1].html).toContain("<u><b>40시간</b></u>");
  });
  it("정비할 조문이 없으면 현행 유지, 신구대비표 붙임 없음", () => {
    const d = complianceDocs({ regName: "규정", orgType: "공공기관", laws: [], items: [{ label: "제1조(목적)", verdict: "적합", points: [] }] });
    expect(d.report).toContain("현행 유지");
    expect(d.attachments).toHaveLength(1);
  });
  it("개정이유 나누기", () => {
    const r = splitReason("◇ 개정이유\n  처리기간을 단축하려는 것임.\n\n◇ 주요내용\n  가. 7일을 5일로 단축함.");
    expect(r).toEqual({ why: ["처리기간을 단축하려는 것임."], main: ["7일을 5일로 단축함."] });
  });
  it("개정(안) 보고·제정(안) 보고", () => {
    const a = amendDocs({ lawName: "민원 처리 규정", kind: "행정규칙", label: "제5조(처리기간)", current: "7일 이내", amended: "5일 이내", reason: "◇ 개정이유\n  단축하려는 것임.\n◇ 주요내용\n  가. 7일을 5일로 함.", addenda: "부칙\n이 규정은 공포한 날부터 시행한다.", checks: [], effectiveDays: 30 }, { date: D });
    expect(a.title).toBe("「민원 처리 규정」 일부개정(안) 보고");
    expect(a.report).toContain("가. 7일을 5일로 함.");
    expect(a.report).toContain("공포(발령) 후 30일이 경과한 날부터 시행");
    expect(a.attachments[0].html).toContain("<s>7일</s>");
    const e = enactDocs({ name: "재택근무 운영 지침", kind: "행정규칙", fullText: "제1조(목적) 이 지침은…\n제2조(정의) …", reason: "◇ 제정이유\n  기준을 마련하려는 것임.\n◇ 주요내용\n  가. 신청 절차를 정함.", basis: ["「근로기준법」 제52조"], effectiveDays: 0 }, { date: D });
    expect(e.report).toContain("3. 조문 구성(총 2개 조)");
    expect(e.report).toContain("제1조(목적), 제2조(정의)");
  });
  it("표 HTML은 글자를 이스케이프", () => {
    expect(oldNewTableHtml([{ label: "<x>", current: "a<b", amended: "a<c" }])).not.toContain("<x>");
  });
});

describe("점검 → 한 번에 개정 보고", () => {
  it("바뀐 말 요약", async () => {
    const { changeSummary } = await import("@/lib/reg-report");
    expect(changeSummary("1일 9시간, 1주 45시간으로 한다.", "1일 8시간, 1주 40시간으로 한다.")).toBe("‘9시간’ → ‘8시간’, ‘45시간으로’ → ‘40시간으로’");
  });
  it("일부개정(안) 보고: 여러 조문·근거·부칙", async () => {
    const { batchAmendDocs } = await import("@/lib/reg-report");
    const d = batchAmendDocs({ regName: "복무 규정", kind: "행정규칙", effectiveDays: 0, items: [
      { label: "제8조(근무시간)", current: "1주 45시간", amended: "1주 40시간", verdict: "상충", basis: ["「근로기준법」 제50조"] },
      { label: "제35조(규정의 개정)", current: "이사장이 정한다.", amended: "근로자 과반수의 의견을 들어 이사장이 정한다.", verdict: "검토 필요", basis: ["「근로기준법」 제94조"] },
    ] }, { date: new Date(2026, 10, 6) });
    expect(d.title).toBe("「복무 규정」 일부개정(안) 보고");
    expect(d.report).toContain("2개 조문(제8조, 제35조)");
    expect(d.report).toContain("상충 1건·검토 필요 1건");
    expect(d.report).toContain("가. 제8조(근무시간): ‘45시간’ → ‘40시간’ (근거: 「근로기준법」 제50조)");
    expect(d.attachments[1].html).toContain("공포(발령)한 날부터 시행한다.");
    expect(d.attachments[0].html.match(/<tr>/g)).toHaveLength(3);
  });
});
