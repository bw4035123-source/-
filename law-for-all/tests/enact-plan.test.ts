import { describe, expect, it } from "vitest";
import { buildPlanPrompt, guardPlan } from "@/lib/enact-plan";

const EV = [
  { key: "mst-1:29", label: "「산업안전보건법」 제29조(근로자에 대한 안전보건교육)", text: "사업주는 소속 근로자에게 정기적으로 안전보건교육을 하여야 한다." },
  { key: "mst-1:36", label: "「산업안전보건법」 제36조(위험성평가의 실시)", text: "사업주는 유해·위험 요인을 찾아내어 위험성평가를 하여야 한다." },
];

describe("한 줄 제정 설계 가드", () => {
  it("찾은 조문 키만 근거로, 벌칙 조문·목적·번호는 걸러 냄", () => {
    const p = guardPlan({ name: "○○공단 산업안전보건 관리 지침", kind: "행정규칙", purpose: "안전보건 관리 기준을 정하기 위함", items: ["1. 안전보건교육", "위험성평가", "목적", "위반 시 과태료", "위험성평가"], terms: ["위험성평가"], basis: ["[[mst-1:29]]", "mst-9:1"] }, EV);
    expect(p.items).toEqual(["안전보건교육", "위험성평가"]);
    expect(p.basis).toEqual(["mst-1:29"]);
    expect(p.notes.join()).toContain("과태료");
  });
  it("근거를 못 고르면 검색 상위 조문을 넣고 알림, 이상한 kind는 행정규칙", () => {
    const p = guardPlan({ name: "", kind: "법률", items: ["안전보건교육"], basis: [] }, EV, "도봉구시설관리공단");
    expect(p).toMatchObject({ name: "도봉구시설관리공단 규정", kind: "행정규칙", basis: ["mst-1:29", "mst-1:36"] });
    expect(p.notes.join()).toContain("확인하세요");
  });
  it("프롬프트에 요청·기관·상위 조문 키", () => {
    const t = buildPlanPrompt("산업안전보건 지침 만들어줘", "○○공단", EV);
    expect(t).toContain("[[mst-1:29]] 「산업안전보건법」 제29조");
    expect(t).toContain("<기관>○○공단</기관>");
  });
});
