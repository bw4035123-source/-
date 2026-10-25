import { MOCK_LAWS } from "../law-api/mock";
import { matchTopics, searchArticles } from "../law-api/search";
import type { Topic } from "../law-api/mock/topics";
import { articleKey } from "../law-api/util";

export interface Retrieval {
  topic?: Topic;
  /** 근거 후보 조문 키(중요도 순) */
  keys: string[];
}

/**
 * 근거 검색(RAG의 R): 토픽 라우팅 + 조문 2-gram 검색 결과를 합치고,
 * 위임 조문(시행령·시행규칙)을 함께 끌어와 3단 근거를 구성한다.
 */
export function retrieve(query: string, max = 8): Retrieval {
  const topic = matchTopics(query)[0]?.topic;
  const keys: string[] = [];
  const push = (k: string) => {
    if (!keys.includes(k)) keys.push(k);
  };
  if (topic) {
    topic.refs.forEach(push);
    topic.citizen.steps.forEach((s) => s.ref && push(s.ref));
  }
  // 토픽이 정해졌으면 조문 검색 결과는 그 토픽의 법령(과 하위법령)만 더함 — 글자만 겹친 다른 법(예: 청탁금지 질문에 주택임대차 '상한') 제외
  const topicLaws = new Set(topic ? topic.refs.map((k) => k.split(":")[0]) : []);
  for (const hit of searchArticles(query, 6)) {
    if (topic && !topicLaws.has(hit.law.id) && !topicLaws.has(hit.law.parentId ?? "")) continue;
    push(articleKey(hit.law.id, hit.article.no));
    hit.article.delegates?.forEach((d) => push(articleKey(d.lawId, d.articleNo)));
  }
  return { topic, keys: keys.slice(0, Math.max(max, topic ? topic.refs.length + 2 : max)) };
}

export function relatedLawsOf(keys: string[]) {
  const ids = Array.from(new Set(keys.map((k) => k.split(":")[0])));
  return ids
    .map((id) => MOCK_LAWS.find((l) => l.id === id))
    .filter((l): l is (typeof MOCK_LAWS)[number] => !!l)
    .map((l) => ({ id: l.id, name: l.name }));
}
