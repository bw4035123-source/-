// 실서비스 자체규정 AI 검토 실측 — 모의 규정마다 /api/compliance-ai 를 불러 조문별 AI 판정·근거와 기준 규칙 판정을 나란히 기록
//   npx tsx scripts/compliance-live.ts https://lawon.onrender.com  → lib/eval/compliance-live.json
import fs from "node:fs";
import { SAMPLE_REGULATIONS, TARGET_LAWS, crossCheck, parseRegulation, SEVERITY_LABEL } from "@/lib/compliance";
import { MOCK_LAWS } from "@/lib/law-api/mock";
const base = process.argv[2] ?? "https://lawon.onrender.com";
async function main() {
const out: unknown[] = [];
for (const s of SAMPLE_REGULATIONS) {
  const rule = crossCheck({ text: s.text, orgType: s.orgType, regName: s.name, laws: MOCK_LAWS.filter((l) => TARGET_LAWS.some((t) => t.id === l.id)) });
  // 화면과 같게: 기준 규칙이 연결한 상위 조문을 힌트로
  const arts = parseRegulation(s.text).map((a, i) => ({ no: a.no, title: a.title, text: a.text, hints: Array.from(new Set([...rule.results[i].findings.flatMap((f) => f.basis), ...rule.results[i].related].map((b) => `${b.lawId}:${b.articleNo}`))).slice(0, 4) }));
  const t = Date.now();
  const r = await fetch(`${base}/api/compliance-ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ regName: s.name, orgType: s.orgType, articles: arts }), signal: AbortSignal.timeout(170000) }).then((x) => x.json()).catch((e) => ({ error: String(e) } as any));
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`\n=== ${s.name} (${arts.length}개 조문, ${sec}초) ${r.error ?? `${r.label} ${r.model}`}`);
  const rows = (r.articles ?? []).map((a: any, i: number) => {
    const ru = rule.results[i];
    const row = { no: a.no, title: arts[i].title, rule: SEVERITY_LABEL[ru.status], ai: a.verdict, issues: a.issues.map((x: any) => ({ point: x.point, basis: x.basis.map((k: string) => { const c = a.upper.find((u: any) => u.key === k); return c ? `${c.lawName} 제${c.articleNo}조` : k; }) })), upper: a.upper.map((c: any) => `${c.lawName} 제${c.articleNo}조`), dropped: a.dropped };
    console.log(`제${a.no}조(${arts[i].title}) 규칙:${row.rule} / AI:${a.verdict}${a.dropped ? ` (버림 ${a.dropped})` : ""}  상위: ${row.upper.slice(0, 3).join(", ") || "-"}`);
    for (const x of row.issues) console.log(`   • ${x.point.slice(0, 110)}  [${x.basis.join(", ")}]`);
    return row;
  });
  out.push({ name: s.name, seconds: Number(sec), label: r.label, model: r.model, error: r.error, rows });
}
fs.writeFileSync("lib/eval/compliance-live.json", JSON.stringify({ date: new Date().toISOString().slice(0, 10), base, regs: out }, null, 1) + "\n");
}
void main();
