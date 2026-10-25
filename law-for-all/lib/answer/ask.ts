import "server-only";
import { serverConfig } from "../config";
import { LawService } from "../law-api/client";
import { matchLawAliases, queryTerms } from "../law-api/search";
import { getMockLaw } from "../law-api/mock";
import { parseArticleKey } from "../law-api/util";

const getMockArticle = (key: string) => {
  const p = parseArticleKey(key);
  return p ? getMockLaw(p.lawId)?.articles.find((a) => a.no === p.articleNo) : undefined;
};
import type { Contact } from "../law-api/mock/topics";
import { resolveProvider } from "../llm/registry";
import { buildSystemPrompt, buildUserPrompt, schemaFor } from "./prompts";
import { findUnverifiedMentions, guardLLMOutput, parseLooseJson, sanitizeMarkers } from "./guard";
import { relatedLawsOf, retrieve } from "./retrieve";
import { buildRuleAnswer } from "./rule-engine";
import { maskNotice, maskPII } from "../privacy-mask";
import type { AskResult, UserMode } from "./types";

const DEFAULT_CONTACTS: Contact[] = [
  { name: "정부민원안내콜센터", phone: "110", desc: "소관 기관 안내" },
  { name: "대한법률구조공단", phone: "132", url: "https://www.klac.or.kr", desc: "무료 법률상담" },
];

export interface AskInput {
  query: string;
  mode: UserMode;
  provider?: string;
}

/**
 * 질의응답 파이프라인
 *   근거 검색(retrieve) → 원문 확보(LawService: 실시간/내장) → 공급자 선택(Adapter)
 *   → 생성(LLM) 또는 조립(규칙엔진) → 환각 가드 → 응답
 */
export async function ask({ query: rawQuery, mode, provider: requested }: AskInput): Promise<AskResult> {
  const started = Date.now();
  // 질문 속 개인정보(주민등록번호·전화번호 등)는 검색·AI로 넘기기 전에 가린다
  const { text: query, found: masked } = maskPII(rawQuery);
  const notices: string[] = masked.length ? [maskNotice(masked)] : [];
  const svc = new LawService(serverConfig.lawAccess);

  // 사람이 검수한 사전이 토픽보다 구체적인 법령을 가리키면(예: '사전통지'→행정절차법) 실시간 검색으로
  const precise = svc.mode === "live" && matchLawAliases(query).some((a) => a.override);
  const r = retrieve(query);
  const topic = precise ? undefined : r.topic;
  const localKeys = precise ? [] : r.keys;
  // 내장 토픽에 없는 질문은 국가법령정보 Open API로 전체 법령에서 근거 조문을 찾는다
  const liveKeys = !topic && svc.mode === "live" ? await svc.searchLiveKeys(query) : [];
  // 실시간 검색을 한 경우, 내장 데이터의 약한 검색 결과는 질문 단어 2개 이상이 조문 제목에 있는 것만 남긴다
  const terms = queryTerms(query);
  const local = !topic && svc.mode === "live" ? localKeys.filter((k) => terms.filter((t) => (getMockArticle(k)?.title ?? "").includes(t)).length >= 2) : localKeys;
  const keys = [...liveKeys, ...local.filter((k) => !liveKeys.includes(k))];
  const context = await svc.getCitations(keys);

  const { provider, notice } = resolveProvider(serverConfig.llm, requested);
  if (notice) notices.push(notice);

  let summary: string;
  let citizen: AskResult["citizen"];
  let officer: AskResult["officer"];
  let citationKeys = context.map((c) => c.key);
  let removed: string[] = [];
  let unverified: string[] = [];
  let fallbackReason: string | undefined;
  let usedProvider = { id: provider.id as string, label: provider.label, model: provider.model, kind: provider.kind };

  const applyRuleEngine = () => {
    const r = buildRuleAnswer(query, topic, context);
    const allowed = new Set(context.map((c) => c.key));
    const s = sanitizeMarkers(r.summary, allowed);
    summary = s.text;
    citizen = r.citizen;
    officer = r.officer;
    removed = s.removed;
    unverified = findUnverifiedMentions([summary, ...r.officer.keyPoints].join("\n"), context);
  };

  if (provider.kind === "rule") {
    applyRuleEngine();
  } else if (!context.length) {
    // 근거 없이 LLM을 호출하면 환각 위험 → 호출하지 않음
    fallbackReason = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다.";
    applyRuleEngine();
  } else {
    try {
      const res = await provider.generate({
        system: buildSystemPrompt(mode),
        messages: [{ role: "user", content: buildUserPrompt(query, context) }],
        json: true,
        schema: schemaFor(mode),
        temperature: 0.1,
        maxTokens: 1800,
      });
      usedProvider = { ...usedProvider, model: res.model || provider.model };
      const g = guardLLMOutput(parseLooseJson(res.text), mode, context);
      summary = g.summary;
      citizen = g.citizen;
      officer = g.officer;
      removed = g.removed;
      unverified = g.unverified;
      // 실제 인용한 조문을 앞에, 나머지 검색 근거는 뒤에
      citationKeys = [...g.citationKeys, ...context.map((c) => c.key).filter((k) => !g.citationKeys.includes(k))];
    } catch (e) {
      fallbackReason = `${provider.label} 응답을 검증하지 못해 규칙기반 엔진으로 대체했습니다(${(e as Error).message}).`;
      usedProvider = { id: "mock", label: "규칙기반 엔진(LLM 없음)", model: "law-rule-engine-v1", kind: "rule" };
      applyRuleEngine();
    }
  }
  if (fallbackReason) notices.push(fallbackReason);
  if (removed.length) notices.push(`근거 목록에 없는 인용 ${removed.length}건을 자동 제거했습니다.`);

  const citations = citationKeys.map((k) => context.find((c) => c.key === k)!).filter(Boolean);
  notices.push(...svc.warnings);

  return {
    query,
    mode,
    topic: topic ? { id: topic.id, label: topic.label } : undefined,
    provider: usedProvider,
    summary: summary!,
    citizen,
    officer,
    citations,
    contacts: topic?.contacts ?? DEFAULT_CONTACTS,
    // 판례 검색어: 토픽별로 사건명과 잘 맞는 검색어(실측으로 선정)
    caseQuery: topic?.caseQuery ?? (liveKeys.length ? terms[0] ?? null : null),
    relatedLaws: [
      ...relatedLawsOf(citations.map((c) => c.key)),
      ...Array.from(new Map(citations.filter((c) => liveKeys.includes(c.key)).map((c) => [c.lawId, { id: c.lawId, name: c.lawName }])).values()),
    ],
    guard: { removedCitations: removed, unverifiedMentions: unverified, fallbackReason, passed: unverified.length === 0 },
    dataSource: citations.some((c) => c.source === "live") ? "live" : "mock",
    notices: Array.from(new Set(notices)),
    elapsedMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}
