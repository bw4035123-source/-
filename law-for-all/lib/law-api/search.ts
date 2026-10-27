import type { LawArticle, LawDoc } from "./types";
import { MOCK_LAWS } from "./mock";
import { TOPICS, type Topic } from "./mock/topics";
import { LAW_ALIASES, type LawAlias } from "./mock/law-aliases";

/**
 * 경량 한국어 검색 엔진(외부 의존성·형태소 분석기 없음).
 * - 문자 2-gram 겹침으로 조사·어미 변화에 강하게 매칭
 * - 토픽 트리거(생활 표현) 정확 포함 시 가중치 부여
 */

/** 소문자화 + 공백·문장부호 제거(단, "5%" 같은 비율 표현을 위해 % 는 유지) */
export const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, "");

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

/** 트리거 일치 점수(0 = 불일치): "A+B"는 모든 말이 들어 있을 때만(순서 무관). nq 는 normalize 된 질문 */
export function triggerScore(nq: string, trigger: string): number {
  const parts = trigger.split("+").map(normalize);
  const len = parts.reduce((n, p) => n + p.length, 0);
  return len >= 2 && parts.every((p) => p.length >= 1 && nq.includes(p)) ? 2 + len * 0.5 : 0;
}

/** 생활 용어 → 법령 사전에서 질문에 해당하는 항목(실시간 검색 보조) */
export function matchLawAliases(query: string): LawAlias[] {
  const nq = normalize(query);
  // 두 글자 낱말(예: '산재')은 질문에서도 낱말 첫머리일 때만('화산재'≠'산재')
  const hit = (w: string) => (!w.includes("+") && normalize(w).length === 2 ? wordStartHas(query, w) : triggerScore(nq, w) > 0);
  return LAW_ALIASES.filter((a) => a.when.some(hit));
}

/** 판례 검색에 쓰기엔 너무 넓은 말(이 말만으로 찾으면 관계없는 판례가 섞임) */
export const GENERIC_CASE = new Set(["공무원", "기준", "경우", "가능", "방법", "사유", "절차", "관련", "문제", "내용", "금액", "정도", "기간", "신청", "처리", "여부", "규정", "법적", "법률"]);

/** 생활 용어 → 판결문에 쓰이는 말(판례 제목은 '최저시급'이 아니라 '최저임금'으로 적힘) */
const CASE_TERM: Record<string, string> = { 최저시급: "최저임금" };

/** 내장 토픽이 없는 질문(실시간 검색 답변)의 판례 검색어 — 생활 용어 사전에서 걸린 말을 우선, 없으면 넓은 말을 뺀 질문 낱말 두 개 */
export function liveCaseQuery(query: string): string | null {
  const nq = normalize(query);
  for (const a of LAW_ALIASES)
    for (const w of a.when) {
      const hit = !w.includes("+") && normalize(w).length === 2 ? wordStartHas(query, w) : triggerScore(nq, w) > 0;
      if (hit) return CASE_TERM[w] ?? w.replace(/\+/g, " ");
    }
  // 동사 꼬리가 남은 말(당했어·됐는 등)도 뺀다
  const terms = queryTerms(query, 6).filter((t) => !GENERIC_CASE.has(t) && !/(했어|됐어|했는|됐는|있어|없어|당했)$/.test(t));
  return terms.length ? terms.slice(0, 2).join(" ") : null;
}

/** 글 안에 말이 낱말 첫머리로 들어 있는지(맨 앞이거나 띄어쓰기·문장부호·가운뎃점 뒤) */
function wordStartHas(text: string, term: string): boolean {
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) if (i === 0 || /[\s\p{P}ㆍ·]/u.test(text[i - 1])) return true;
  return false;
}

/** 법령명에 검색어가 '낱말로' 들어 있는지 — 두 글자 말은 이름 첫머리나 띄어쓰기·가운뎃점 뒤에서만('사기'≠'군사기밀') */
export function lawNameHas(name: string, term: string): boolean {
  return term.length >= 3 ? name.includes(term) : wordStartHas(name, term);
}

export function matchTopics(query: string): TopicHit[] {
  const nq = normalize(query);
  const qg = bigrams(query);
  return TOPICS.map((topic) => {
    let score = 0;
    // 정규화하면 같은 표현(예: '처리 기한'·'처리기한')은 한 번만 계산.
    // "전세+사기"처럼 +로 이은 트리거는 모든 말이 들어 있을 때만(순서 무관) — 혼자서는 너무 넓은 말('사기'·'경매')을 문맥으로 좁힘
    for (const key of Array.from(new Set(topic.triggers.map((t) => t.split("+").map(normalize).join("+"))))) score += triggerScore(nq, key);
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

// ───────────── 실시간(국가법령정보 Open API) 검색용 질의어 추출
const STOP = new Set(["필요", "가능", "문제", "상황", "사람", "정도", "이유", "때문", "되나", "하나", "어디", "누가", "뭐가", "무슨", "있나", "없나", "어떻게", "어떤", "무엇", "뭔가요", "궁금", "궁금해요", "알려", "알려주세요", "있나요", "되나요", "하나요", "인가요", "경우", "관련", "대해", "대한", "기준", "방법", "절차", "내용", "얼마", "언제", "까지", "그리고", "하는", "하면", "해야", "있는", "없는", "됩니다", "합니다", "주세요", "싶어요", "문의"]);
const SUFFIX = /(으로부터|에서는|에게서|으로는|이라도|에서|에게|으로|이나|이랑|까지|부터|보다|처럼|마다|은|는|이|가|을|를|에|의|로|와|과|도|만|요|나|랑)$/;

/** 생활어 → 법령 용어(법령명·본문 검색이 잘 되는 말) */
const SYNONYM: Record<string, string> = {"술": "주류", "팔": "판매", "파는": "판매", "팔아": "판매", "강아지": "동물", "반려견": "동물", "고양이": "동물", "월급": "임금", "집주인": "임대인", "세입자": "임차인", "알바": "근로자", "담배": "담배", "차": "자동차"};
const VERB = /(받나요|받으면|받는|받나|받아|받|했는데요|했는데|했어요|되나요|하나요|됩니다|합니다|하려면|되려면|으려면|려면|하면|되면|되나|하나|되는|하는|되어|해서|해요|돼요|되|하|해|으면|면)$/;
/** 끝 글자가 조사처럼 보여도 명사의 일부인 말 */
const KEEP = /(허가|평가|국가|대가|단가|원가|시가|휴가|증가|추가|참가|전문가|주가|지가|차이|나이|아이|거리|자리|자료|도로|경로|진로|근로|노무|임대료|과태료|수수료|보험료)$/;

/** 질문 → 법령명·조문 검색어(2글자 이상 명사 위주, 조사 제거, 중복 제거, 긴 말 우선) */
export function queryTerms(query: string, max = 4): string[] {
  const out: string[] = [];
  for (const raw of query.split(/[^\p{L}\p{N}]+/u)) {
    let w = raw.trim();
    for (let i = 0; i < 2 && w.length > 2 && SUFFIX.test(w) && !KEEP.test(w); i++) w = w.replace(SUFFIX, "");
    if (w.length >= 2 && VERB.test(w) && !KEEP.test(w)) w = w.replace(VERB, "");
    if (SYNONYM[raw] || SYNONYM[w]) {
      const syn = SYNONYM[raw] ?? SYNONYM[w];
      if (!out.includes(syn)) out.push(syn);
      if (w.length < 2) continue;
    }
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, max);
}

/** 법령명과 검색어들의 2-gram 겹침 비율(0~1) */
export function bigramOverlap(name: string, terms: string[]): number {
  return overlap(bigrams(terms.join("")), bigrams(name));
}

/** 조문 관련도: 제목 일치 3점, 본문 일치 1점(검색어별) */
export function scoreArticleByTerms(article: Pick<LawArticle, "title" | "text">, terms: string[]): number {
  const title = normalize(article.title);
  const text = normalize(article.text);
  return terms.reduce((n, t) => {
    const k = normalize(t);
    return n + (title.includes(k) ? 3 : 0) + (text.includes(k) ? 1 : 0);
  }, 0);
}
