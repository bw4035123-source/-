import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 판례·법령해석례 실시간 검색(OC 미설정 시 빈 목록 — 사건번호를 지어내지 않음) */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const svc = new LawService(serverConfig.lawApiOc);
  const cases = await svc.searchCases(q);
  return NextResponse.json({ cases, live: svc.mode === "live", warnings: svc.warnings });
}
