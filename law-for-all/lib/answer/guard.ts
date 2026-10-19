import { z } from "zod";
import type { Citation } from "../law-api/types";
import type { CitizenAnswer, OfficerAnswer } from "./types";

/**
 * 환각(Hallucination) 방지 가드
 *  1) 인용 키 화이트리스트: 근거 목록에 없는 [[키]]는 제거
 *  2) 조문 언급 검증: 본문에 쓰인 "「법령」 제N조" 표현이 근거 조문에서 확인되는지 대조
 *  3) 원문 분리: 인용 카드에는 LLM 문장이 아닌 DB/Open API 원문만 표시(답변 조립 단계에서 보장)
 */

const MARKER = /\[\[([^\]\s]+)\]\]/g;

export function extractMarkers(text: string): string[] {
  return Array.from(text.matchAll(MARKER), (m) => m[1]);
}

export function sanitizeMarkers(text: string, allowed: Set<string>): { text: string; removed: string[]; used: string[] } {
  const removed: string[] = [];
  const used: string[] = [];
  const out = text.replace(MARKER, (_, key: string) => {
    if (allowed.has(key)) {
      if (!used.includes(key)) used.push(key);
      return `[[${key}]]`;
    }
    removed.push(key);
    return "";
  });
  return { text: out.replace(/\s+([.,])/g, "$1").replace(/ {2,}/g, " ").trim(), removed, used };
}

const norm = (s: string) => s.replace(/\s|ㆍ|·/g, "");

/** 본문에서 근거로 확인되지 않는 조문 언급을 찾는다 */
export function findUnverifiedMentions(text: string, citations: Citation[]): string[] {
  const plain = text.replace(MARKER, "");
  const corpus = citations.map((c) => norm(c.text)).join("|");
  const bad = new Set<string>();

  const named = /「([^」]{2,60})」\s*(?:시행령\s*|시행규칙\s*)?제(\d+)조(?:의(\d+))?/g;
  const namedSpans: [number, number][] = [];
  for (const m of Array.from(plain.matchAll(named))) {
    namedSpans.push([m.index!, m.index! + m[0].length]);
    const no = m[3] ? `${m[2]}의${m[3]}` : m[2];
    const name = norm(m[1]);
    const ok =
      citations.some((c) => norm(c.lawName) === name && c.articleNo === no) ||
      citations.some((c) => norm(c.lawName).startsWith(name) && c.articleNo === no) ||
      corpus.includes(norm(m[0]));
    if (!ok) bad.add(m[0].trim());
  }

  const bare = /(?:같은\s*법\s*)?제(\d+)조(?:의(\d+))?/g;
  for (const m of Array.from(plain.matchAll(bare))) {
    if (namedSpans.some(([s, e]) => m.index! >= s && m.index! < e)) continue;
    const no = m[2] ? `${m[1]}의${m[2]}` : m[1];
    const ok = citations.some((c) => c.articleNo === no) || corpus.includes(norm(m[0]));
    if (!ok) bad.add(m[0].trim());
  }
  return Array.from(bad);
}

/** LLM 출력에서 JSON 객체만 추출(코드블록·앞뒤 설명 제거) */
export function parseLooseJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("JSON 객체를 찾지 못했습니다");
  return JSON.parse(t.slice(s, e + 1));
}

// ───────────── 소형 모델 출력 보정(형식만 고치고 내용·근거는 그대로 검증)
const SUMMARY_ALIASES = ["answer", "response", "result", "답변", "요약"];

/** {"answer": {...}} 처럼 한 겹 감싼 출력은 벗기고, summary 가 없으면 answer 등 같은 뜻의 키를 쓴다 */
export function unwrapLlmJson(raw: unknown, keys: string[]): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const known = keys.includes("summary") ? [...keys, ...SUMMARY_ALIASES] : keys;
  const has = (v: Record<string, unknown>) => known.some((k) => k in v && (typeof v[k] !== "object" || !SUMMARY_ALIASES.includes(k)));
  for (let i = 0; i < 2; i++) {
    if (!isObj(raw) || has(raw)) break;
    const inner = Object.values(raw).filter((v): v is Record<string, unknown> => isObj(v) && known.some((k) => k in v));
    if (inner.length !== 1) break;
    raw = inner[0];
  }
  if (isObj(raw) && keys.includes("summary") && !raw.summary) {
    const obj = raw;
    const alias = SUMMARY_ALIASES.map((k) => obj[k]).find((v): v is string => typeof v === "string" && !!v.trim());
    if (alias) raw = { ...raw, summary: alias };
  }
  return raw;
}

/** [[키]] 표시를 빠뜨린 경우: 본문이 근거 목록의 조문을 이름·번호로 정확히 언급했을 때만 그 조문을 인용으로 인정 */
export function inferCitationKeys(texts: string[], context: Citation[]): string[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plain = norm(texts.join("\n").replace(MARKER, ""));
  const out: string[] = [];
  for (const c of context) {
    if (new RegExp(`${esc(norm(c.lawName))}」?제${esc(c.articleNo.replace(/^(\d+)의(\d+)$/, "$1조의$2").replace(/^(\d+)$/, "$1조"))}(?![의\\d])`).test(plain) && !out.includes(c.key)) out.push(c.key);
  }
  return out;
}

const str = z.preprocess((v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)), z.string());
const strList = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(str));

export const CitizenSchema = z.object({
  summary: str,
  easyTerms: z.array(z.object({ term: str, meaning: str })).catch([]),
  steps: z.array(z.object({ title: str, detail: str, ref: str.optional() })).catch([]),
  tip: str.optional(),
  citations: strList.catch([]),
});

export const OfficerSchema = z.object({
  summary: str,
  background: str.catch(""),
  keyPoints: strList.catch([]),
  adminNotes: strList.catch([]),
  checklist: strList.catch([]),
  citations: strList.catch([]),
});

export interface GuardedOutput {
  summary: string;
  citizen?: CitizenAnswer;
  officer?: OfficerAnswer;
  citationKeys: string[];
  removed: string[];
  unverified: string[];
}

/** LLM JSON → 검증·정제된 답변. 근거 인용이 하나도 없으면 예외(상위에서 규칙엔진으로 대체) */
export function guardLLMOutput(raw: unknown, mode: "citizen" | "officer", context: Citation[]): GuardedOutput {
  raw = unwrapLlmJson(raw, ["summary", "steps", "keyPoints", "background"]);
  const allowed = new Set(context.map((c) => c.key));
  const removed: string[] = [];
  const used: string[] = [];
  const clean = (s: string) => {
    const r = sanitizeMarkers(s, allowed);
    removed.push(...r.removed);
    r.used.forEach((u) => !used.includes(u) && used.push(u));
    return r.text;
  };
  const allText: string[] = [];
  let summary: string;
  let citizen: CitizenAnswer | undefined;
  let officer: OfficerAnswer | undefined;
  let declared: string[];

  if (mode === "citizen") {
    const p = CitizenSchema.parse(raw);
    summary = clean(p.summary);
    citizen = {
      easyTerms: p.easyTerms.filter((t) => t.term && t.meaning).slice(0, 5),
      steps: p.steps
        .filter((s) => s.title)
        .slice(0, 3)
        .map((s) => ({ title: clean(s.title), detail: clean(s.detail), ref: s.ref && allowed.has(s.ref) ? s.ref : undefined })),
      tip: p.tip ? clean(p.tip) : undefined,
    };
    allText.push(summary, ...citizen.steps.flatMap((s) => [s.title, s.detail]), citizen.tip ?? "");
    declared = p.citations;
  } else {
    const p = OfficerSchema.parse(raw);
    summary = clean(p.summary);
    officer = {
      background: clean(p.background),
      keyPoints: p.keyPoints.map(clean).filter(Boolean).slice(0, 6),
      adminNotes: p.adminNotes.map(clean).filter(Boolean).slice(0, 4),
      checklist: p.checklist.map(clean).filter(Boolean).slice(0, 6),
    };
    allText.push(summary, officer.background, ...officer.keyPoints, ...officer.adminNotes, ...officer.checklist);
    declared = p.citations;
  }

  for (const k of declared) {
    if (allowed.has(k)) !used.includes(k) && used.push(k);
    else if (!removed.includes(k)) removed.push(k);
  }
  if (!used.length) used.push(...inferCitationKeys(allText, context));
  if (!summary) throw new Error("요약이 비어 있습니다");
  if (!used.length) throw new Error("근거 조문 인용이 없습니다");

  return { summary, citizen, officer, citationKeys: used, removed: Array.from(new Set(removed)), unverified: findUnverifiedMentions(allText.join("\n"), context) };
}

// ───────────── 상황 분석(3관점) 출력 검증
const reqStatus = z.preprocess((v) => (v === "met" || v === "unmet" ? v : "unclear"), z.enum(["met", "unclear", "unmet"]));

export const AnalysisSchema = z.object({
  lawyer: z.object({ stance: str, arguments: strList.catch([]), evidence: strList.catch([]), strategy: strList.catch([]) }),
  prosecutor: z.object({ stance: str, violations: strList.catch([]), sanctions: strList.catch([]), proofPoints: strList.catch([]) }),
  judge: z.object({
    stance: str,
    issues: strList.catch([]),
    requirements: z.array(z.object({ label: str, ref: str.optional(), status: reqStatus, basis: str.catch("") })).catch([]),
    outlook: str.catch(""),
  }),
  citations: strList.catch([]),
});

export function guardAnalysisOutput(raw: unknown, context: Citation[]) {
  raw = unwrapLlmJson(raw, ["lawyer", "prosecutor", "judge"]);
  const allowed = new Set(context.map((c) => c.key));
  const removed: string[] = [];
  const used: string[] = [];
  const texts: string[] = [];
  const clean = (s: string) => {
    const r = sanitizeMarkers(s, allowed);
    removed.push(...r.removed);
    r.used.forEach((u) => !used.includes(u) && used.push(u));
    if (r.text) texts.push(r.text);
    return r.text;
  };
  const list = (a: string[], max = 6) => a.map(clean).filter(Boolean).slice(0, max);
  const p = AnalysisSchema.parse(raw);
  const perspectives = {
    lawyer: { stance: clean(p.lawyer.stance), arguments: list(p.lawyer.arguments), evidence: list(p.lawyer.evidence), strategy: list(p.lawyer.strategy) },
    prosecutor: { stance: clean(p.prosecutor.stance), violations: list(p.prosecutor.violations), sanctions: list(p.prosecutor.sanctions), proofPoints: list(p.prosecutor.proofPoints) },
    judge: {
      stance: clean(p.judge.stance),
      issues: list(p.judge.issues),
      requirements: p.judge.requirements.slice(0, 8).map((r) => {
        const ref = r.ref && allowed.has(r.ref) ? r.ref : undefined;
        if (ref && !used.includes(ref)) used.push(ref);
        if (r.ref && !ref) removed.push(r.ref);
        return { label: clean(r.label), ref, status: r.status, basis: clean(r.basis) };
      }),
      outlook: clean(p.judge.outlook),
    },
  };
  for (const k of p.citations) {
    if (allowed.has(k)) !used.includes(k) && used.push(k);
    else if (!removed.includes(k)) removed.push(k);
  }
  if (!used.length) used.push(...inferCitationKeys(texts, context));
  if (!perspectives.lawyer.stance || !perspectives.judge.stance) throw new Error("관점 분석이 비어 있습니다");
  if (!used.length) throw new Error("근거 조문 인용이 없습니다");
  return { perspectives, citationKeys: used, removed: Array.from(new Set(removed)), unverified: findUnverifiedMentions(texts.join("\n"), context) };
}
