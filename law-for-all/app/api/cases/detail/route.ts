import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 판례·법령해석례 상세: /api/cases/detail?kind=prec|expc&id=일련번호 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") === "expc" ? "법령해석례" : "판례";
  const id = sp.get("id") ?? "";
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "잘못된 판례 식별자" }, { status: 400 });
  const svc = new LawService(serverConfig.lawAccess);
  if (svc.mode !== "live") return NextResponse.json({ error: "판례 보기는 법제처 국가법령정보 인증키(LAW_API_OC)를 설정하면 제공됩니다.", live: false }, { status: 503 });
  const detail = await svc.getCase(kind, id);
  if (!detail) return NextResponse.json({ error: svc.warnings[0] ?? "판례를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ detail });
}
