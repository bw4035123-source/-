import { describe, expect, it } from "vitest";
import { caseBrief, caseCitation } from "@/lib/case-format";
import type { CaseDetail } from "@/lib/law-api/types";

const prec: CaseDetail = {
  kind: "판례", id: "1", title: "해고무효확인", caseNo: "2023두54914", court: "대법원", date: "20260129", judgmentType: "판결", url: "https://www.law.go.kr/precInfoP.do?precSeq=1",
  sections: [
    { label: "판시사항", text: "근로자에 대한 해고가\n정당한 이유가 있는지 판단하는 기준" },
    { label: "판결요지", text: "가".repeat(500) },
    { label: "참조조문", text: "근로기준법 제23조 제1항" },
    { label: "판결 전문", text: "전문은 요지에 넣지 않음" },
  ],
};
const expc: CaseDetail = {
  kind: "법령해석례", id: "2", title: "공무원의 겸직 허가 범위", caseNo: "24-0123", court: "법제처", date: "20240315", url: "https://www.law.go.kr/expcInfoP.do?expcSeq=2",
  sections: [{ label: "질의요지", text: "지방공무원이 ~ 할 수 있는지?" }, { label: "회답", text: "할 수 없습니다." }, { label: "이유", text: "이유는 넣지 않음" }],
};

describe("판례 인용·검토보고서 요지", () => {
  it("판례: 사건 표기 + 판시사항·판결요지(긴 글은 줄임)·참조조문, 전문은 제외", () => {
    expect(caseCitation(prec)).toBe("대법원 2026. 1. 29. 선고 2023두54914 판결");
    const b = caseBrief(prec);
    expect(b.split("\n")[0]).toBe("○ 관련 판례: 대법원 2026. 1. 29. 선고 2023두54914 판결 「해고무효확인」");
    expect(b).toContain("  - 판시사항: 근로자에 대한 해고가 정당한 이유가 있는지 판단하는 기준");
    expect(b).toMatch(/판결요지: 가{400}…/);
    expect(b).toContain("  - 참조조문: 근로기준법 제23조 제1항");
    expect(b).not.toContain("전문은");
    expect(b).toContain("출처: 국가법령정보센터(https://www.law.go.kr/precInfoP.do?precSeq=1)");
  });
  it("법령해석례: 질의요지·회답", () => {
    const b = caseBrief(expc);
    expect(b.split("\n")[0]).toContain("○ 관련 법령해석례: 법제처 법령해석례 24-0123");
    expect(b).toContain("  - 회답: 할 수 없습니다.");
    expect(b).not.toContain("이유는");
  });
});
