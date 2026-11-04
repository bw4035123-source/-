import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError } from "@/lib/llm/types";
import { LawService } from "@/lib/law-api/client";
import { articleLabel } from "@/lib/law-api/util";
import { parseLooseJson } from "@/lib/answer/guard";
import { gatherEvidence } from "@/lib/answer/ask";
import { maskPII } from "@/lib/privacy-mask";
import { PLAN_SYSTEM, buildPlanPrompt, guardPlan } from "@/lib/enact-plan";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ request: z.string().min(4).max(300), org: z.string().max(60).default(""), provider: z.string().max(20).optional() });

/** 한 줄 제정: 요청 → 국가법령정보에서 상위 조문 찾기 → AI가 규정 설계 → 가드(lib/enact-plan.ts) */
export async function POST(req: Request) {
  const rl = rateLimit(`enact-ai:${clientKey(req)}`, 10);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "만들 규정을 한 줄로 적어 주세요(4~300자)." }, { status: 400 });
  const request = maskPII(parsed.data.request).text;
  const { org } = parsed.data;
  const { provider } = resolveProvider(serverConfig.llm, parsed.data.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아 한 줄 제정을 할 수 없어요. 아래 칸을 직접 채워 표준 초안을 만드세요." }, { status: 503 });
  const svc = new LawService(serverConfig.lawAccess);
  const { context } = await gatherEvidence(request, svc);
  const evidence = context.slice(0, 8).map((c) => ({ key: c.key, label: `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`, text: c.text }));
  if (!evidence.length) return NextResponse.json({ error: "관련 상위 법령을 찾지 못했어요. 법령 이름이나 핵심어를 넣어 다시 적어 주세요(예: 산업안전보건법에 따른 안전보건 관리 지침).", warnings: svc.warnings }, { status: 404 });
  try {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildPlanPrompt(request, org, evidence) }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await provider.generate({ system: PLAN_SYSTEM, messages, json: true, temperature: 0.2, maxTokens: 1200 });
      try {
        const plan = guardPlan(parseLooseJson(res.text), evidence, org);
        if (plan.items.length >= 2) return NextResponse.json({ plan, evidence, label: provider.label, model: res.model || provider.model });
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: "items 에 조문 제목을 5~10개 넣어 같은 JSON 형식으로 다시 답하라." });
      } catch {
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라." });
      }
    }
    return NextResponse.json({ error: `AI(${provider.label})가 규정 설계를 만들지 못했어요. 요청을 조금 더 구체적으로 적어 주세요.` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof LLMError ? `AI(${provider.label})에 연결하지 못했어요. 잠시 후 다시 시도하세요.` : "한 줄 제정 중 오류가 났어요.", detail: (e as Error).message }, { status: 502 });
  }
}
