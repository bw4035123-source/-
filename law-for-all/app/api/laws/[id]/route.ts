import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 법령 본문 + 3단(법률-시행령-시행규칙) 구조 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  if (!/^[a-z0-9-]{2,60}$/.test(id)) return NextResponse.json({ error: "잘못된 법령 식별자" }, { status: 400 });
  const svc = new LawService(serverConfig.lawAccess);
  const h = await svc.getHierarchy(id);
  if (!h) return NextResponse.json({ error: "법령을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ...h, warnings: svc.warnings });
}
