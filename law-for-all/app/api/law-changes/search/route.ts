import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 상위법 개정 반영 — 법령 검색(자동완성): 국가법령정보 법령 목록 조회(현행) → 법령명·법령일련번호(MST)·최근 공포일·제개정 구분 */
export async function GET(req: Request) {
  const rl = rateLimit(`law-changes-search:${clientKey(req)}`, 60);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return NextResponse.json({ laws: [] });
  const svc = new LawService(serverConfig.lawAccess);
  const laws = await svc.searchChangeLaws(q);
  return NextResponse.json({ laws, warnings: svc.warnings });
}
