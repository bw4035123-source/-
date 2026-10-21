import { NextResponse } from "next/server";
import { z } from "zod";
import { followUp } from "@/lib/answer/followup";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().trim().min(2, "질문을 2자 이상 입력해 주세요.").max(300, "질문은 300자 이내로 입력해 주세요."),
  prevQuery: z.string().trim().min(1).max(500),
  mode: z.enum(["citizen", "officer"]).default("citizen"),
  provider: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" }, { status: 400 });
  }
  try {
    return NextResponse.json(await followUp(parsed.data));
  } catch (e) {
    console.error("[api/followup]", e);
    return NextResponse.json({ error: "답변 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
