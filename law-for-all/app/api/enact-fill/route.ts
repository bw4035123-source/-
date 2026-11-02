import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { parseLooseJson } from "@/lib/answer/guard";
import { FILL_SYSTEM, buildFillPrompt, guardFill } from "@/lib/enact-fill";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Item = z.object({ label: z.string().max(80), text: z.string().max(3000) });
const Body = z.object({
  name: z.string().max(100).default(""),
  kind: z.string().max(20).default("행정규칙"),
  org: z.string().max(60).optional(),
  purpose: z.string().max(500).default(""),
  articles: z.array(Item).min(1).max(40),
  basis: z.array(Item).max(10).default([]),
  provider: z.string().max(20).optional(),
});

/** 제정안 AI 채우기: 표준 문형 초안의 ○○ 자리만 생성형 AI가 채우고 가드가 검증(lib/enact-fill.ts) */
export async function POST(req: Request) {
  const rl = rateLimit(`enact-fill:${clientKey(req)}`, 10);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const input = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, input.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 빈칸을 채울 수 없어요. 표준 문형 초안을 그대로 쓰세요." }, { status: 503 });
  try {
    const res = await provider.generate({ system: FILL_SYSTEM, messages: [{ role: "user", content: buildFillPrompt(input) }], json: true, temperature: 0.1, maxTokens: 3000 });
    let raw: unknown;
    try {
      raw = parseLooseJson(res.text);
    } catch {
      return NextResponse.json({ error: `AI(${provider.label}) 응답 형식이 올바르지 않아 쓰지 않았어요. 다시 시도하거나 표준 문형 초안을 쓰세요.` }, { status: 502 });
    }
    return NextResponse.json({ ...guardFill(raw, input), model: res.model || provider.model, label: provider.label });
  } catch (e) {
    return NextResponse.json({ error: `AI(${provider.label})에 연결하지 못했어요. 표준 문형 초안을 그대로 쓰거나 잠시 후 다시 시도하세요.`, detail: (e as Error).message }, { status: 502 });
  }
}
