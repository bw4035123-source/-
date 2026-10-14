/**
 * LLM 스위칭 점검 도구 — 설정된 모든 공급자로 같은 질문을 보내 결과·검증 상태를 비교한다.
 *   npm run llm:check                 # 기본 질문
 *   npm run llm:check -- "질문" officer
 */
import fs from "node:fs";
import path from "node:path";

// .env.local → .env 순으로 읽기(이미 설정된 환경변수 우선)
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { serverConfig } = await import("../lib/config");
  const { listProviders } = await import("../lib/llm/registry");
  const { ask } = await import("../lib/answer/ask");
  const query = process.argv[2] ?? "윗집 층간소음 기준이 어떻게 되나요?";
  const mode = process.argv[3] === "officer" ? "officer" : "citizen";

  console.log(`\n질문: ${query} (${mode === "officer" ? "공무원" : "시민"} 모드)`);
  console.log(`법령 데이터: ${serverConfig.lawApiOc ? "국가법령정보 실시간" : "내장 시연 데이터"}\n`);
  const providers = await listProviders(serverConfig.llm);
  for (const p of providers) {
    if (!p.configured) {
      console.log(`○ ${p.label.padEnd(24)} 건너뜀 — ${p.hint}`);
      continue;
    }
    const r = await ask({ query, mode, provider: p.id });
    const ok = r.provider.id === p.id;
    console.log(`${ok ? "●" : "△"} ${p.label.padEnd(24)} 응답 ${r.provider.label}(${r.provider.model}) · ${r.elapsedMs}ms · 인용 ${r.citations.length}건 · 검증 ${r.guard.passed ? "통과" : "확인필요"}`);
    console.log(`   요약: ${r.summary.replace(/\[\[[^\]]+\]\]/g, "").slice(0, 120)}…`);
    if (r.guard.removedCitations.length) console.log(`   제거된 인용: ${r.guard.removedCitations.join(", ")}`);
    if (r.guard.fallbackReason) console.log(`   대체 사유: ${r.guard.fallbackReason}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
