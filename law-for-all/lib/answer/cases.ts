import type { Topic } from "../law-api/mock/topics";
import type { CitizenAnswer } from "./types";
import { normalize } from "../law-api/search";

/**
 * 이런 경우라면 — 토픽에 검수된 상황별 안내 중 질문에 맞는 것을 앞에(when 낱말이 질문에 있으면), 최대 max개.
 * 문장은 생성하지 않고 검수된 데이터만 고른다(근거 표식 포함). Python 판 law_for_all/cases.py 와 같은 규칙.
 */
export function pickCases(topic: Topic | undefined, query: string, max = 3): NonNullable<CitizenAnswer["cases"]> {
  const all = topic?.citizen.cases ?? [];
  const q = normalize(query);
  return all
    .map((c, i) => ({ c, i, hit: c.when.some((w) => q.includes(normalize(w))) }))
    .sort((a, b) => Number(b.hit) - Number(a.hit) || a.i - b.i)
    .slice(0, max)
    .map(({ c }) => ({ situation: c.situation, detail: c.detail, ...(c.ref ? { ref: c.ref } : {}) }));
}
