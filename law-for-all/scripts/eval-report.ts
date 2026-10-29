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
import { extractQuantities, unverifiedQuantities } from "../lib/answer/numbers";
import { maskPII } from "../lib/privacy-mask";
import { LLM_SWAP_RESULTS } from "../lib/llm/display";
import { serverConfig } from "../lib/config";
import dev from "../tests/fixtures/routing-cases.json";
import holdout from "../tests/fixtures/routing-holdout.json";
import blindV1 from "../tests/fixtures/routing-blind.json";
import blindV2 from "../tests/fixtures/routing-blind-v2.json";
import blindV3 from "../tests/fixtures/routing-blind-v3.json";
import blindV4 from "../tests/fixtures/routing-blind-v4.json";
import blindV5 from "../tests/fixtures/routing-blind-v5.json";
import blind from "../tests/fixtures/routing-blind-v6.json";
import coverageSet from "../tests/fixtures/coverage-v1.json";
import coverageBlindSet from "../tests/fixtures/coverage-blind-v1.json";
import coverageBlindSet2 from "../tests/fixtures/coverage-blind-v2.json";
import coverageBlindSet3 from "../tests/fixtures/coverage-blind-v3.json";
import aliases from "../tests/fixtures/alias-cases.json";
import parity from "../python/tests/parity_fixtures.json";

const MARKER = /\[\[([^\]\s]+)\]\]/g;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

async function main() {
  // 누구나 같은 결과가 나오도록 항상 내장 공식 원문 스냅샷으로만 잰다(중계 서버·인증키·LLM 사용 안 함)
  process.env.LAW_PROXY_URL = "off";
  (serverConfig as { lawApiOc: string }).lawApiOc = "";
  serverConfig.llm.defaultProvider = "mock";
  // 1) 상황(토픽) 분류
  // accept: 법적으로 두 답이 가능해 측정 전에 둘 다 정답으로 정한 문항(엄격 채점 strict 은 첫 라벨만)
  const route = (cases: { q: string; topic: string | null; accept?: (string | null)[] }[]) => {
    const rows = cases.map((c) => ({ ...c, got: matchTopics(c.q)[0]?.topic.id ?? null }));
    const miss = rows.filter((r) => !(r.accept ?? [r.topic]).includes(r.got));
    return {
      total: rows.length,
      correct: rows.length - miss.length,
      strict: rows.filter((r) => r.got === r.topic).length,
      // 틀린 것 중 엉뚱한 상황으로 간 것(나머지는 토픽 없이 전체 법령 실시간 검색으로 넘어감)
      wrongTopic: miss.filter((r) => r.got !== null).length,
      misses: miss.map((r) => ({ q: r.q, expected: r.topic, got: r.got })),
    };
  };
  // blind = 6차 블라인드(독립 작성자 EXAONE 3.5 생성, 규칙 개선 후 처음 열어 라벨만 검토·커밋, 한 번 측정).
  // 1~5차는 측정 후 틀린 문항으로 규칙을 고쳤으므로 회귀 시험에 합치고, 각 차수의 측정 당시 값은 history 로만 남긴다
  const routing = {
    dev: route([...dev.cases, ...holdout.cases, ...blindV1.cases, ...blindV2.cases, ...blindV3.cases, ...blindV4.cases, ...blindV5.cases]),
    blind: route(blind.cases),
    history: [
      { round: 1, author: "개발자", correct: 32, total: 42, note: "첫 측정" },
      { round: 2, author: "개발자", correct: 35, total: 42, note: "1차 틀린 문항으로 개선 후, 미리 커밋한 새 문항" },
      { round: 3, author: "개발자", correct: 42, total: 42, note: "무효 — 문항을 쓴 직후 같은 작성자가 표현을 보강해 오염" },
      { round: 4, author: "EXAONE 3.5", correct: 43, total: 60, note: "독립 작성자 첫 측정(규칙 사전 미제공)" },
      { round: 5, author: "EXAONE 3.5", correct: 38, total: 44, note: "4차로 개선 후, 개선 중 열어 보지 않은 새 문항" },
      { round: 6, author: "EXAONE 3.5", correct: 0, total: 0, note: "5차로 개선 후, 개선 중 열어 보지 않은 새 문항 — 목표(90%) 도달로 반복 중단" },
    ],
  };
  routing.history[5].correct = routing.blind.correct;
  routing.history[5].total = routing.blind.total;

  // 2) 생활 용어 → 법령 사전
  const aliasRows = aliases.cases.map((c) => ({ ...c, got: matchLawAliases(c.q)[0]?.law ?? null }));
  const alias = { total: aliasRows.length, correct: aliasRows.filter((r) => r.got === r.law).length };

  // 3) 답변 근거: 모든 질문에 대해(국민·공직자) 답변의 조문 번호가 근거 목록 안에만 있는지, 인용 검증 통과 여부
  const questions = [...dev.cases, ...holdout.cases, ...blindV1.cases, ...blindV2.cases, ...blindV3.cases, ...blindV4.cases, ...blindV5.cases, ...blind.cases].map((c) => c.q);
  let answers = 0, withCitation = 0, guardPassed = 0, outsideMarkers = 0, noResultHonest = 0;
  // 수치 대조 오경보: 사람이 검수한(또는 원문에서 옮긴) 정상 답변의 금액·기간이 근거 원문에서 확인되는지
  let qtyChecked = 0, qtyFalseAlarm = 0;
  const topicAnswers: Awaited<ReturnType<typeof ask>>[] = [];
  for (const q of questions) {
    for (const mode of ["citizen", "officer"] as const) {
      const r = await ask({ query: q, mode });
      answers++;
      const keys = new Set(r.citations.map((c) => c.key));
      const text = [r.summary, ...(r.citizen?.steps ?? []).flatMap((s) => [s.title, s.detail]), ...(r.officer?.keyPoints ?? [])].join("\n");
      outsideMarkers += Array.from(text.matchAll(MARKER)).filter((m) => !keys.has(m[1])).length;
      if (r.citations.length) {
        qtyChecked++;
        const texts = [r.summary, ...(r.citizen?.easyTerms ?? []).map((t) => t.meaning), ...(r.citizen?.steps ?? []).flatMap((s) => [s.title, s.detail]), r.citizen?.tip ?? "", ...(r.citizen?.cases ?? []).map((c) => c.detail), r.officer?.background ?? "", ...(r.officer?.keyPoints ?? [])];
        if (unverifiedQuantities(texts, [...r.citations.map((c) => `${c.title}\n${c.text}`), q]).length) qtyFalseAlarm++;
      }
      if (r.citations.length) withCitation++;
      else if (r.summary.includes("찾지 못했어요")) noResultHonest++;
      if (r.guard.passed) guardPassed++;
      if (mode === "citizen" && r.topic && r.citations.length) topicAnswers.push(r);
    }
  }
  const grounding = { answers, withCitation, noResultHonest, guardPassed, outsideMarkers };

  // 3-2) 처음 보는 일상 질문 대응률: 기대 법령을 근거로 인용하면 정답, '찾지 못함'은 정직한 미응답, 다른 법이면 오답(국민 모드)
  type CovRow = { q: string; external: boolean; result: "correct" | "miss" | "wrong"; got: string[] };
  // 법령 이름 표기 차이(띄어쓰기·가운뎃점 ·ㆍ•)는 같은 법으로 채점
  const normLaw = (n: string) => n.replace(/\s+/g, "").replace(/[ㆍ•‧・]/g, "·");
  const covRun = async (cases: { q: string; laws: string[]; external?: boolean }[]) => {
    const rows: CovRow[] = [];
    for (const c of cases) {
      const r = await ask({ query: c.q, mode: "citizen" });
      const laws = Array.from(new Set(r.citations.map((x) => x.lawName)));
      const want = new Set(c.laws.map(normLaw));
      rows.push({ q: c.q, external: !!c.external, result: laws.some((l) => want.has(normLaw(l))) ? "correct" : laws.length ? "wrong" : "miss", got: laws.slice(0, 3) });
    }
    return rows;
  };
  const covRows = await covRun(coverageSet.cases as { q: string; laws: string[]; external?: boolean }[]);
  // 독립 작성자(로컬 EXAONE) 블라인드 — 넓은 생활 분야 이름만 보고 쓴 문항, 측정 후 이 문항으로 규칙을 고치지 않음
  const blindRows = await covRun(coverageBlindSet.cases as { q: string; laws: string[] }[]);
  // 2차 블라인드 — 1차 결과로 실시간 검색 기준·생활 용어 사전을 고친 뒤 처음 연 새 문항(seed 20261030)
  const blind2Rows = await covRun(coverageBlindSet2.cases as { q: string; laws: string[] }[]);
  // 3차 블라인드 — 2차 뒤 '두 글자 키워드만 겹친 관계없는 법 제외'를 개발용 문항으로 고친 다음 처음 연 새 문항(seed 20261031)
  const blind3Rows = await covRun(coverageBlindSet3.cases as { q: string; laws: string[] }[]);
  const covCount = (rows: CovRow[]) => ({ total: rows.length, correct: rows.filter((r) => r.result === "correct").length, miss: rows.filter((r) => r.result === "miss").length, wrong: rows.filter((r) => r.result === "wrong").length });
  const coverage = { ...covCount(covRows), external: covCount(covRows.filter((r) => r.external)), rows: covRows, blind: { ...covCount(blindRows), rows: blindRows }, blind2: { ...covCount(blind2Rows), rows: blind2Rows }, blind3: { ...covCount(blind3Rows), rows: blind3Rows } };
  // 실서비스(실시간 전체 법령 검색 포함) 측정값 — scripts/coverage-live.mjs 로 개선 전·후 기록(인증키·네트워크 필요해 재현 시험과 분리)
  type LiveCov = { date: string; correct: number; total: number; miss: number; wrong: number; external: { correct: number; total: number } };
  const covLive = (fs.existsSync("lib/eval/coverage-live.json") ? JSON.parse(fs.readFileSync("lib/eval/coverage-live.json", "utf8")) : {}) as { before?: LiveCov; after?: LiveCov };
  const covBlindLive = (fs.existsSync("lib/eval/coverage-blind-live.json") ? JSON.parse(fs.readFileSync("lib/eval/coverage-blind-live.json", "utf8")) : {}) as { once?: LiveCov };
  const covBlind2Live = (fs.existsSync("lib/eval/coverage-blind-v2-live.json") ? JSON.parse(fs.readFileSync("lib/eval/coverage-blind-v2-live.json", "utf8")) : {}) as { once?: LiveCov; offlineOnce?: { correct: number; total: number } };
  const covBlind3Live = (fs.existsSync("lib/eval/coverage-blind-v3-live.json") ? JSON.parse(fs.readFileSync("lib/eval/coverage-blind-v3-live.json", "utf8")) : {}) as { once?: LiveCov; offlineOnce?: { correct: number; total: number } };
  const covWeak = (fs.existsSync("lib/eval/coverage-weak-live.json") ? JSON.parse(fs.readFileSync("lib/eval/coverage-weak-live.json", "utf8")) : {}) as { before?: LiveCov; after?: LiveCov };

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

  // 4-2) 수치 바꿔치기 시험: 실제 답변에 근거 원문의 금액·기간 하나를 다른 값으로 바꾼 문장을 섞어 가드가 답변을 막는지
  let qtyTampered = 0, qtyCaught = 0, qtyCleanPassed = 0;
  const MUT: Record<string, (v: number) => string> = {
    원: (v) => (v * 2 >= 1e4 ? `${(v * 2) / 1e4}만원` : `${v * 2}원`),
    "%": (v) => `${v * 2}%`, 개월: (v) => `${v + 1}개월`, 년: (v) => `${v + 1}년`, 일: (v) => `${v + 7}일`, 시간: (v) => `${v + 1}시간`, 배: (v) => `${v + 1}배`, 세: (v) => `${v + 1}세`, dB: (v) => `${v + 5}dB`,
  };
  for (const r of topicAnswers) {
    const ctx = r.citations;
    const sources = [...ctx.map((c) => `${c.title}\n${c.text}`), r.query];
    const base = { summary: r.summary, steps: [], easyTerms: [], citations: [ctx[0].key] };
    try {
      guardLLMOutput(base, "citizen", ctx, [r.query]);
      qtyCleanPassed++;
    } catch {
      /* 정상 답변이 막힘 = 오경보(아래 성적표에 그대로 드러남) */
    }
    const known = new Set(sources.flatMap(extractQuantities));
    const target = extractQuantities(sources.join("\n")).find((x) => MUT[x.split(":")[0]]);
    if (!target) continue;
    const [u, v] = target.split(":");
    const fake = MUT[u](Number(v));
    if (extractQuantities(fake).some((x) => known.has(x))) continue;
    qtyTampered++;
    try {
      guardLLMOutput({ ...base, summary: `${r.summary} 기준은 ${fake}이에요 [[${ctx[0].key}]]` }, "citizen", ctx, [r.query]);
    } catch (e) {
      if (/수치/.test((e as Error).message)) qtyCaught++;
    }
  }
  const quantity = { checked: qtyChecked, falseAlarm: qtyFalseAlarm, answers: topicAnswers.length, cleanPassed: qtyCleanPassed, tampered: qtyTampered, caught: qtyCaught };
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
    coverage,
    injection,
    quantity,
    privacy,
    parity: parityRes,
    llm: LLM_SWAP_RESULTS,
    // 블라인드 실서비스 측정값(행만 빼고 요약) — 소개 화면 표시용
    coverageLive: {
      blind: covBlindLive.once ? { correct: covBlindLive.once.correct, total: covBlindLive.once.total, miss: covBlindLive.once.miss, wrong: covBlindLive.once.wrong } : null,
      blind2: covBlind2Live.once ? { correct: covBlind2Live.once.correct, total: covBlind2Live.once.total, miss: covBlind2Live.once.miss, wrong: covBlind2Live.once.wrong } : null,
      blind3: covBlind3Live.once ? { correct: covBlind3Live.once.correct, total: covBlind3Live.once.total, miss: covBlind3Live.once.miss, wrong: covBlind3Live.once.wrong } : null,
    },
  };
  fs.mkdirSync("lib/eval", { recursive: true });
  fs.writeFileSync("lib/eval/report.json", JSON.stringify(report, null, 1) + "\n");

  const b = routing.blind;
  const md = `# 법이음(LAW:ON) 정확도 성적표

- 측정일: ${report.generatedAt} · 재현: \`npm install && npm run eval\` (인증키·네트워크·LLM 불필요, 내장 공식 원문 기준)
- 결과 원본: \`lib/eval/report.json\` · 시험 문항: \`tests/fixtures/\`

| 항목 | 결과 | 설명 |
|---|---|---|
| 상황 분류(6차 블라인드, 독립 작성자) | ${b.correct}/${b.total} (${pct(b.correct, b.total)}%) · 엄격 ${b.strict}/${b.total} (${pct(b.strict, b.total)}%) | **정해진 상황 안에서의 분류 정확도**(상황 밖 질문 대응은 아래 '처음 보는 일상 질문' 참고). 로컬 EXAONE 3.5가 상황 이름·한 줄 설명만 보고 쓴 질문(규칙 사전 미제공). 규칙 개선 중에는 열어 보지 않고, 라벨만 검토해 커밋한 뒤 한 번 측정. 법적으로 두 답이 가능한 문항은 측정 전에 둘 다 인정(엄격 채점은 첫 라벨만). 틀린 ${b.total - b.correct}건 중 엉뚱한 상황 ${b.wrongTopic}건 |
| 상황 분류(회귀 시험) | ${routing.dev.correct}/${routing.dev.total} (${pct(routing.dev.correct, routing.dev.total)}%) | 개발 중 쓴 질문 + 1~5차 블라인드 — 고칠 때 이전 동작이 깨지지 않았는지 확인 |
| 처음 보는 일상 질문 · 블라인드(독립 작성자) | 실서비스 ${covBlindLive.once ? `${covBlindLive.once.correct}/${covBlindLive.once.total} (${pct(covBlindLive.once.correct, covBlindLive.once.total)}%) · 찾지 못함 ${covBlindLive.once.miss} · 다른 법 ${covBlindLive.once.wrong}` : "미측정"} · 내장만 ${coverage.blind.correct}/${coverage.blind.total} (${pct(coverage.blind.correct, coverage.blind.total)}%) | 로컬 EXAONE 3.5가 넓은 생활 분야 이름만 보고 쓴 질문(법이음 상황 목록 미제공). 기대 법령 이름만 사람이 검토(정식 명칭·없는 법 정리, 사유 공개)한 뒤 커밋하고 한 번 측정, 이 문항으로 규칙을 고치지 않음 |
| 처음 보는 일상 질문 · 블라인드 2차(독립 작성자) | 실서비스 ${covBlind2Live.once ? `${covBlind2Live.once.correct}/${covBlind2Live.once.total} (${pct(covBlind2Live.once.correct, covBlind2Live.once.total)}%) · 찾지 못함 ${covBlind2Live.once.miss} · 다른 법 ${covBlind2Live.once.wrong}` : "미측정"} · 내장만 ${covBlind2Live.offlineOnce ? `${covBlind2Live.offlineOnce.correct}/${covBlind2Live.offlineOnce.total}` : `${coverage.blind2.correct}/${coverage.blind2.total}`}${covBlind2Live.offlineOnce && covBlind2Live.offlineOnce.correct !== coverage.blind2.correct ? ` (측정 후 수정 반영 시 ${coverage.blind2.correct}/${coverage.blind2.total} — 블라인드 아님)` : ""} | 1차 결과를 보고 실시간 검색 기준·생활 용어 사전을 고친 뒤, 같은 방식(seed만 바꿈)으로 새로 받은 문항. 라벨 검토본을 측정 전에 커밋하고 한 번 측정(측정값 고정). 측정 후 결과에서 본 '관계없는 법 덧붙음' 문제는 개발용 문항으로 원인을 찾아 고쳤으므로, 그 효과는 3차 새 문항으로 잰다 |
| 처음 보는 일상 질문 · 블라인드 3차(독립 작성자) | 실서비스 ${covBlind3Live.once ? `${covBlind3Live.once.correct}/${covBlind3Live.once.total} (${pct(covBlind3Live.once.correct, covBlind3Live.once.total)}%) · 찾지 못함 ${covBlind3Live.once.miss} · 다른 법 ${covBlind3Live.once.wrong}` : "미측정"} · 내장만 ${covBlind3Live.offlineOnce ? `${covBlind3Live.offlineOnce.correct}/${covBlind3Live.offlineOnce.total}` : `${coverage.blind3.correct}/${coverage.blind3.total}`}${covBlind3Live.offlineOnce && covBlind3Live.offlineOnce.correct !== coverage.blind3.correct ? ` (측정 후 수정 반영 시 ${coverage.blind3.correct}/${coverage.blind3.total} — 블라인드 아님)` : ""} | 2차 뒤 '두 글자 키워드만 겹친 관계없는 법 제외'를 개발용 문항으로 고친 다음, 같은 방식(seed만 바꿈)으로 새로 받은 문항. 라벨 검토본을 측정 전에 커밋하고 한 번 측정(측정값 고정) |
${covWeak.before && covWeak.after ? `| 약한 분야 보강 개발 문항(실서비스) | 개선 전 ${covWeak.before.correct}/${covWeak.before.total} → 개선 후 ${covWeak.after.correct}/${covWeak.after.total} · 다른 법 ${covWeak.before.wrong} → ${covWeak.after.wrong} | 3차 블라인드에서 약했던 수사·세금/과태료·학교·소비자 분야 질문 ${covWeak.after.total}건을 개발자가 써서 개선 전에 커밋하고 생활 용어 사전을 보강(${covWeak.before.date} → ${covWeak.after.date}). 개발자 작성이고 3차 문항을 본 뒤 썼으므로 블라인드 아님 — 효과는 4차 새 문항으로 잰다 |` : ""}
${covLive.before && covLive.after ? `| 처음 보는 일상 질문(실서비스) | 개선 전 ${covLive.before.correct}/${covLive.before.total} → 개선 후 ${covLive.after.correct}/${covLive.after.total} (${pct(covLive.after.correct, covLive.after.total)}%) · 찾지 못함 ${covLive.after.miss} · 다른 법 ${covLive.after.wrong} | 같은 질문을 실서비스(국가법령정보 실시간 전체 법령 검색 포함)에 넣은 결과(${covLive.before.date} → ${covLive.after.date}, \`scripts/coverage-live.mjs\`). 외부 평가자 질문 ${covLive.before.external.correct}/${covLive.before.external.total} → ${covLive.after.external.correct}/${covLive.after.external.total} |\n` : ""}| 처음 보는 일상 질문(내장 데이터만) | ${coverage.correct}/${coverage.total} (${pct(coverage.correct, coverage.total)}%) · 찾지 못함 ${coverage.miss} · 다른 법 ${coverage.wrong} | 상황 이름을 보지 않고 쓴 일상 질문 ${coverage.total}건(외부 평가자 질문 ${coverage.external.total}건 포함: ${coverage.external.correct}건 정답)에 기대 법령을 근거로 답했는지. 인터넷 없이 내장 법령만 쓴 값이며, 실서비스는 실시간 전체 법령 검색이 더해짐. 개발자 작성(블라인드 아님) |
| 생활 용어 → 법령 사전 | ${alias.correct}/${alias.total} | '산재'·'보이스피싱' 등 일상어가 가리키는 법령 |
| 답변 근거 | 조문 번호 ${grounding.outsideMarkers}건 근거 밖 · 인용 검증 통과 ${grounding.guardPassed}/${grounding.answers} | 질문 ${questions.length}건 × 국민·공직자 = 답변 ${grounding.answers}건. 근거 있음 ${grounding.withCitation}건, 근거가 없으면 지어내지 않고 '찾지 못함' 안내 ${grounding.noResultHonest}건. 규칙기반 답변은 사람이 검수한 문장이라 근거 밖 인용이 원래 생기기 어렵고, 생성형 AI를 연결했을 때 가드가 막는지는 아래 '환각 주입'·'수치 바꿔치기' 행이 보여 줌 |
| 환각 주입 차단 | ${injection.blocked}/${injection.injected} (${pct(injection.blocked, injection.injected)}%) | 실제 답변 ${injection.answers}건에 없는 조문 번호·없는 조문·근거 밖 법령·전부 지어낸 인용을 섞어 가드가 걸러내는지 |
| 수치 바꿔치기 차단 | ${quantity.caught}/${quantity.tampered} (${pct(quantity.caught, quantity.tampered)}%) · 오경보 ${quantity.falseAlarm}/${quantity.checked} | 실제 답변에 근거 원문의 금액·기간·비율을 다른 값으로 바꾼 문장을 섞으면 가드가 답변을 막고 규칙기반으로 대체하는지 / 근거가 있는 정상 답변 ${quantity.checked}건 중 수치 때문에 잘못 막힌 답변(규칙은 이 답변들을 보며 다듬었으므로 블라인드 아님). 놓친 경우는 원문에 '전액'이 있어 100%를 정상 풀이로 인정한 경우 |
| 개인정보 가림 | ${privacy.masked}/${privacy.positives} 가림 · 오탐 ${privacy.falsePositives}/${privacy.negatives} | 주민등록번호·전화번호·카드·이메일·계좌·여권번호 여러 표기 / 날짜·금액·수치가 든 일반 질문 |
| Next.js ↔ Python 동일성 | ${parityRes.passed ? "일치" : "불일치"} (${parityRes.cases}건) | 같은 질문에 두 실행판이 같은 답·같은 근거 |
| LLM 교체 실측 | ${LLM_SWAP_RESULTS.models.map((m) => `${m.name} ${m.passed}/${m.total}`).join(" · ")} | ${LLM_SWAP_RESULTS.cases}, ${LLM_SWAP_RESULTS.date} |

## 처음 보는 일상 질문 — 문항별 결과

${coverage.rows.map((r) => `- ${r.result === "correct" ? "○" : r.result === "miss" ? "△ 찾지 못함" : "✕ 다른 법"} ${r.q}${r.external ? " (외부 평가자)" : ""}${r.got.length ? ` — 근거: ${r.got.join(", ")}` : ""}`).join("\n")}

## 처음 보는 일상 질문 · 블라인드(독립 작성자) — 문항별 결과(내장 데이터만)

${coverage.blind.rows.map((r) => `- ${r.result === "correct" ? "○" : r.result === "miss" ? "△ 찾지 못함" : "✕ 다른 법"} ${r.q}${r.got.length ? ` — 근거: ${r.got.join(", ")}` : ""}`).join("\n")}

## 처음 보는 일상 질문 · 블라인드 3차 — 문항별 결과(${covBlind3Live.once ? "실서비스" : "내장 데이터만"})

${((covBlind3Live.once as unknown as { rows?: CovRow[] })?.rows ?? coverage.blind3.rows).map((r) => `- ${r.result === "correct" ? "○" : r.result === "miss" ? "△ 찾지 못함" : "✕ 다른 법"} ${r.q}${r.got.length ? ` — 근거: ${r.got.join(", ")}` : ""}`).join("\n")}

## 처음 보는 일상 질문 · 블라인드 2차 — 문항별 결과(${covBlind2Live.once ? "실서비스" : "내장 데이터만"})

${((covBlind2Live.once as unknown as { rows?: CovRow[] })?.rows ?? coverage.blind2.rows).map((r) => `- ${r.result === "correct" ? "○" : r.result === "miss" ? "△ 찾지 못함" : "✕ 다른 법"} ${r.q}${r.got.length ? ` — 근거: ${r.got.join(", ")}` : ""}`).join("\n")}

## 블라인드 측정 이력(모두 공개)

${routing.history.map((h) => `- ${h.round}차(${h.author}): ${h.correct}/${h.total} (${pct(h.correct, h.total)}%) — ${h.note}`).join("\n")}

## 6차 블라인드에서 틀린 질문(고치지 않고 기록)

${b.misses.map((m) => `- ${m.q} — 기대: ${m.expected ?? "없음"} / 결과: ${m.got ?? "토픽 없음 → 실시간 전체 법령 검색"}`).join("\n")}

※ 블라인드 문항을 보고 규칙을 고치면 더 이상 블라인드가 아니므로, 개선 후에는 새 문항으로 다시 잰다. 개발자가 쓴 문항(1~3차)은 같은 작성자 편향이 있어, 독립 작성자(EXAONE 3.5) 문항(4~6차)을 주 지표로 삼는다. 목표 90%에 도달한 6차에서 반복을 멈췄으므로, 이 사실을 함께 고려해 해석한다.
`;
  fs.writeFileSync("submission/정확도_성적표.md", md);
  console.log(md);
}

main();
