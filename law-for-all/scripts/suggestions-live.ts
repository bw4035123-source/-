// 공직자 메인 해시태그 실서비스 점검 — 해시태그마다 공직자 모드로 물어 기대 법령을 근거로 인용하는지
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/suggestions-live.ts https://lawon.onrender.com
import { OFFICER_SUGGESTIONS } from "@/lib/suggestions";
const base = process.argv[2] ?? "https://lawon.onrender.com";
const norm = (s: string) => s.replace(/\s/g, "").replace(/[ㆍ·]/g, "");
async function main() {
  let ok = 0;
  for (const s of OFFICER_SUGGESTIONS) {
    const t = Date.now();
    const r = await fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: s.query, mode: "officer" }) }).then((x) => x.json()).catch(() => null);
    const laws = Array.from(new Set(((r?.citations ?? []) as { lawName: string }[]).map((c) => c.lawName)));
    const want = norm(s.law ?? "").replace(/시행령$/, "");
    const pass = laws.some((l) => norm(l).startsWith(want));
    if (pass) ok++;
    console.log(`${pass ? "OK " : "XX "} #${s.label.padEnd(8)} ${((Date.now() - t) / 1000).toFixed(1)}s ${r?.provider?.label ?? "-"} | ${laws.slice(0, 3).join(", ") || "근거 없음"}`);
  }
  console.log(`${ok}/${OFFICER_SUGGESTIONS.length}`);
}
void main();
