import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError } from "@/lib/llm/types";
import { parseLooseJson } from "@/lib/answer/guard";
import { WRITE_CHUNK, WRITE_SYSTEM, buildWritePrompt, guardWrite } from "@/lib/enact-write";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Item = z.object({ label: z.string().max(80), text: z.string().max(3000) });
const Body = z.object({
  name: z.string().max(100).default(""),
  kind: z.string().max(20).default("행정규칙"),
  org: z.string().max(60).optional(),
  purpose: z.string().max(500).default(""),
  articles: z.array(Item).min(1).max(30),
  basis: z.array(Item.extend({ label: z.string().max(120), text: z.string().max(4000) })).max(8).default([]),
  provider: z.string().max(20).optional(),
});

/** 제정안 AI 작성: 표준 초안의 조문 체계 위에 AI가 본문을 쓰고 가드가 검증(lib/enact-write.ts) */
export async function POST(req: Request) {
  const rl = rateLimit(`enact-write:${clientKey(req)}`, 10);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const input = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, input.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 AI 작성을 할 수 없어요. 표준 초안을 쓰세요." }, { status: 503 });
  // 조문을 몇 개씩 나눠 동시에 쓰게 함 — 한 번에 다 쓰면 응답이 길어져 시간 초과(502)가 남. 늦은 묶음만 표준 초안 유지
  const chunks: (typeof input.articles)[] = [];
  for (let i = 0; i < input.articles.length; i += WRITE_CHUNK) chunks.push(input.articles.slice(i, i + WRITE_CHUNK));
  let model = provider.model;
  const one = async (ch: typeof input.articles): Promise<unknown[] | null> => {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildWritePrompt({ ...input, articles: ch }) }];
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        const res = await provider.generate({ system: WRITE_SYSTEM, messages, json: true, temperature: 0.2, maxTokens: 2500, timeoutMs: 60000 });
        model = res.model || model;
        text = res.text;
      } catch (e) {
        if (!(e instanceof LLMError)) throw e;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      try {
        const raw = parseLooseJson(text) as { articles?: unknown };
        if (raw && Array.isArray(raw.articles)) return raw.articles;
      } catch {
        /* 형식이 깨지면 한 번 다시 */
      }
      messages.push({ role: "assistant", content: text }, { role: "user", content: "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라." });
    }
    return null;
  };
  try {
    const outs = await Promise.all(chunks.map(one));
    if (outs.every((o) => o === null)) return NextResponse.json({ error: `AI(${provider.label})가 응답하지 않았어요. 표준 초안을 쓰거나 잠시 후 다시 시도하세요.` }, { status: 502 });
    const result = guardWrite({ articles: outs.flatMap((o) => o ?? []) }, input);
    const missed = chunks.flatMap((ch, i) => (outs[i] === null ? ch.map((a) => a.label) : []));
    result.rejected = [...missed.map((label) => ({ label, reason: "AI 응답 지연 — 표준 초안 유지" })), ...result.rejected];
    return NextResponse.json({ ...result, model, label: provider.label });
  } catch (e) {
    return NextResponse.json({ error: "AI 작성 중 오류가 났어요.", detail: (e as Error).message }, { status: 502 });
  }
}
