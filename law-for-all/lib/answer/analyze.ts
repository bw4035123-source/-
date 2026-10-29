import "server-only";
import { serverConfig } from "../config";
import { LawService } from "../law-api/client";
import { getTopic, type Contact } from "../law-api/mock/topics";
import { resolveProvider } from "../llm/registry";
import { buildRuleAnalyses, collectKeys, rankRecommendations, spotIssues } from "./analyze-core";
import { extractFacts } from "./facts";
import { findUnverifiedMentions, guardAnalysisOutput, parseLooseJson } from "./guard";
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, buildAnalysisPrompt } from "./prompts";
import type { AnalyzeResult, IssueAnalysis } from "./types";
import { maskNotice, maskPII } from "../privacy-mask";

const DEFAULT_CONTACTS: Contact[] = [
  { name: "대한법률구조공단", phone: "132", url: "https://www.klac.or.kr", desc: "무료 법률상담·소송 지원" },
  { name: "정부민원안내콜센터", phone: "110", desc: "소관 기관 안내" },
];

/**
 * 상황 분석 파이프라인
 *   사실관계 추출 → 쟁점 발견 → 근거 수집·원문 확보 → 법령 추천 순위 → 3관점 분석(LLM 또는 규칙) → 가드
 */
export async function analyze({ situation: raw, provider: requested }: { situation: string; provider?: string }): Promise<AnalyzeResult> {
  const started = Date.now();
  // 상황 설명 속 개인정보(주민등록번호·전화번호 등)는 분석·AI로 넘기기 전에 가린다
  const { text: situation, found: masked } = maskPII(raw);
  const notices: string[] = masked.length ? [maskNotice(masked)] : [];
  const svc = new LawService(serverConfig.lawAccess);

  const facts = extractFacts(situation);
  const issues = spotIssues(situation);
  const keys = collectKeys(situation, issues);
  const recommendations = rankRecommendations(situation, issues, keys);
  // 추천 순서대로 근거 카드 구성(실시간 모드면 최신 원문)
  const citations = await svc.getCitations(recommendations.map((r) => r.key));

  const { provider, notice } = resolveProvider(serverConfig.llm, requested);
  if (notice) notices.push(notice);
  let usedProvider = { id: provider.id as string, label: provider.label, model: provider.model, kind: provider.kind };

  let analyses: IssueAnalysis[] = buildRuleAnalyses(situation, issues, citations);
  let removed: string[] = [];
  let unverified = findUnverifiedMentions(JSON.stringify(analyses).replace(/\\n/g, " "), citations);
  let fallbackReason: string | undefined;

  if (provider.kind === "llm") {
    if (!citations.length) {
      fallbackReason = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다.";
    } else {
      try {
        const res = await provider.generate({
          system: ANALYSIS_SYSTEM,
          messages: [{ role: "user", content: buildAnalysisPrompt(situation, citations) }],
          json: true,
          schema: ANALYSIS_SCHEMA,
          temperature: 0.1,
          maxTokens: 2500,
        });
        const g = guardAnalysisOutput(parseLooseJson(res.text), citations, [situation]);
        usedProvider = { ...usedProvider, model: res.model || provider.model };
        analyses = [{ issue: { id: "ai", label: issues.length ? `종합 분석(${issues.map((i) => i.topic.label).join("·")})` : "종합 분석" }, perspectives: g.perspectives }];
        removed = g.removed;
        unverified = g.unverified;
      } catch (e) {
        fallbackReason = `${provider.label} 응답을 검증하지 못해 규칙기반 분석으로 대체했습니다(${(e as Error).message}).`;
        usedProvider = { id: "mock", label: "규칙기반 엔진(LLM 없음)", model: "law-rule-engine-v1", kind: "rule" };
      }
    }
  }
  if (fallbackReason) notices.push(fallbackReason);
  if (removed.length) notices.push(`근거 목록에 없는 인용 ${removed.length}건을 자동 제거했습니다.`);
  if (!issues.length) notices.push("상황에서 뚜렷한 생활 법률 쟁점을 찾지 못해 조문 검색 결과로 분석했습니다. 당사자·행위·금액·시점을 더 구체적으로 적으면 정확도가 올라갑니다.");
  notices.push(...svc.warnings);

  const contacts: Contact[] = [];
  for (const { topic } of issues) for (const c of getTopic(topic.id)?.contacts ?? []) if (!contacts.some((x) => x.name === c.name)) contacts.push(c);

  return {
    situation,
    facts,
    issues: issues.map((i) => ({ id: i.topic.id, label: i.topic.label, score: Math.round(i.score * 10) / 10 })),
    recommendations: recommendations.filter((r) => citations.some((c) => c.key === r.key)),
    analyses,
    citations,
    contacts: contacts.length ? contacts.slice(0, 5) : DEFAULT_CONTACTS,
    caseQuery: issues[0]?.topic.caseQuery ?? null,
    provider: usedProvider,
    guard: { removedCitations: removed, unverifiedMentions: unverified, fallbackReason, passed: unverified.length === 0 },
    dataSource: citations.some((c) => c.source === "live") ? "live" : "mock",
    notices: Array.from(new Set(notices)),
    elapsedMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}
