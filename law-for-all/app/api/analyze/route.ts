import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze } from "@/lib/answer/analyze";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  situation: z.string().trim().min(10, "상황을 10자 이상 구체적으로 적어 주세요.").max(2000, "상황 설명은 2,000자 이내로 적어 주세요."),
  provider: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const rl = rateLimit(`analyze:${clientKey(req)}`, 20);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" }, { status: 400 });
  try {
    return NextResponse.json(await analyze(parsed.data));
  } catch (e) {
    console.error("[api/analyze]", e);
    return NextResponse.json({ error: "상황 분석 중 오류가 발생했습니다." }, { status: 500 });
  }
}
