// 처음 보는 일상 질문 대응률 — 실서비스(실시간 전체 법령 검색 포함) 측정. 결과는 lib/eval/coverage-live.json 의 label 항목에 저장
//   node scripts/coverage-live.mjs https://lawon.onrender.com before|after [시험지.json] [결과.json]
// 채점은 scripts/eval-report.ts 와 같음: 기대 법령을 근거로 인용하면 정답, 근거 없음은 '찾지 못함', 다른 법이면 오답
import fs from "node:fs";
const [base = "https://lawon.onrender.com", label = "after", fixture = "tests/fixtures/coverage-v1.json", file = "lib/eval/coverage-live.json"] = process.argv.slice(2);
const set = JSON.parse(fs.readFileSync(fixture, "utf8"));
const rows = [];
for (const c of set.cases) {
  let r;
  for (let i = 0; i < 3 && !r; i++) r = await fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: c.q, mode: "citizen" }) }).then((x) => x.json()).catch(() => null);
  const laws = [...new Set((r?.citations ?? []).map((x) => x.lawName))];
  rows.push({ q: c.q, external: !!c.external, result: laws.some((l) => c.laws.includes(l)) ? "correct" : laws.length ? "wrong" : "miss", got: laws.slice(0, 3), topic: r?.topic?.id ?? null });
}
const count = (rs) => ({ total: rs.length, correct: rs.filter((r) => r.result === "correct").length, miss: rs.filter((r) => r.result === "miss").length, wrong: rs.filter((r) => r.result === "wrong").length });
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
out[label] = { date: new Date().toISOString().slice(0, 10), base, ...count(rows), external: count(rows.filter((r) => r.external)), rows };
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(label, JSON.stringify({ ...count(rows), external: count(rows.filter((r) => r.external)) }));
for (const r of rows) console.log(r.result.slice(0, 4), r.q.slice(0, 38), r.got.join(", "));
