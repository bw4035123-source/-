import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError } from "@/lib/llm/types";
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

const CHUNK = 5;
const POOL = 6;

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
  // 1) 조문마다 근거 상위 조문 찾기(질문 답변과 같은 방식: 내장 토픽·생활 용어 사전·국가법령정보 실시간 전체 법령 검색)
  const masked = articles.map((a) => ({ ...a, text: maskPII(a.text).text }));
  const uppers: Citation[][] = new Array(masked.length);
  for (let i = 0; i < masked.length; i += POOL)
    await Promise.all(
      masked.slice(i, i + POOL).map(async (a, j) => {
        const q = `${a.title} ${a.text}`.replace(/\s+/g, " ").slice(0, 300);
        // 기준 규칙이 연결한 상위 조문을 앞에, 국가법령정보 검색으로 찾은 조문을 뒤에
        const hinted = a.hints.length ? await svc.getCitations(a.hints).catch(() => [] as Citation[]) : [];
        const found = GENERIC_ARTICLE.test(a.title.trim()) ? [] : (await gatherEvidence(q, svc).catch(() => ({ context: [] as Citation[] }))).context;
        uppers[i + j] = [...hinted, ...found.filter((c) => !hinted.some((h) => h.key === c.key))].slice(0, 5);
      }),
    );
  const input: AiArticleInput[] = masked.map((a, i) => ({
    no: a.no,
    label: a.no === "전문" ? "(조문 구분 없음)" : `제${a.no.replace("의", "조의")}${a.no.includes("의") ? "" : "조"}${a.title ? `(${a.title})` : ""}`,
    text: a.text.slice(0, 1500),
    upper: uppers[i].map((c) => ({ key: c.key, label: `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`, text: c.text })),
  }));

  // 2) AI 대조(조문 묶음별 병렬) → 가드
  let model = provider.model;
  const chunks: AiArticleInput[][] = [];
  for (let i = 0; i < input.length; i += CHUNK) chunks.push(input.slice(i, i + CHUNK));
  try {
    const results = await Promise.all(
      chunks.map(async (ch) => {
        const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildCompliancePrompt(regName, orgType, ch) }];
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await provider.generate({ system: COMPLIANCE_SYSTEM, messages, json: true, temperature: 0.1, maxTokens: 3000, timeoutMs: 70000 });
          model = res.model || model;
          try {
            return guardCompliance(parseLooseJson(res.text), ch);
          } catch {
            messages.push({ role: "assistant", content: res.text }, { role: "user", content: "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라." });
          }
        }
        return guardCompliance(null, ch);
      }),
    );
    const flat = results.flat();
    return NextResponse.json({
      articles: flat.map((r, i) => ({ ...r, upper: uppers[i] })),
      label: provider.label,
      model,
      elapsedMs: Date.now() - started,
      warnings: Array.from(new Set(svc.warnings)).slice(0, 3),
    });
  } catch (e) {
    const conn = e instanceof LLMError;
    return NextResponse.json({ error: conn ? `AI(${provider.label})에 연결하지 못했어요. 기준 규칙 점검 결과를 참고하거나 잠시 후 다시 시도하세요.` : "AI 검토 중 오류가 났어요.", detail: (e as Error).message }, { status: 502 });
  }
}
