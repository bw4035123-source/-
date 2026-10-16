import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService, type LawListKind } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 100);
  const k = sp.get("kind");
  const kind: LawListKind = k === "admrul" || k === "ordin" ? k : "law";
  const svc = new LawService(serverConfig.lawAccess);
  const laws = await svc.listLaws(q, kind);
  return NextResponse.json({ laws, mode: svc.mode, warnings: svc.warnings });
}
