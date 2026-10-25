import { describe, expect, it } from "vitest";
import { matchTopics } from "@/lib/law-api/search";
import cases from "./fixtures/routing-cases.json";
import holdout from "./fixtures/routing-holdout.json";
import blindV1 from "./fixtures/routing-blind.json";

/** 토픽 라우팅 회귀 시험 — 실제 말투의 질문이 맞는 상황으로, 헷갈리는 질문은 다른 상황으로 끌려가지 않게 */
describe("토픽 라우팅", () => {
  for (const [name, set] of [["대표 질문", cases], ["검증용 별도 질문", holdout], ["1차 블라인드(개선 후 회귀)", blindV1]] as const) {
    it(`${name} ${set.cases.length}건`, () => {
      const wrong = set.cases
        .map((c) => ({ ...c, got: matchTopics(c.q)[0]?.topic.id ?? null }))
        .filter((c) => c.got !== c.topic)
        .map((c) => `${c.q} — 기대 ${c.topic} / 실제 ${c.got}`);
      expect(wrong).toEqual([]);
    });
  }
});
