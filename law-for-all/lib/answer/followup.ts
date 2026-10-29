import "server-only";
import { serverConfig } from "../config";
import { LawService } from "../law-api/client";
import type { Citation } from "../law-api/types";
import { matchLawAliases, queryTerms, scoreArticleByTerms } from "../law-api/search";
import { articleLabel } from "../law-api/util";
import type { Contact } from "../law-api/mock/topics";
import { resolveProvider } from "../llm/registry";
import { buildSystemPrompt, buildUserPrompt, schemaFor } from "./prompts";
import { findUnverifiedMentions, guardLLMOutput, parseLooseJson, sanitizeMarkers } from "./guard";
import { FOLLOWUP_SUGGESTIONS } from "./followup-suggestions";
import { retrieve } from "./retrieve";
import { maskNotice, maskPII } from "../privacy-mask";
import type { UserMode } from "./types";

/**
 * 이어서 묻기 — 검색 결과를 본 뒤 같은 사안을 더 묻는 질문에 답한다.
 *   이전 질문의 사안(토픽·근거 조문)을 유지한 채 새 질문으로 근거를 다시 찾고,
 *   질문 유형(기한·신고·처벌·준비·예외)에 맞는 조문 문장을 원문에서 골라 답한다(LLM 연결 시 생성 + 같은 인용 검증).
 */
export interface FollowUpInput {
  question: string;
  prevQuery: string;
  mode: UserMode;
  provider?: string;
}

export interface FollowUpResult {
  question: string;
  prevQuery: string;
  mode: UserMode;
  topic?: { id: string; label: string };
  intent: string | null;
  provider: { id: string; label: string; model: string; kind: "llm" | "rule" };
  answer: string;
  citations: Citation[];
  guard: { removedCitations: string[]; unverifiedMentions: string[]; fallbackReason?: string; passed: boolean };
  suggestions: string[];
  dataSource: "live" | "mock";
  notices: string[];
  elapsedMs: number;
  generatedAt: string;
}

/** 질문 유형: ask 는 질문에서, find 는 조문 문장에서, title 은 조문 제목에서 찾는 표현(Python 판과 같은 정규식).
 *  제목이 맞는 조문(예: 벌칙·과태료)이 근거에 있으면 그 조문을 우선한다. */
export const FOLLOWUP_INTENTS: { id: string; ask: RegExp; find: RegExp; title?: RegExp; max: number }[] = [
  { id: "deadline", ask: /기한|언제까지|며칠|기간|시효|마감|언제/, find: /\d+\s*(?:일|개월|년|시간)\s*(?:이내|안에|전|이상|이하|이 지난)|기간|기한/, title: /기간|기한|청산|시효/, max: 2 },
  { id: "where", ask: /어디|신고|진정|상담|문의|도움|기관|연락|불복|이의/, find: /신고|진정|청구|신청|구제|고발|고소/, title: /신고|진정|구제|신청|청구|조정/, max: 2 },
  { id: "penalty", ask: /처벌|벌금|과태료|징역|제재|불이익|징계|처분/, find: /징역|벌금|과태료|처한다|부과|징계/, title: /벌칙|과태료|벌금|징계|처분|취소/, max: 2 },
  { id: "prepare", ask: /증거|자료|준비|서류|입증|방법|절차/, find: /서류|증명|신청|제출|절차/, title: /신청|절차|서류|제출|조정/, max: 1 },
  { id: "exception", ask: /예외|제외|안 되는|않는 경우|다만/, find: /다만|제외|예외|아니하다|아니한다/, max: 2 },
];

const DEFAULT_CONTACTS: Contact[] = [
  { name: "정부민원안내콜센터", phone: "110", desc: "소관 기관 안내" },
  { name: "대한법률구조공단", phone: "132", url: "https://www.klac.or.kr", desc: "무료 법률상담" },
];

export function detectIntent(question: string): string | null {
  return FOLLOWUP_INTENTS.find((it) => it.ask.test(question))?.id ?? null;
}

function sentences(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.replace(/^[①-⑳]\s*/, "").split(/(?<=다\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const balanced = (s: string) => s.split("(").length === s.split(")").length;

/** 조문에서 질문 유형에 맞는 문장 — 사안(이전 질문)의 말이 든 문장, 괄호가 짝이 맞는 문장을 우선(없으면 첫 문장) */
function pickSentence(text: string, find: RegExp | undefined, max = 140, prefer: string[] = []): string {
  const ss = sentences(text);
  const has = (x: string) => prefer.some((t) => x.includes(t));
  const hits = (find ? ss.filter((x) => find.test(x)) : []).sort((a, b) => Number(has(b)) - Number(has(a)));
  const s = hits.find(balanced) || hits[0] || ss[0] || "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 이어서 묻기 규칙기반 답변 — 토픽 사전·조문 원문 문장만 사용 */
export function buildFollowUpRuleAnswer(question: string, mode: UserMode, intentId: string | null, topic: ReturnType<typeof retrieve>["topic"], context: Citation[], caseKeys: string[] = [], prevQuery = ""): string {
  const intent = FOLLOWUP_INTENTS.find((it) => it.id === intentId);
  const terms = queryTerms(question);
  // 사안의 핵심어: 이전 질문의 말 중 토픽 요약에도 나오는 말(예: '보증금') — 이 말이 든 조문 문장을 우선
  const caseTerms = topic ? queryTerms(prevQuery).filter((t) => topic.citizen.summary.includes(t)) : [];
  const rank = (list: Citation[]) => {
    const titled = intent?.title ? list.filter((c) => intent.title!.test(c.title)) : [];
    return (titled.length ? titled : list)
      .map((c, i) => ({ c, i, score: scoreArticleByTerms(c, terms) + (intent && intent.find.test(c.text) ? 4 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, intent ? intent.max : 2);
  };
  // 이전 질문(사안)의 근거에서 먼저 찾고, 없을 때만 새 질문으로 더 찾은 근거까지 본다
  const own = rank(context.filter((c) => caseKeys.includes(c.key)));
  const ranked = own.length ? own : rank(context);
  const keys = new Set(context.map((c) => c.key));
  const lines: string[] = [];
  if (intentId === "where") {
    const contacts = topic?.contacts ?? DEFAULT_CONTACTS;
    lines.push(`도움받을 수 있는 곳: ${contacts.slice(0, 3).map((c) => (c.phone ? `${c.name}(☎${c.phone})` : c.name)).join(" · ")}`);
  }
  if (intentId === "prepare" && topic) {
    const ref = topic.citizen.steps.find((s) => s.ref && keys.has(s.ref))?.ref;
    lines.push(`해야 할 일: ${topic.citizen.steps.map((s) => s.title).join(" → ")}${ref ? ` [[${ref}]]` : ""}`);
  }
  for (const { c } of ranked) lines.push(`「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title}): ${pickSentence(c.text, intent?.find, 140, caseTerms)} [[${c.key}]]`);
  if (!ranked.length && !lines.length) {
    return "이어서 물으신 내용과 직접 맞는 조문을 근거 목록에서 찾지 못했어요. 상황을 조금 더 구체적으로 적어 주시거나, 정부민원안내콜센터(☎110)·대한법률구조공단(☎132)에 문의해 보세요.";
  }
  const lead = ranked.length
    ? mode === "officer" ? `추가 검토 「${question}」 관련 근거는 다음과 같음.` : `‘${question}’에 대해 근거 조문에서 확인한 내용이에요.`
    : mode === "officer" ? `추가 검토 「${question}」 관련 안내.` : `‘${question}’에 대한 안내예요.`;
  return [lead, ...lines.map((l) => `· ${l}`)].join("\n");
}

export async function followUp({ question: rawQ, prevQuery: rawPrev, mode, provider: requested }: FollowUpInput): Promise<FollowUpResult> {
  const started = Date.now();
  // 질문 속 개인정보는 검색·AI로 넘기기 전에 가린다
  const q1 = maskPII(rawQ);
  const q0 = maskPII(rawPrev);
  const question = q1.text;
  const prevQuery = q0.text;
  const masked = [...q1.found, ...q0.found.filter((k) => !q1.found.includes(k))];
  const notices: string[] = masked.length ? [maskNotice(masked)] : [];
  const svc = new LawService(serverConfig.lawAccess);

  // 이전 질문의 사안을 유지: 토픽·근거는 이전 질문에서, 새 질문으로 근거를 더 찾는다
  // 이전 질문이 사전의 구체적 법령을 가리켰으면(ask 와 같은 규칙) 토픽 대신 실시간 근거를 유지
  const precise = svc.mode === "live" && matchLawAliases(prevQuery).some((a) => a.override);
  const none: ReturnType<typeof retrieve> = { keys: [] };
  const prev = precise ? none : retrieve(prevQuery);
  const topic = prev.topic;
  const cur = precise ? none : retrieve(`${question} ${topic ? topic.label : prevQuery}`);
  const local = [...prev.keys, ...cur.keys.filter((k) => !prev.keys.includes(k))];
  const liveKeys = !topic && svc.mode === "live" ? await svc.searchLiveKeys(`${prevQuery} ${question}`) : [];
  const context = await svc.getCitations([...liveKeys, ...local.filter((k) => !liveKeys.includes(k))]);
  const intent = detectIntent(question);

  const { provider, notice } = resolveProvider(serverConfig.llm, requested);
  if (notice) notices.push(notice);
  let usedProvider = { id: provider.id as string, label: provider.label, model: provider.model, kind: provider.kind };
  let answer = "";
  let removed: string[] = [];
  let fallbackReason: string | undefined;

  const applyRule = () => {
    const s = sanitizeMarkers(buildFollowUpRuleAnswer(question, mode, intent, topic, context, [...liveKeys, ...prev.keys], prevQuery), new Set(context.map((c) => c.key)));
    answer = s.text;
    removed = s.removed;
  };

  if (provider.kind === "rule") applyRule();
  else if (!context.length) {
    fallbackReason = "근거 조문이 검색되지 않아 생성형 AI를 호출하지 않았습니다.";
    applyRule();
  } else {
    try {
      const res = await provider.generate({
        system: buildSystemPrompt(mode),
        messages: [{ role: "user", content: buildUserPrompt(`이전 질문: ${prevQuery}\n이어서 묻는 질문: ${question}`, context) }],
        json: true,
        schema: schemaFor(mode),
        temperature: 0.1,
        maxTokens: 1200,
      });
      usedProvider = { ...usedProvider, model: res.model || provider.model };
      const g = guardLLMOutput(parseLooseJson(res.text), mode, context, [prevQuery, question]);
      answer = g.summary;
      removed = g.removed;
    } catch (e) {
      fallbackReason = `${provider.label} 응답을 검증하지 못해 규칙기반 엔진으로 대체했습니다(${(e as Error).message}).`;
      usedProvider = { id: "mock", label: "규칙기반 엔진(LLM 없음)", model: "law-rule-engine-v1", kind: "rule" };
      applyRule();
    }
  }
  if (fallbackReason) notices.push(fallbackReason);
  if (removed.length) notices.push(`근거 목록에 없는 인용 ${removed.length}건을 자동 제거했습니다.`);
  notices.push(...svc.warnings);

  const used = Array.from(answer.matchAll(/\[\[([^\]\s]+)\]\]/g), (m) => m[1]).filter((k, i, a) => a.indexOf(k) === i);
  const citations = used.map((k) => context.find((c) => c.key === k)).filter((c): c is Citation => !!c);
  const unverified = findUnverifiedMentions(answer, context);
  return {
    question,
    prevQuery,
    mode,
    topic: topic ? { id: topic.id, label: topic.label } : undefined,
    intent,
    provider: usedProvider,
    answer,
    citations,
    guard: { removedCitations: removed, unverifiedMentions: unverified, fallbackReason, passed: unverified.length === 0 },
    suggestions: FOLLOWUP_SUGGESTIONS[mode].filter((s) => detectIntent(s) !== intent).slice(0, 3),
    dataSource: citations.some((c) => c.source === "live") ? "live" : "mock",
    notices: Array.from(new Set(notices)),
    elapsedMs: Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}
