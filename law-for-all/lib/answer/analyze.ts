import "server-only";
import { serverConfig } from "../config";
import { LawService } from "../law-api/client";
import { getTopic, type Contact } from "../law-api/mock/topics";
import { resolveProvider } from "../llm/registry";
import { buildRuleAnalyses, collectKeys, rankRecommendations, spotIssues } from "./analyze-core";
import { extractFacts } from "./facts";
import { findUnverifiedMentions, guardAnalysisOutput, parseLooseJson } from "./guard";
import { ANALYSIS_ROLES, ANALYSIS_SYSTEM, ROLE_LABEL, buildRolePrompt, roleSchema, type AnalysisRole } from "./prompts";
import { LLMError } from "../llm/types";
import type { AnalyzeResult, IssueAnalysis } from "./types";
import { maskNotice, maskPII } from "../privacy-mask";
import { llmFallback, NO_EVIDENCE_REASON, type FallbackKind } from "./fallback";

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
  let recommendations = rankRecommendations(situation, issues, keys);
  // 내장 데이터에서 근거를 못 찾으면 질의응답과 같이 생활 용어 사전·국가법령정보 실시간 검색으로 근거를 찾는다
  if (!recommendations.length && svc.mode === "live") {
    const live = await svc.searchLiveKeys(situation);
    recommendations = live.map((key, i) => ({ key, score: live.length - i, reason: "국가법령정보 실시간 검색으로 찾은 근거", relevance: i < 2 ? "high" : "medium" }));
  }
  // 추천 순서대로 근거 카드 구성(실시간 모드면 최신 원문)
  const citations = await svc.getCitations(recommendations.map((r) => r.key));

  const { provider, notice } = resolveProvider(serverConfig.llm, requested);
  if (notice) notices.push(notice);
  let usedProvider = { id: provider.id as string, label: provider.label, model: provider.model, kind: provider.kind };

  let analyses: IssueAnalysis[] = buildRuleAnalyses(situation, issues, citations);
  let removed: string[] = [];
  let unverified = findUnverifiedMentions(JSON.stringify(analyses).replace(/\\n/g, " "), citations);
  let fallbackReason: string | undefined;
  let fallbackNotice: string | undefined;
  let fallbackKind: FallbackKind | undefined;

  if (provider.kind === "llm") {
    if (!citations.length) {
      fallbackReason = fallbackNotice = NO_EVIDENCE_REASON;
      fallbackKind = "no-evidence";
    } else {
      try {
        // 변호사·검사·판사를 동시에 따로 씀(한 번에 쓰면 20~65초) — 늦은 관점만 규칙기반 분석으로 채움
        const deadline = Date.now() + 60000;
        let model = provider.model;
        const one = async (role: AnalysisRole): Promise<{ part: unknown; cites: unknown } | null> => {
          for (let attempt = 0; attempt < 2; attempt++) {
            const left = deadline - Date.now();
            if (left < 8000) return null;
            try {
              const res = await provider.generate({
                system: ANALYSIS_SYSTEM,
                messages: [{ role: "user", content: buildRolePrompt(situation, citations, role) }],
                json: true,
                schema: roleSchema(role),
                temperature: 0.1,
                maxTokens: 1400,
                timeoutMs: Math.min(45000, left),
              });
              model = res.model || model;
              const raw = parseLooseJson(res.text) as Record<string, unknown> | null;
              const part = raw && typeof raw[role] === "object" ? raw[role] : raw && "stance" in raw ? raw : null;
              if (part) return { part, cites: raw?.citations };
            } catch {
              /* 연결 지연·형식 오류 → 한 번 다시 */
            }
          }
          return null;
        };
        const outs = await Promise.all(ANALYSIS_ROLES.map(one));
        if (outs.every((o) => !o)) throw new LLMError("세 관점 모두 응답 없음", provider.id);
        // 관점별로 합쳐 가드 — 검증에 걸린 관점만 규칙기반으로 바꿔 다시 확인(근거 밖 수치 하나로 세 관점을 다 버리지 않음)
        const rule = analyses[0]?.perspectives as Record<AnalysisRole, unknown> | undefined;
        const slow = ANALYSIS_ROLES.filter((_, i) => !outs[i]);
        const build = (ai: AnalysisRole[]) => {
          const m: Record<string, unknown> = { citations: ai.flatMap((r) => { const c = outs[ANALYSIS_ROLES.indexOf(r)]?.cites; return Array.isArray(c) ? c : []; }) };
          for (const r of ANALYSIS_ROLES) m[r] = ai.includes(r) ? outs[ANALYSIS_ROLES.indexOf(r)]!.part : rule?.[r];
          return m;
        };
        const ai = ANALYSIS_ROLES.filter((_, i) => outs[i]);
        let bad: AnalysisRole[] = [];
        let g: ReturnType<typeof guardAnalysisOutput>;
        try {
          g = guardAnalysisOutput(build(ai), citations, [situation]);
        } catch (e) {
          if (!rule) throw e;
          bad = ai.filter((r) => {
            try {
              guardAnalysisOutput(build([r]), citations, [situation]);
              return false;
            } catch {
              return true;
            }
          });
          const keep = ai.filter((r) => !bad.includes(r));
          if (!keep.length) throw new Error("세 관점 모두 근거 검증을 통과하지 못했습니다");
          g = guardAnalysisOutput(build(keep), citations, [situation]);
        }
        usedProvider = { ...usedProvider, model };
        analyses = [{ issue: { id: "ai", label: issues.length ? `종합 분석(${issues.map((i) => i.topic.label).join("·")})` : "종합 분석" }, perspectives: g.perspectives }];
        removed = g.removed;
        unverified = g.unverified;
        if (slow.length) notices.push(`${slow.map((r) => ROLE_LABEL[r]).join("·")} 관점은 AI 응답이 늦어 규칙기반 분석으로 보여 드려요.`);
        if (bad.length) notices.push(`${bad.map((r) => ROLE_LABEL[r]).join("·")} 관점은 AI 답변이 근거 검증을 통과하지 못해 규칙기반 분석으로 보여 드려요.`);
      } catch (e) {
        ({ kind: fallbackKind, notice: fallbackNotice, reason: fallbackReason } = llmFallback(provider.label, e, "분석"));
        usedProvider = { id: "mock", label: "규칙기반 엔진(AI 답변 대체)", model: "law-rule-engine-v1", kind: "rule" };
      }
    }
  }
  if (fallbackNotice) notices.push(fallbackNotice);
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
    guard: { removedCitations: removed, unverifiedMentions: unverified, fallbackReason, fallbackKind, passed: unverified.length === 0 },
    dataSource: citations.some((c) => c.source === "live") ? "live" : "mock",
    notices: Array.from(new Set(notices)),
    elapsedMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}
