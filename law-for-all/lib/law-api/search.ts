import type { LawArticle, LawDoc } from "./types";
import { MOCK_LAWS } from "./mock";
import { TOPICS, type Topic } from "./mock/topics";

/**
 * 경량 한국어 검색 엔진(외부 의존성·형태소 분석기 없음).
 * - 문자 2-gram 겹침으로 조사·어미 변화에 강하게 매칭
 * - 토픽 트리거(생활 표현) 정확 포함 시 가중치 부여
 */

export const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

export function bigrams(s: string): Set<string> {
  const n = normalize(s);
  const out = new Set<string>();
  if (n.length === 1) out.add(n);
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

function overlap(q: Set<string>, target: Set<string>): number {
  if (!q.size || !target.size) return 0;
  let hit = 0;
  q.forEach((g) => {
    if (target.has(g)) hit++;
  });
  return hit / q.size;
}

export interface TopicHit {
  topic: Topic;
  score: number;
}

export interface ArticleHit {
  law: LawDoc;
  article: LawArticle;
  score: number;
}

export function matchTopics(query: string): TopicHit[] {
  const nq = normalize(query);
  const qg = bigrams(query);
  return TOPICS.map((topic) => {
    let score = 0;
    for (const t of topic.triggers) {
      const nt = normalize(t);
      if (nt && nq.includes(nt)) score += 2 + nt.length * 0.5;
    }
    score += overlap(qg, bigrams(topic.label + topic.triggers.join(" "))) * 2;
    return { topic, score };
  })
    .filter((h) => h.score >= 1.2)
    .sort((a, b) => b.score - a.score);
}

const articleIndex = MOCK_LAWS.flatMap((law) =>
  law.articles.map((article) => ({
    law,
    article,
    titleGrams: bigrams(`${law.name} ${law.shortName ?? ""} ${article.title}`),
    keyGrams: bigrams((article.keywords ?? []).join(" ")),
    textGrams: bigrams(article.text),
    keywords: (article.keywords ?? []).map(normalize),
  })),
);

export function searchArticles(query: string, limit = 8): ArticleHit[] {
  const nq = normalize(query);
  const qg = bigrams(query);
  if (!nq) return [];
  return articleIndex
    .map((e) => {
      let score = overlap(qg, e.titleGrams) * 3 + overlap(qg, e.keyGrams) * 3 + overlap(qg, e.textGrams) * 1.5;
      for (const k of e.keywords) if (k.length >= 2 && nq.includes(k)) score += 2;
      if (nq.includes(normalize(e.law.name))) score += 1.5;
      return { law: e.law, article: e.article, score };
    })
    .filter((h) => h.score >= 1.0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 법령명 검색(목록 화면용) */
export function searchLawNames(query: string): LawDoc[] {
  const nq = normalize(query);
  if (!nq) return MOCK_LAWS;
  const qg = bigrams(query);
  return MOCK_LAWS.map((law) => {
    const hay = `${law.name} ${law.shortName ?? ""} ${law.articles.map((a) => a.title + " " + (a.keywords ?? []).join(" ")).join(" ")}`;
    let s = overlap(qg, bigrams(hay));
    if (normalize(law.name).includes(nq) || normalize(law.shortName ?? "").includes(nq)) s += 2;
    return { law, s };
  })
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.law);
}
