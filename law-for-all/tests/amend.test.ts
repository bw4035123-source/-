import { describe, expect, it } from "vitest";
import { latestAmendment, recentAmendment } from "@/lib/law-api/amend";
import { getMockLaw } from "@/lib/law-api/mock";

describe("조문 개정 표시", () => {
  it("원문의 <개정>·<신설> 표시 중 가장 최근 날짜", () => {
    expect(latestAmendment("① 내용 <개정 2016.5.29, 2021.12.7>\n② 내용 <신설 2019.11.26>")?.label).toBe("2021.12.7");
    expect(latestAmendment("[별표 1] <개정 2024. 8. 27.> 음식물")?.iso).toBe("2024-08-27");
    expect(latestAmendment("개정 표시 없는 조문")).toBeNull();
  });

  it("최근 1년 안 개정만 '최근 개정'", () => {
    const now = new Date("2026-10-25T00:00:00+09:00");
    expect(recentAmendment("<개정 2026.6.30>", now)?.label).toBe("2026.6.30");
    expect(recentAmendment("<개정 2021.12.7>", now)).toBeNull();
    // 실제 내장 원문: 청탁금지법 시행령 제25조(별표 2, 2026.6.30 개정)
    const a = getMockLaw("anti-graft-decree")!.articles.find((x) => x.no === "25")!;
    expect(recentAmendment(a.text, now)?.label).toBe("2026.6.30");
  });
});
