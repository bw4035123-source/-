import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError } from "@/lib/llm/types";
import { parseLooseJson } from "@/lib/answer/guard";
import { AMEND_RETRY, AMEND_SYSTEM, buildAmendPrompt, guardAmend, type AmendResult } from "@/lib/amend-ai";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Up = z.object({ label: z.string().max(120), text: z.string().max(4000) });
const Item = z.object({
  id: z.string().max(20),
  label: z.string().max(120).default(""),
  current: z.string().min(1).max(4000),
  original: z.string().max(4000).optional(),
  instruction: z.string().min(1).max(1500),
  upper: z.array(Up).max(6).default([]),
});
const Body = z.object({ lawName: z.string().max(100).default(""), kind: z.string().max(20).default("행정규칙"), items: z.array(Item).min(1).max(15), provider: z.string().max(20).optional() });
const POOL = 6;

/**
 * 자체규정 점검 → 상충·검토 필요 조문 한 번에 개정: 조문마다 개정안 AI(app/api/amend-ai 와 같은 프롬프트·가드)를 동시에 돌림.
 * 가드에 걸리면 이유를 알려 한 번 다시 쓰고, 그래도 걸리면 그 조문은 현행 유지(이유 표시). 한 조문의 연결 실패가 전체를 막지 않음
 */
export async function POST(req: Request) {
  const rl = rateLimit(`amend-batch:${clientKey(req)}`, 4);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const { lawName, kind, items, provider: prov } = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, prov);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 개정안을 쓸 수 없어요. 조문별 ‘고칠 방향’을 보고 직접 고쳐 주세요." }, { status: 503 });
  const started = Date.now();
  let model = provider.model;
  const one = async (it: (typeof items)[number]) => {
    const input = { lawName, kind, label: it.label, current: it.current, original: it.original, instruction: it.instruction, upper: it.upper };
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildAmendPrompt(input) }];
    let result: AmendResult = { ok: false, reason: "응답 없음" };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await provider.generate({ system: AMEND_SYSTEM, messages, json: true, temperature: 0.1, maxTokens: 2000, timeoutMs: 60000 });
      } catch (e) {
        if (e instanceof LLMError && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { id: it.id, ok: false, reason: "AI 응답 지연 — 다시 시도하거나 직접 고쳐 주세요" };
      }
      model = res.model || model;
      let raw: unknown = null;
      try {
        raw = parseLooseJson(res.text);
      } catch {
        /* 형식이 깨진 응답 → 가드에서 '비어 있음' */
      }
      result = guardAmend(raw, input);
      if (result.ok) return { id: it.id, ...result, retried: attempt > 0 };
      messages.push({ role: "assistant", content: res.text }, { role: "user", content: AMEND_RETRY(result.reason) });
    }
    return { id: it.id, ...result, retried: true };
  };
  const results: Awaited<ReturnType<typeof one>>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await one(items[i]);
      }
    }),
  );
  return NextResponse.json({ results, model, label: provider.label, elapsedMs: Date.now() - started });
}
