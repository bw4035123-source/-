import { describe, expect, it } from "vitest";
import { citedLaws, fmtYmd, fromDateInput, mergeWatch, pendingUpdates, toDateInput } from "@/lib/law-watch";

const law = (name: string, promulgated: string, query = name) => ({ query, name, mst: "1", promulgated, effective: "", revision: "일부개정" });

describe("상위법 개정 알림", () => {
  it("규정 글에서 인용 법령 찾기(중복·법령 아닌 것 제외)", () => {
    expect(citedLaws("「근로기준법」 제50조 및 「근로기준법」 제93조, 「근로자퇴직급여 보장법」, 「공단 사보」")).toEqual(["근로기준법", "근로자퇴직급여 보장법"]);
  });
  it("기준일 이후 공포된 개정만 알림 · 약칭으로 등록해도 정식 이름 응답과 맞춤", () => {
    const items = [
      { name: "근로기준법", baseline: "20251231", addedAt: "20261105" },
      { name: "청탁금지법", baseline: "20250601", addedAt: "20261105" },
      { name: "산업안전보건법", baseline: "20261101", addedAt: "20261105" },
    ];
    const p = pendingUpdates(items, [law("근로기준법", "20260407"), law("부정청탁 및 금품등 수수의 금지에 관한 법률", "20250121", "청탁금지법"), law("산업안전보건법", "20261027")]);
    expect(p.map((x) => x.law.name)).toEqual(["근로기준법"]);
  });
  it("다시 등록하면 기준일은 더 이른 쪽", () => {
    const a = mergeWatch([], ["근로기준법"], "20260101", "규정 A");
    const b = mergeWatch(a, ["근로기준법", "지방공기업법"], "20250101");
    expect(b).toHaveLength(2);
    expect(b[0].baseline).toBe("20250101");
    expect(mergeWatch(b, ["근로 기준법"], "20260301")[0].baseline).toBe("20250101");
  });
  it("날짜 변환", () => {
    expect(fmtYmd("20260407")).toBe("2026. 4. 7.");
    expect(fromDateInput("2026-04-07")).toBe("20260407");
    expect(toDateInput("20260407")).toBe("2026-04-07");
  });
});
