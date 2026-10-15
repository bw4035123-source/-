import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const svc = new LawService(serverConfig.lawAccess);
  const laws = await svc.listLaws(q);
  return NextResponse.json({ laws, mode: svc.mode, warnings: svc.warnings });
}
