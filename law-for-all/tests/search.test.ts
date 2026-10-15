import { describe, expect, it } from "vitest";
import { matchTopics, searchArticles, bigrams } from "@/lib/law-api/search";
import { retrieve } from "@/lib/answer/retrieve";

describe("검색 엔진", () => {
  it("2-gram 생성", () => {
    expect(Array.from(bigrams("층간 소음"))).toEqual(["층간", "간소", "소음"]);
  });

  it.each([
    ["윗집 층간소음 기준이 어떻게 되나요?", "floor-noise"],
    ["주택임대차 보증금 돌려받으려면?", "deposit-return"],
    ["전세사기 예방하려면 뭘 확인해야 해요", "jeonse-fraud"],
    ["육아휴직 급여 얼마 받나요", "parental-leave"],
    ["민원 처리 기한이 며칠이에요", "petition-deadline"],
    ["퇴사했는데 월급을 안 줘요", "unpaid-wages"],
    ["음주운전 처벌 기준", "drunk-driving"],
  ])("'%s' → 토픽 %s", (q, id) => {
    expect(matchTopics(q)[0]?.topic.id).toBe(id);
  });

  it("조문 검색: 혈중알코올농도 → 도로교통법 제44조", () => {
    const hits = searchArticles("혈중알코올농도 기준");
    expect(hits[0].law.id).toBe("road-traffic");
    expect(hits[0].article.no).toBe("44");
  });

  it("관련 없는 질의는 토픽 없음", () => {
    expect(matchTopics("오늘 날씨 어때")).toHaveLength(0);
  });

  it("retrieve: 위임 조문(시행령)까지 근거로 포함", () => {
    const r = retrieve("소액임차인 최우선변제 금액");
    expect(r.keys).toContain("housing-lease:8");
    expect(r.keys).toContain("housing-lease-decree:10");
  });
});

describe("추천 해시태그 라우팅", async () => {
  const { CITIZEN_SUGGESTIONS, OFFICER_SUGGESTIONS } = await import("@/lib/suggestions");
  it.each([...CITIZEN_SUGGESTIONS, ...OFFICER_SUGGESTIONS].map((s) => [s.label, s.query, s.topic]))("#%s → %s", (_l, q, topic) => {
    expect(matchTopics(q)[0]?.topic.id).toBe(topic);
  });
});
