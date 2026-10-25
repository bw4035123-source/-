import { describe, expect, it } from "vitest";
import { RAW_LAWS } from "@/lib/law-api/mock/raw";
import { getMockLaw } from "@/lib/law-api/mock";

/** 사람이 적은 별표 요지(금액·기준표)가 공식 원문 스냅샷으로 덮어써도 빠지지 않는지 — 층간소음 기준표가 동기화 중 사라졌던 사례 재발 방지 */
describe("별표 요지 보존", () => {
  it("내장 조문의 별표 요지가 스냅샷 적용 후에도 그대로", () => {
    let n = 0;
    for (const law of RAW_LAWS)
      for (const a of law.articles) {
        const lines = a.text.split("\n");
        const i = lines.findIndex((l) => l.startsWith("[별표"));
        if (i < 0) continue;
        n++;
        const merged = getMockLaw(law.id)!.articles.find((x) => x.no === a.no)!.text;
        expect(merged, `${law.id}:${a.no}`).toContain(lines.slice(i).join("\n"));
      }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(getMockLaw("floor-noise-rule")!.articles.find((x) => x.no === "3")!.text).toContain("주간(06:00~22:00) 39");
  });
});
