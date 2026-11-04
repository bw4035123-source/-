import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService } from "@/lib/law-api/client";
import { parseOldAndNew } from "@/lib/upper-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 상위법 개정 전후 비교: 국가법령정보 신구법 비교 → 조문 단위 비교·바뀐 용어·수치·신설·삭제(lib/upper-change.ts)
 *   ?name=근로기준법            — 이름으로 신구법 목록을 찾아 현행 개정분
 *   ?name=근로기준법&mst=285279 — 법령 검색에서 고른 법령일련번호로 바로
 *   ?name=…&revision=제정       — 제정 법령은 개정 전 조문이 없음(안내)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const name = (sp.get("name") ?? "").trim().slice(0, 80);
  const mst = (sp.get("mst") ?? "").trim().slice(0, 12);
  const revision = (sp.get("revision") ?? "").trim();
  if (!name) return NextResponse.json({ error: "법령명을 입력하세요." }, { status: 400 });
  if (revision === "제정")
    return NextResponse.json({ error: `「${name}」은(는) 최근 제정된 법령이라 개정 전 조문이 없어요.`, code: "no-history" }, { status: 404 });
  const svc = new LawService(serverConfig.lawAccess);
  const got = await svc.getOldAndNew(name, mst || undefined);
  const change = got ? parseOldAndNew(got.data) : null;
  if (!change) {
    const live = svc.warnings.some((w) => w.includes("실패"));
    return NextResponse.json(
      {
        error: live
          ? `국가법령정보에서 「${name}」의 신구법 비교 자료를 가져오지 못했어요. 잠시 후 다시 시도하세요.`
          : `「${name}」의 최근 개정 내역(신구법 비교 자료)이 없어요. 제정 이후 개정되지 않았거나 다른 법률 개정에 따른 자구 수정만 있었을 수 있어요.`,
        code: live ? "unavailable" : "no-history",
        warnings: svc.warnings,
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ change, source: got!.source, warnings: svc.warnings });
}
