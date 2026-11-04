import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";
import { parseOldAndNew } from "@/lib/upper-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 상위법 개정 전후 비교: 국가법령정보 신구법 비교 → 조문 단위 비교·바뀐 용어·수치·신설·삭제(lib/upper-change.ts) */
export async function GET(req: Request) {
  const name = (new URL(req.url).searchParams.get("name") ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "법령명을 입력하세요." }, { status: 400 });
  const svc = new LawService(serverConfig.lawAccess);
  const got = await svc.getOldAndNew(name);
  const change = got ? parseOldAndNew(got.data) : null;
  if (!change) return NextResponse.json({ error: `「${name}」의 개정 전후 비교 자료를 찾지 못했어요. 법령명을 정확히 적었는지 확인하세요.`, warnings: svc.warnings }, { status: 404 });
  return NextResponse.json({ change, source: got!.source, warnings: svc.warnings });
}
