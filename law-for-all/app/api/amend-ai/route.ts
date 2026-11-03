import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { parseLooseJson } from "@/lib/answer/guard";
import { AMEND_RETRY, AMEND_SYSTEM, buildAmendPrompt, guardAmend, type AmendResult } from "@/lib/amend-ai";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Item = z.object({ label: z.string().max(120), text: z.string().max(4000) });
const Body = z.object({
  lawName: z.string().max(100).default(""),
  kind: z.string().max(20).default("행정규칙"),
  label: z.string().max(120).default(""),
  current: z.string().min(1).max(4000),
  original: z.string().max(4000).optional(),
  instruction: z.string().min(1).max(1000),
  upper: z.array(Item).max(6).default([]),
  provider: z.string().max(20).optional(),
});

/** 개정안 AI 작성: 규칙으로 알아듣지 못한 개정 방향만 생성형 AI가 개정 조문을 쓰고 가드가 검증(lib/amend-ai.ts) — 걸리면 이유를 알려 한 번 다시 씀 */
export async function POST(req: Request) {
  const rl = rateLimit(`amend-ai:${clientKey(req)}`, 10);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const input = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, input.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 개정안을 쓸 수 없어요. ‘A에서 B로’처럼 적거나 개정안을 직접 고쳐 주세요." }, { status: 503 });
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildAmendPrompt(input) }];
  try {
    let result: AmendResult = { ok: false, reason: "응답 없음" };
    let model = provider.model;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await provider.generate({ system: AMEND_SYSTEM, messages, json: true, temperature: 0.1, maxTokens: 2000 });
      model = res.model || model;
      let raw: unknown = null;
      try {
        raw = parseLooseJson(res.text);
      } catch {
        /* 형식이 깨진 응답 → 가드에서 '비어 있음'으로 처리 */
      }
      result = guardAmend(raw, input);
      if (result.ok) return NextResponse.json({ ...result, retried: attempt > 0, model, label: provider.label });
      messages.push({ role: "assistant", content: res.text }, { role: "user", content: AMEND_RETRY(result.reason) });
    }
    return NextResponse.json({ ...result, retried: true, model, label: provider.label });
  } catch (e) {
    return NextResponse.json({ error: `AI(${provider.label})에 연결하지 못했어요. 개정안을 직접 고치거나 잠시 후 다시 시도하세요.`, detail: (e as Error).message }, { status: 502 });
  }
}
