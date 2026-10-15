import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 판례·법령해석례 실시간 검색(OC 미설정 시 빈 목록 — 사건번호를 지어내지 않음) */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 100);
  const limit = Math.min(Number(sp.get("limit")) || 5, 20);
  const svc = new LawService(serverConfig.lawAccess);
  const cases = await svc.searchCases(q, limit);
  return NextResponse.json({ cases, live: svc.mode === "live", warnings: svc.warnings });
}
