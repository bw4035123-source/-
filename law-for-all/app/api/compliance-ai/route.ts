import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError, type ProviderId } from "@/lib/llm/types";
import { LawService } from "@/lib/law-api/client";
import { articleLabel } from "@/lib/law-api/util";
import type { Citation } from "@/lib/law-api/types";
import { parseLooseJson } from "@/lib/answer/guard";
import { gatherEvidence } from "@/lib/answer/ask";
import { maskPII } from "@/lib/privacy-mask";
import { COMPLIANCE_SYSTEM, GENERIC_ARTICLE, buildCompliancePrompt, guardCompliance, type AiArticleInput } from "@/lib/compliance-ai";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  regName: z.string().max(100).default(""),
  orgType: z.string().max(30).default(""),
  articles: z
    .array(z.object({ no: z.string().max(12), title: z.string().max(80).default(""), text: z.string().min(1).max(3000), hints: z.array(z.string().regex(/^[\w.-]{1,40}:[0-9]{1,4}(?:의[0-9]{1,3})?$/)).max(6).default([]) }))
    .min(1)
    .max(40),
  provider: z.string().max(20).optional(),
});

/** AI 대조는 8묶음까지 동시 · 근거 찾기는 8개씩 동시 */
const LLM_POOL = 8;
const POOL = 8;
// 같은 조문(글·제목·힌트)은 결과를 재사용 — 같은 규정을 다시 점검하거나 시연할 때 바로(서버 메모리, 6시간)
const CACHE = new Map<string, { at: number; value: unknown }>();
const TTL = 6 * 3600 * 1000;
const cacheKey = (a: { no: string; title: string; text: string; hints: string[] }, orgType: string) => JSON.stringify([orgType, a.no, a.title, a.text, a.hints]);

/** 자체규정 AI 검토: 조문마다 국가법령정보(실시간)에서 상위 조문을 찾아 붙이고 AI가 대조 → 가드 검증(lib/compliance-ai.ts) */
export async function POST(req: Request) {
  const started = Date.now();
  const rl = rateLimit(`compliance-ai:${clientKey(req)}`, 5);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const { regName, orgType, articles } = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, parsed.data.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 AI 검토를 할 수 없어요. 기준 규칙 점검 결과를 참고하세요." }, { status: 503 });

  const svc = new LawService(serverConfig.lawAccess);
  const keys = articles.map((a) => cacheKey(a, orgType));
  const now = Date.now();
  const cached = keys.map((k) => {
    const c = CACHE.get(k);
    return c && now - c.at < TTL ? c.value : null;
  });
  const todo = articles.map((_, i) => i).filter((i) => !cached[i]);
  if (!todo.length) return NextResponse.json({ articles: cached, label: provider.label, model: provider.model, elapsedMs: Date.now() - started, cached: articles.length, warnings: [] });
  // 1) 조문마다 근거 상위 조문 찾기(질문 답변과 같은 방식: 내장 토픽·생활 용어 사전·국가법령정보 실시간 전체 법령 검색)
  const masked = todo.map((i) => ({ ...articles[i], text: maskPII(articles[i].text).text }));
  const uppers: Citation[][] = new Array(masked.length);
  for (let i = 0; i < masked.length; i += POOL)
    await Promise.all(
      masked.slice(i, i + POOL).map(async (a, j) => {
        const q = `${a.title} ${a.text}`.replace(/\s+/g, " ").slice(0, 300);
        // 기준 규칙이 연결한 상위 조문을 앞에, 국가법령정보 검색으로 찾은 조문을 뒤에
        const hinted = a.hints.length ? await svc.getCitations(a.hints).catch(() => [] as Citation[]) : [];
        // 기준 규칙이 상위 조문을 2개 이상 이미 연결했으면 느린 전체 법령 검색은 건너뜀(시간 단축)
        const found = GENERIC_ARTICLE.test(a.title.trim()) || hinted.length >= 2 ? [] : (await gatherEvidence(q, svc).catch(() => ({ context: [] as Citation[] }))).context;
        uppers[i + j] = [...hinted, ...found.filter((c) => !hinted.some((h) => h.key === c.key))].slice(0, 5);
      }),
    );
  const input: AiArticleInput[] = masked.map((a, i) => ({
    no: a.no,
    label: a.no === "전문" ? "(조문 구분 없음)" : `제${a.no.replace("의", "조의")}${a.no.includes("의") ? "" : "조"}${a.title ? `(${a.title})` : ""}`,
    text: a.text.slice(0, 1500),
    upper: uppers[i].map((c) => ({ key: c.key, label: `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`, text: c.text })),
  }));
  const retrievalMs = Date.now() - started;

  // 2) AI 대조(조문 묶음별 병렬) → 가드
  let model = provider.model;
  const chunks: AiArticleInput[][] = [];
  // 조문이 적으면 1개씩(답이 짧아 가장 빠름), 많으면 2개씩
  const CHUNK = input.length <= 12 ? 1 : 2;
  for (let i = 0; i < input.length; i += CHUNK) chunks.push(input.slice(i, i + CHUNK));
  const failed = new Set<number>();
  const review = async (ch: AiArticleInput[], ci: number) => {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildCompliancePrompt(regName, orgType, ch) }];
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await provider.generate({ system: COMPLIANCE_SYSTEM, messages, json: true, temperature: 0.1, maxTokens: 2000, timeoutMs: 60000 });
      } catch (e) {
        if (!(e instanceof LLMError)) throw e;
        // 일시 오류(요청 몰림 등)는 잠깐 쉬고 한 번 더 — 그래도 안 되면 이 묶음만 판단 보류
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        failed.add(ci);
        return guardCompliance(null, ch).map((r) => ({ ...r, note: "AI 응답 지연으로 이 조문은 판단 보류" }));
      }
      model = res.model || model;
      try {
        return guardCompliance(parseLooseJson(res.text), ch);
      } catch {
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라." });
      }
    }
    return guardCompliance(null, ch);
  };
  try {
    const tLlm = Date.now();
    const results: Awaited<ReturnType<typeof review>>[] = new Array(chunks.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LLM_POOL, chunks.length) }, async () => {
        while (next < chunks.length) {
          const ci = next++;
          results[ci] = await review(chunks[ci], ci);
        }
      }),
    );
    const llmMs = Date.now() - tLlm;
    if (failed.size === chunks.length) throw new LLMError("모든 묶음 응답 실패", provider.id as ProviderId);
    const bad = new Set(Array.from(failed).flatMap((ci) => chunks[ci].map((a) => a.no)));
    const flat = results.flat().map((r, j) => ({ ...r, upper: uppers[j] }));
    // 응답 지연으로 판단 보류한 조문은 저장하지 않음(다음에 다시 검토)
    flat.forEach((r, j) => !bad.has(r.no) && CACHE.set(keys[todo[j]], { at: now, value: r }));
    if (CACHE.size > 2000) CACHE.delete(CACHE.keys().next().value as string);
    const out = articles.map((_, i) => cached[i] ?? flat[todo.indexOf(i)]);
    return NextResponse.json({
      articles: out,
      cached: articles.length - todo.length,
      label: provider.label,
      model,
      elapsedMs: Date.now() - started,
      timing: { retrievalMs, llmMs, chunks: chunks.length },
      warnings: Array.from(new Set(svc.warnings)).slice(0, 3),
    });
  } catch (e) {
    const conn = e instanceof LLMError;
    return NextResponse.json({ error: conn ? `AI(${provider.label})에 연결하지 못했어요. 기준 규칙 점검 결과를 참고하거나 잠시 후 다시 시도하세요.` : "AI 검토 중 오류가 났어요.", detail: (e as Error).message }, { status: 502 });
  }
}
