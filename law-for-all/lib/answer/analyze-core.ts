import { getMockLaw } from "../law-api/mock";
import { PERSPECTIVES, type Perspectives, type Requirement } from "../law-api/mock/perspectives";
import { matchTopics, normalize, searchArticles, type TopicHit } from "../law-api/search";
import type { Citation } from "../law-api/types";
import { articleKey, articleLabel, parseArticleKey } from "../law-api/util";
import type { IssueAnalysis, LawRecommendation, ReqStatus, RolePerspectives } from "./types";

/**
 * 상황 분석 핵심 로직(순수 함수 — 서버 의존성 없음, 단위 테스트 대상)
 *   쟁점 발견 → 근거 후보 수집 → 법령 추천 순위화 → 역할별 관점 조립(요건 사실 대조)
 */

const MAX_ISSUES = 3;

/** 형벌 조항 여부(조문 제목 기준) */
const isPenal = (title: string) => ["벌칙", "사기", "경범죄의 종류"].includes(title);

/** 하나의 상황에 여러 쟁점이 섞일 수 있음(예: 보증금 미반환 + 사기 정황) */
export function spotIssues(text: string): TopicHit[] {
  const hits = matchTopics(text);
  if (!hits.length) return [];
  const top = hits[0].score;
  // 생활 표현 하나라도 정확히 일치(점수 3 이상)하면 별도 쟁점으로 인정
  return hits.filter((h) => h.score >= Math.min(3, top)).slice(0, MAX_ISSUES);
}

export function collectKeys(text: string, issues: TopicHit[]): string[] {
  const keys: string[] = [];
  const push = (k: string) => !keys.includes(k) && getMockLaw(k.split(":")[0]) && keys.push(k);
  for (const { topic } of issues) {
    topic.refs.forEach(push);
    PERSPECTIVES[topic.id]?.extraRefs?.forEach(push);
    topic.citizen.steps.forEach((s) => s.ref && push(s.ref));
  }
  // 쟁점이 잡힌 경우 조문 검색은 강한 일치만 보탬(우연한 단어 일치로 무관한 법령이 섞이지 않도록)
  const minScore = issues.length ? 3 : 1;
  for (const h of searchArticles(text, 6).filter((x) => x.score >= minScore)) {
    push(articleKey(h.law.id, h.article.no));
    h.article.delegates?.forEach((d) => push(articleKey(d.lawId, d.articleNo)));
  }
  return keys.slice(0, 14);
}

/** 상황 서술에 실제로 등장한 표현(설명 가능한 추천 사유용) */
function matchedTerms(text: string, terms: string[]): string[] {
  const n = normalize(text);
  const seen = new Set<string>();
  return terms
    .filter((t) => {
      const nt = normalize(t);
      if (nt.length < 2 || !n.includes(nt) || seen.has(nt)) return false;
      seen.add(nt);
      return true;
    })
    .slice(0, 3);
}

/** 법령 추천 순위 — 점수와 함께 '왜 추천했는지'를 사람이 읽을 수 있게 제시 */
export function rankRecommendations(text: string, issues: TopicHit[], keys: string[]): LawRecommendation[] {
  const searchScore = new Map(searchArticles(text, 14).map((h) => [articleKey(h.law.id, h.article.no), h.score]));
  const recs = keys.map((key) => {
    const p = parseArticleKey(key)!;
    const law = getMockLaw(p.lawId)!;
    const art = law.articles.find((a) => a.no === p.articleNo)!;
    let score = (searchScore.get(key) ?? 0) * 0.6;
    let issue: string | undefined;
    issues.forEach(({ topic }, ii) => {
      const idx = topic.refs.indexOf(key);
      const issueWeight = 1 - ii * 0.2;
      if (idx >= 0) {
        score += (4 - Math.min(idx, 3) * 0.6) * issueWeight;
        issue ??= topic.label;
      } else if (PERSPECTIVES[topic.id]?.extraRefs?.includes(key)) {
        score += 2 * issueWeight;
        issue ??= topic.label;
      } else if (topic.citizen.steps.some((s) => s.ref === key)) {
        score += 1.2 * issueWeight;
        issue ??= topic.label;
      }
    });
    if (law.kind !== "법률") score *= 0.9; // 같은 조건이면 상위법 우선

    // 사유 표현: 조문 키워드 우선, 없으면 해당 쟁점의 생활 표현
    const ownIssue = issues.find((i) => i.topic.label === issue);
    let terms = matchedTerms(text, art.keywords ?? []);
    if (!terms.length && ownIssue) terms = matchedTerms(text, ownIssue.topic.triggers);
    const role =
      isPenal(art.title) ? "위법성·처벌 검토 근거" : law.kind === "법률" ? "핵심 권리·의무 근거" : `상위법 위임에 따른 세부 기준(${law.kind})`;
    const reason = [
      terms.length ? `‘${terms.join("’, ‘")}’ 표현과 관련` : "",
      issue ? `쟁점 「${issue}」의 ${role}` : role,
    ]
      .filter(Boolean)
      .join(" · ");
    return { key, score: Math.round(score * 100) / 100, issue, reason } as LawRecommendation;
  });
  recs.sort((a, b) => b.score - a.score);
  const top = recs[0]?.score || 1;
  return recs.map((r) => ({ ...r, relevance: r.score >= top * 0.65 ? "high" : r.score >= top * 0.35 ? "medium" : "low" }));
}

/** 판사 관점: 법률 요건을 상황 서술과 대조 */
export function evaluateRequirement(text: string, req: Requirement): { status: ReqStatus; basis: string } {
  const n = normalize(text);
  const has = (w: string) => normalize(w).length >= 2 && n.includes(normalize(w));
  const neg = (req.neg ?? []).find(has);
  if (neg) return { status: "unmet", basis: `‘${neg}’라는 서술 — 요건이 충족되지 않을 수 있음` };
  const fact = req.facts.find(has);
  if (fact) return { status: "met", basis: `‘${fact}’ 서술로 사실관계 확인` };
  return { status: "unclear", basis: "서술에서 확인되지 않음 — 추가 사실 확인 필요" };
}

function fromKnowledge(text: string, p: Perspectives): RolePerspectives {
  return {
    lawyer: p.lawyer,
    prosecutor: p.prosecutor,
    judge: {
      stance: p.judge.stance,
      issues: p.judge.issues,
      requirements: p.judge.requirements.map((r) => ({ label: r.label, ref: r.ref, ...evaluateRequirement(text, r) })),
      outlook: p.judge.outlook,
    },
  };
}

/** 토픽 지식베이스가 없을 때: 검색된 조문 원문만으로 관점 틀을 구성 */
function generic(citations: Citation[]): RolePerspectives {
  const top = citations.slice(0, 3);
  const cite = (c: Citation) => `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title}) [[${c.key}]]`;
  const penal = citations.filter((c) => isPenal(c.title));
  return {
    lawyer: {
      stance: "검색된 관련 조문을 근거로 질문자에게 유리한 주장 가능성을 검토합니다.",
      arguments: top.map((c) => `${cite(c)}의 적용을 주장할 수 있는지 검토`),
      evidence: ["사건 경위를 시간 순으로 정리한 메모", "계약서·통지문 등 문서", "문자·녹음 등 대화 기록"],
      strategy: ["근거 조문 원문 확인 후 전문가 상담(대한법률구조공단 132)"],
    },
    prosecutor: {
      stance: penal.length ? "검색된 근거 중 처벌 조항의 구성요건 해당 여부를 검토합니다." : "검색된 근거에서 형벌 조항은 확인되지 않습니다.",
      violations: penal.map((c) => `${cite(c)}의 구성요건 해당 여부`),
      sanctions: [],
      proofPoints: [],
    },
    judge: {
      stance: "관련 조문의 요건과 사실관계를 대조해 판단해야 합니다.",
      issues: top.map((c) => `${articleLabel(c.articleNo)}(${c.title})의 요건 충족 여부`),
      requirements: top.map((c) => ({ label: `${c.lawName} ${articleLabel(c.articleNo)}(${c.title}) 요건`, ref: c.key, status: "unclear" as ReqStatus, basis: "규칙기반 요건 사전이 없는 조문 — 원문 대조 필요" })),
      outlook: "요건별 사실관계가 더 구체적으로 확인되어야 판단할 수 있습니다.",
    },
  };
}

export function buildRuleAnalyses(text: string, issues: TopicHit[], citations: Citation[]): IssueAnalysis[] {
  const out: IssueAnalysis[] = issues
    .filter(({ topic }) => PERSPECTIVES[topic.id])
    .map(({ topic }) => ({ issue: { id: topic.id, label: topic.label }, perspectives: fromKnowledge(text, PERSPECTIVES[topic.id]) }));
  if (!out.length && citations.length) out.push({ issue: { id: "general", label: "관련 조문 검토" }, perspectives: generic(citations) });
  return out;
}

/** 요건 충족 요약(판사 관점 배지용) */
export function requirementSummary(a: IssueAnalysis) {
  const r = a.perspectives.judge.requirements;
  return { met: r.filter((x) => x.status === "met").length, unclear: r.filter((x) => x.status === "unclear").length, unmet: r.filter((x) => x.status === "unmet").length, total: r.length };
}
