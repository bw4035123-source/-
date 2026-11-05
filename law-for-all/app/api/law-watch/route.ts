import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { LawService, type ChangeLawHit } from "@/lib/law-api/client";
import { searchLawNames } from "@/lib/law-api/search";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 같은 법령은 1시간 동안 다시 묻지 않음(첫 화면을 열 때마다 국가법령정보에 몰리지 않게)
const CACHE = new Map<string, { at: number; hit: ChangeLawHit | null }>();
const TTL = 60 * 60 * 1000;
const norm = (s: string) => s.replace(/\s/g, "");

/**
 * 상위법 개정 알림 — 지켜보는 법령마다 현행 최근 공포일·제개정 구분(국가법령정보 법령 목록 조회)
 *   GET /api/law-watch?names=근로기준법|산업안전보건법   (최대 20개)
 * 비교(우리 규정 기준일 이후 개정됐는지)는 화면에서 함 — 지켜보는 목록은 서버에 저장하지 않음
 */
export async function GET(req: Request) {
  const rl = rateLimit(`law-watch:${clientKey(req)}`, 30);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const names = Array.from(new Set((new URL(req.url).searchParams.get("names") ?? "").split("|").map((x) => x.trim().slice(0, 60)).filter(Boolean))).slice(0, 20);
  if (!names.length) return NextResponse.json({ laws: [], missing: [] });
  const svc = new LawService(serverConfig.lawAccess);
  const now = Date.now();
  const found = await Promise.all(
    names.map(async (q) => {
      const c = CACHE.get(q);
      if (c && now - c.at < TTL) return { q, hit: c.hit };
      const hits = await svc.searchChangeLaws(q).catch(() => [] as ChangeLawHit[]);
      // 이름이 같은 법령(약칭이면 정식 법령명) — 시행령·시행규칙으로 잘못 붙지 않게
      const official = searchLawNames(q)[0]?.name;
      const hit = hits.find((h) => norm(h.name) === norm(q)) ?? (official ? hits.find((h) => norm(h.name) === norm(official)) : undefined) ?? null;
      if (hit?.promulgated || !svc.warnings.length) CACHE.set(q, { at: now, hit });
      return { q, hit };
    }),
  );
  return NextResponse.json({
    laws: found.filter((f) => f.hit?.promulgated).map((f) => ({ query: f.q, ...f.hit! })),
    missing: found.filter((f) => !f.hit?.promulgated).map((f) => f.q),
    checkedAt: new Date().toISOString(),
    warnings: Array.from(new Set(svc.warnings)).slice(0, 3),
  });
}
