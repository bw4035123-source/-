import type { CaseItem } from "./types";
import { GENERIC_CASE, bigrams, normalize, queryTerms } from "./search";

/**
 * 판례·법령해석례 관련도 정리 — 국가법령정보 검색은 본문 검색(search=2)에서 긴 판결문이 낱말 하나만 언급해도 걸려
 * 엉뚱한 사건(예: '공유재산 사용허가' → 대통령기록물 사건)이 섞이므로, 목록의 제목만으로 다시 거른다.
 *  - 해석례 제목 앞의 질의기관 표기('민원인 - ', '고양시 - ')는 떼고 본다('민원' ≠ '민원인')
 *  - 여러 낱말이면 첫 낱말(중심어)이 제목에 있어야 한다('겸직 허가' → '인·허가 업무 분장' 제외)
 *  - 질문 낱말이 제목에 들어 있거나(낱말 일치) 2글자 묶음이 절반 이상 겹치는 것만 남기고, 일치가 많은 순으로
 *  - 같은 제목은 한 번만
 * Python 판(python/law_for_all/case_rank.py)과 같은 규칙.
 */
export function caseCoreTitle(c: Pick<CaseItem, "kind" | "title">): string {
  return c.kind === "법령해석례" ? c.title.replace(/^[^「」\-]{1,40}?\s+-\s*/, "") : c.title;
}

export function caseQueryTokens(query: string): string[] {
  const raw = query.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  return Array.from(new Set([...queryTerms(query, 6), ...raw].map(normalize).filter((w) => w.length >= 2)));
}

/** 여러 낱말 검색어의 중심어(첫 낱말) — 제목에 이 말이 없으면 곁가지 낱말('겸직 허가'의 '허가')만 같은 엉뚱한 건으로 본다. 첫 낱말이 넓은 말('공무원')이면 따지지 않음 */
export function caseHeadWord(query: string): string | null {
  const raw = query.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  const head = raw.length >= 2 ? normalize(raw[0]) : "";
  return head.length >= 2 && !GENERIC_CASE.has(head) ? head : null;
}

export function caseScore(query: string, c: Pick<CaseItem, "kind" | "title">): number {
  const title = normalize(caseCoreTitle(c));
  const head = caseHeadWord(query);
  if (head && !title.includes(head)) return 0;
  const hits = caseQueryTokens(query).filter((t) => title.includes(t)).length;
  const qg = bigrams(query);
  let over = 0;
  if (qg.size) {
    const tg = bigrams(caseCoreTitle(c));
    qg.forEach((g) => tg.has(g) && over++);
    over /= qg.size;
  }
  return hits ? hits * 2 + over : over >= 0.5 ? over : 0;
}

export function rankCases(query: string, items: CaseItem[], max: number): CaseItem[] {
  const seen = new Set<string>();
  return items
    .map((c, i) => ({ c, i, s: caseScore(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .filter(({ c }) => {
      const k = `${c.kind}:${normalize(caseCoreTitle(c))}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, max)
    .map((x) => x.c);
}
