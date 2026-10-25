/**
 * 정확도 성적표 — 누구나 같은 결과를 다시 낼 수 있는 오프라인 시험(인증키·네트워크·LLM 불필요)
 *   npm run eval  →  lib/eval/report.json(화면 표시) · submission/정확도_성적표.md
 * 측정 항목: 상황(토픽) 분류 · 생활 용어 법령 사전 · 답변 근거 · 환각 주입 차단 · 개인정보 가림 · TS/Python 동일성 · LLM 교체 실측
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { matchLawAliases, matchTopics } from "../lib/law-api/search";
import { ask } from "../lib/answer/ask";
import { findUnverifiedMentions, guardLLMOutput } from "../lib/answer/guard";
import { maskPII } from "../lib/privacy-mask";
import { LLM_SWAP_RESULTS } from "../lib/llm/display";
import dev from "../tests/fixtures/routing-cases.json";
import holdout from "../tests/fixtures/routing-holdout.json";
import blindV1 from "../tests/fixtures/routing-blind.json";
import blind from "../tests/fixtures/routing-blind-v2.json";
import aliases from "../tests/fixtures/alias-cases.json";
import parity from "../python/tests/parity_fixtures.json";

const MARKER = /\[\[([^\]\s]+)\]\]/g;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

async function main() {
  // 1) 상황(토픽) 분류
  const route = (cases: { q: string; topic: string | null }[]) => {
    const rows = cases.map((c) => ({ ...c, got: matchTopics(c.q)[0]?.topic.id ?? null }));
    const miss = rows.filter((r) => r.got !== r.topic);
    return {
      total: rows.length,
      correct: rows.length - miss.length,
      // 틀린 것 중 엉뚱한 상황으로 간 것(나머지는 토픽 없이 전체 법령 실시간 검색으로 넘어감)
      wrongTopic: miss.filter((r) => r.got !== null).length,
      misses: miss.map((r) => ({ q: r.q, expected: r.topic, got: r.got })),
    };
  };
  // blind = 2차 블라인드(규칙 개선 전에 커밋, 개선 후 한 번 측정). 1차 블라인드는 측정 후 틀린 문항으로 규칙을 고쳤으므로 회귀 시험에 합치고,
  // 개선 전 측정값(2026-10-25, 32/42)은 기록으로만 남긴다
  const routing = {
    dev: route([...dev.cases, ...holdout.cases, ...blindV1.cases]),
    blind: route(blind.cases),
    blindV1: { total: 42, correct: 32, wrongTopic: 1, note: "1차 블라인드(개선 전 측정, 2026-10-25) — 이후 틀린 문항으로 규칙을 고쳐 회귀 시험으로 전환" },
  };

  // 2) 생활 용어 → 법령 사전
  const aliasRows = aliases.cases.map((c) => ({ ...c, got: matchLawAliases(c.q)[0]?.law ?? null }));
  const alias = { total: aliasRows.length, correct: aliasRows.filter((r) => r.got === r.law).length };

  // 3) 답변 근거: 모든 질문에 대해(국민·공직자) 답변의 조문 번호가 근거 목록 안에만 있는지, 인용 검증 통과 여부
  const questions = [...dev.cases, ...holdout.cases, ...blindV1.cases, ...blind.cases].map((c) => c.q);
  let answers = 0, withCitation = 0, guardPassed = 0, outsideMarkers = 0, noResultHonest = 0;
  const topicAnswers: Awaited<ReturnType<typeof ask>>[] = [];
  for (const q of questions) {
    for (const mode of ["citizen", "officer"] as const) {
      const r = await ask({ query: q, mode });
      answers++;
      const keys = new Set(r.citations.map((c) => c.key));
      const text = [r.summary, ...(r.citizen?.steps ?? []).flatMap((s) => [s.title, s.detail]), ...(r.officer?.keyPoints ?? [])].join("\n");
      outsideMarkers += Array.from(text.matchAll(MARKER)).filter((m) => !keys.has(m[1])).length;
      if (r.citations.length) withCitation++;
      else if (r.summary.includes("찾지 못했어요")) noResultHonest++;
      if (r.guard.passed) guardPassed++;
      if (mode === "citizen" && r.topic && r.citations.length) topicAnswers.push(r);
    }
  }
  const grounding = { answers, withCitation, noResultHonest, guardPassed, outsideMarkers };

  // 4) 환각 주입 시험: 실제 답변에 지어낸 인용을 섞어 가드가 걸러내는지(LLM이 틀리게 답한 상황을 흉내)
  let injected = 0, blocked = 0;
  for (const r of topicAnswers) {
    const ctx = r.citations;
    const real = ctx[0];
    // 근거 목록에 없는 법령을 고름(답변 근거에 형법 제347조가 이미 있는 전세사기 질문 등은 다른 법으로)
    const outside = ["「형법」 제347조", "「민법」 제750조", "「도로교통법」 제44조"].find((m) => !ctx.some((c) => m.includes(`「${c.lawName}」`)))!;
    const tries: [string, (s: string, keys: string[]) => boolean][] = [
      // 근거 목록에 없는 조문 번호 → 제거
      [`${real.title} 기준을 확인하세요 [[${real.key}]] [[no-such-law:999]]`, (s) => !s.includes("no-such-law")],
      // 실제 법령의 없는 조문(제999조) → 미검증 표시
      [`「${real.lawName}」 제999조에 따라 처리돼요 [[${real.key}]]`, (_s, u) => u.length > 0],
      // 근거로 가져오지 않은 다른 법 조문 → 미검증 표시
      [`${outside}에 따라 처벌돼요 [[${real.key}]]`, (_s, u) => u.length > 0],
    ];
    for (const [summary, ok] of tries) {
      injected++;
      const g = guardLLMOutput({ summary, steps: [], easyTerms: [], citations: [real.key] }, "citizen", ctx);
      if (ok(g.summary, g.unverified)) blocked++;
    }
    // 인용이 전부 지어낸 것 → 답변을 쓰지 않고 규칙엔진으로 대체(예외)
    injected++;
    try {
      guardLLMOutput({ summary: "근거 없이 지어낸 답변 [[fake:1]]", steps: [], easyTerms: [], citations: ["fake:1"] }, "citizen", ctx);
    } catch {
      blocked++;
    }
  }
  const injection = { answers: topicAnswers.length, injected, blocked };
  void findUnverifiedMentions;

  // 5) 개인정보 가림: 여러 표기의 개인정보는 가리고, 일반 질문(날짜·금액·수치 포함)은 건드리지 않는지
  const positives = [
    "900101-1234567", "900101 - 1234567", "9001011234567", "850315-2345678",
    "010-1234-5678", "01012345678", "010 1234 5678", "010.1234.5678", "02-123-4567", "031-987-6543", "070-1234-5678",
    "1234-5678-9012-3456", "1234 5678 9012 3456",
    "hong@test.com", "a.b+c@gov.go.kr",
    "123456-01-234567", "110-123-456789", "3333-01-1234567",
    "M12345678", "s98765432",
  ];
  const piiHit = positives.filter((p) => {
    const m = maskPII(`제 정보는 ${p} 입니다`);
    return m.found.length > 0 && !m.text.includes(p);
  }).length;
  const negatives = [...questions, "2026-10-25에 계약 끝나요", "보증금 2억 3000만원", "음주운전 0.03 걸리면", "시급 10,030원", "제3조의2 대항력", "2025년 10월 1일부터 30일까지", "1회 100만원 매 회계연도 300만원", "5% 이내 인상", "14일 이내 지급", "3개월 안에 구제신청"];
  const piiFalse = negatives.filter((q) => maskPII(q).found.length > 0);
  const privacy = { positives: positives.length, masked: piiHit, negatives: negatives.length, falsePositives: piiFalse.length };

  // 6) Next.js(TS) ↔ Python 실행판 동일성
  let parityPassed = false;
  try {
    execSync("python3 -m unittest tests.test_parity", { cwd: "python", stdio: "pipe" });
    parityPassed = true;
  } catch {
    parityPassed = false;
  }
  const p = parity as unknown as { ask: unknown[]; analyze: unknown[]; followup: unknown[] };
  const parityRes = { cases: p.ask.length + p.analyze.length + p.followup.length, passed: parityPassed };

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    command: "npm run eval",
    routing,
    alias,
    grounding,
    injection,
    privacy,
    parity: parityRes,
    llm: LLM_SWAP_RESULTS,
  };
  fs.mkdirSync("lib/eval", { recursive: true });
  fs.writeFileSync("lib/eval/report.json", JSON.stringify(report, null, 1) + "\n");

  const b = routing.blind;
  const md = `# 법이음(LAW:ON) 정확도 성적표

- 측정일: ${report.generatedAt} · 재현: \`npm install && npm run eval\` (인증키·네트워크·LLM 불필요, 내장 공식 원문 기준)
- 결과 원본: \`lib/eval/report.json\` · 시험 문항: \`tests/fixtures/\`

| 항목 | 결과 | 설명 |
|---|---|---|
| 상황 분류(2차 블라인드) | ${b.correct}/${b.total} (${pct(b.correct, b.total)}%) | 규칙 개선 전에 문항을 먼저 커밋하고, 개선 후 한 번만 잰 새 질문. 틀린 ${b.total - b.correct}건 중 엉뚱한 상황 ${b.wrongTopic}건, 나머지는 전체 법령 실시간 검색으로 넘어감 |
| 상황 분류(1차 블라인드, 개선 전) | ${routing.blindV1.correct}/${routing.blindV1.total} (${pct(routing.blindV1.correct, routing.blindV1.total)}%) | 첫 측정값(기록). 이 문항의 틀린 10건으로 규칙을 고친 뒤 회귀 시험으로 전환 |
| 상황 분류(회귀 시험) | ${routing.dev.correct}/${routing.dev.total} (${pct(routing.dev.correct, routing.dev.total)}%) | 개발 중 쓴 질문 + 1차 블라인드 — 고칠 때 이전 동작이 깨지지 않았는지 확인 |
| 생활 용어 → 법령 사전 | ${alias.correct}/${alias.total} | '산재'·'보이스피싱' 등 일상어가 가리키는 법령 |
| 답변 근거 | 조문 번호 ${grounding.outsideMarkers}건 근거 밖 · 인용 검증 통과 ${grounding.guardPassed}/${grounding.answers} | 질문 ${questions.length}건 × 국민·공직자 = 답변 ${grounding.answers}건. 근거 있음 ${grounding.withCitation}건, 근거가 없으면 지어내지 않고 '찾지 못함' 안내 ${grounding.noResultHonest}건 |
| 환각 주입 차단 | ${injection.blocked}/${injection.injected} (${pct(injection.blocked, injection.injected)}%) | 실제 답변 ${injection.answers}건에 없는 조문 번호·없는 조문·근거 밖 법령·전부 지어낸 인용을 섞어 가드가 걸러내는지 |
| 개인정보 가림 | ${privacy.masked}/${privacy.positives} 가림 · 오탐 ${privacy.falsePositives}/${privacy.negatives} | 주민등록번호·전화번호·카드·이메일·계좌·여권번호 여러 표기 / 날짜·금액·수치가 든 일반 질문 |
| Next.js ↔ Python 동일성 | ${parityRes.passed ? "일치" : "불일치"} (${parityRes.cases}건) | 같은 질문에 두 실행판이 같은 답·같은 근거 |
| LLM 교체 실측 | ${LLM_SWAP_RESULTS.models.map((m) => `${m.name} ${m.passed}/${m.total}`).join(" · ")} | ${LLM_SWAP_RESULTS.cases}, ${LLM_SWAP_RESULTS.date} |

## 2차 블라인드에서 틀린 질문(고치지 않고 기록)

${b.misses.map((m) => `- ${m.q} — 기대: ${m.expected ?? "없음"} / 결과: ${m.got ?? "토픽 없음 → 실시간 전체 법령 검색"}`).join("\n")}

※ 블라인드 문항을 보고 규칙을 고치면 더 이상 블라인드가 아니므로, 개선 후에는 새 문항으로 다시 잰다(1차 76.2% → 개선 → 2차 측정).
`;
  fs.writeFileSync("submission/정확도_성적표.md", md);
  console.log(md);
}

main();
