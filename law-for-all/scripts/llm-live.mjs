// 실서비스 LLM 답변 실측 — 질문마다 실제로 답을 쓴 공급자(LLM/규칙엔진), 가드 결과, 규칙엔진 대체 사유, 응답 시간을 기록
//   node scripts/llm-live.mjs https://lawon.onrender.com openai [시험지.json ...] [--out lib/eval/llm-live.json] [--modes citizen,officer]
// 시험지는 coverage 형식({cases:[{q, laws?}]})을 그대로 씀. laws 가 있으면 coverage 와 같은 방식으로 정답 여부도 채점
import fs from "node:fs";
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d);
const out = opt("--out", "lib/eval/llm-live.json");
const modes = opt("--modes", "citizen").split(",");
const [base = "https://lawon.onrender.com", provider = "openai", ...fixtures] = args;
const files = fixtures.length ? fixtures : ["tests/fixtures/coverage-v1.json"];
const norm = (n) => n.replace(/\s+/g, "").replace(/[ㆍ•‧・]/g, "·");
const rows = [];
for (const f of files) {
  for (const c of JSON.parse(fs.readFileSync(f, "utf8")).cases) {
    for (const mode of modes) {
      let res, r, ms = 0;
      for (let k = 0; k < 10; k++) {
        const t0 = Date.now();
        res = await fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: c.q, mode, provider }) }).catch(() => null);
        ms = Date.now() - t0;
        if (res?.status !== 429) break;
        await new Promise((ok) => setTimeout(ok, (Number(res.headers.get("retry-after")) || 10) * 1000 + 500));
      }
      r = res?.ok ? await res.json().catch(() => null) : null;
      const laws = [...new Set((r?.citations ?? []).map((x) => x.lawName))];
      const want = new Set((c.laws ?? []).map(norm));
      rows.push({
        file: f, q: c.q, mode,
        used: r?.provider?.kind ?? "error", model: r?.provider?.model ?? null,
        fallback: r?.guard?.fallbackReason ?? null,
        passed: r?.guard?.passed ?? null,
        removed: r?.guard?.removedCitations?.length ?? 0, unverified: r?.guard?.unverifiedMentions?.length ?? 0,
        citations: laws.length, noResult: !!r && laws.length === 0,
        correct: c.laws ? laws.some((l) => want.has(norm(l))) : null,
        serverMs: r?.elapsedMs ?? null, wallMs: ms,
      });
      const x = rows.at(-1);
      console.log(x.used === "llm" ? "LLM " : x.used === "rule" ? "규칙" : "오류", String(x.serverMs ?? "-").padStart(6), mode.slice(0, 3), c.q.slice(0, 34), x.fallback ? `— 대체: ${x.fallback.slice(0, 60)}` : "");
    }
  }
}
// 근거가 있어 LLM 이 답을 쓸 수 있었던 질문 기준으로 집계(근거 없음은 LLM 을 부르지 않고 '찾지 못함'으로 안내)
const withEvidence = rows.filter((x) => x.citations > 0);
const llm = withEvidence.filter((x) => x.used === "llm");
const ms = llm.map((x) => x.serverMs).filter((v) => v != null).sort((a, b) => a - b);
const summary = {
  date: new Date().toISOString().slice(0, 10), base, provider, files, modes,
  total: rows.length, errors: rows.filter((x) => x.used === "error").length, noResult: rows.filter((x) => x.noResult).length,
  withEvidence: withEvidence.length, llmAnswered: llm.length, ruleFallback: withEvidence.filter((x) => x.used === "rule").length,
  removedTotal: llm.reduce((n, x) => n + x.removed, 0), unverifiedTotal: llm.reduce((n, x) => n + x.unverified, 0),
  correct: rows.filter((x) => x.correct === true).length, graded: rows.filter((x) => x.correct !== null).length,
  medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null, p90Ms: ms.length ? ms[Math.floor(ms.length * 0.9)] : null,
  model: llm[0]?.model ?? null,
};
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
