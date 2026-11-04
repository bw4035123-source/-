import { NextResponse } from "next/server";
import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { resolveProvider } from "@/lib/llm/registry";
import { LLMError } from "@/lib/llm/types";
import { LawService } from "@/lib/law-api/client";
import { articleLabel } from "@/lib/law-api/util";
import { parseLooseJson } from "@/lib/answer/guard";
import { gatherEvidence } from "@/lib/answer/ask";
import { unverifiedQuantities } from "@/lib/answer/numbers";
import { maskPII } from "@/lib/privacy-mask";
import { guardAmend } from "@/lib/amend-ai";
import { QUICK_SYSTEM, buildQuickPrompt, limitWarning, quantityWarning, splitQuick } from "@/lib/amend-quick";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(5).max(6000), provider: z.string().max(20).optional() });
const noOf = (label: string) => label.replace(/\s/g, "").match(/^제\d+조(?:의\d+)?/)?.[0] ?? label.replace(/\s/g, "");
const lawRefs = (s: string) => Array.from(s.matchAll(/「([^」]{2,60})」/g), (m) => m[1].replace(/\s/g, ""));

/** 한 번에 개정: 조문 + "개정해줘" → AI 개정(가드) → 요약·개정 조문·대비표용 자료(lib/amend-quick.ts) */
export async function POST(req: Request) {
  const rl = rateLimit(`amend-quick:${clientKey(req)}`, 10);
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "개정할 조문을 붙여 넣고 ‘개정해줘’라고 적어 주세요." }, { status: 400 });
  const { request, articles } = splitQuick(maskPII(parsed.data.text).text);
  if (!articles.length) return NextResponse.json({ error: "개정할 조문을 찾지 못했어요. 조문을 붙여 넣어 주세요." }, { status: 400 });
  if (articles.length > 10) return NextResponse.json({ error: "한 번에 10개 조문까지 개정할 수 있어요." }, { status: 400 });
  const { provider } = resolveProvider(serverConfig.llm, parsed.data.provider);
  if (provider.kind === "rule") return NextResponse.json({ error: "생성형 AI가 연결되어 있지 않아요. 아래 ‘개정 방향’에 ‘A에서 B로’처럼 적어 규칙으로 개정하세요." }, { status: 503 });

  const svc = new LawService(serverConfig.lawAccess);
  // 조문마다 따로 상위 조문을 찾아(한 덩어리로 찾으면 한 주제만 남음) 조문당 2개씩, 모두 6개까지
  const qs = articles.slice(0, 4).map((a) => `${a.label.replace(/^제\d+조(?:의\d+)?/, "")} ${a.text}`.replace(/\s+/g, " ").slice(0, 300));
  type Ctx = Awaited<ReturnType<typeof gatherEvidence>>["context"];
  const found = await Promise.all(qs.map((q) => gatherEvidence(q, svc).then((r) => r.context, () => [] as Ctx)));
  const upper: { label: string; text: string }[] = [];
  for (const c of found.flatMap((ctx) => ctx.slice(0, articles.length > 1 ? 2 : 4))) {
    const label = `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`;
    if (upper.length < 6 && !upper.some((u) => u.label === label)) upper.push({ label, text: c.text });
  }

  try {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: buildQuickPrompt(request, articles, upper) }];
    let model = provider.model;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await provider.generate({ system: QUICK_SYSTEM, messages, json: true, temperature: 0.1, maxTokens: 3000, timeoutMs: 70000 });
      model = res.model || model;
      let raw: Record<string, unknown> = {};
      try {
        raw = parseLooseJson(res.text) as Record<string, unknown>;
      } catch {
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: "JSON 형식이 올바르지 않다. 지정한 형식의 JSON 객체 하나만 다시 출력하라." });
        continue;
      }
      const out: { label: string; current: string; amended: string; changes: string[]; warnings: string[] }[] = [];
      const rejected: { label: string; reason: string }[] = [];
      for (const it of Array.isArray(raw.articles) ? (raw.articles as Record<string, unknown>[]) : []) {
        const label = typeof it?.label === "string" ? it.label : "";
        const src = articles.find((a) => noOf(a.label) === noOf(label)) ?? (articles.length === 1 ? articles[0] : undefined);
        if (!src || out.some((o) => o.label === src.label)) continue;
        const g = guardAmend({ amended: it?.amended }, { lawName: "", kind: "", label: src.label, current: src.text, instruction: request, upper });
        const extra = g.ok ? [quantityWarning(request, src.text, g.text, upper), limitWarning(request, src.text, g.text)].filter((w): w is string => !!w) : [];
        if (g.ok) out.push({ label: src.label, current: src.text, amended: g.text, changes: g.changes, warnings: [...g.warnings, ...extra] });
        else if (g.reason !== "현행과 바뀐 내용이 없음") rejected.push({ label: src.label, reason: g.reason });
      }
      if (!out.length && rejected.length && attempt === 0) {
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: `방금 개정안이 검증에 걸렸다: ${rejected.map((r) => `${r.label} ${r.reason}`).join("; ")}\n절대 규칙을 지켜 같은 JSON 형식으로 다시 써라.` });
        continue;
      }
      // 요약 가드: 근거에 없는 수치·법령이 들어가면 바뀐 곳으로 결정적으로 작성
      let summary = typeof raw.summary === "string" ? raw.summary.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      const sources = [request, ...articles.map((a) => a.text), ...out.map((o) => o.amended), ...upper.map((u) => `${u.label} ${u.text}`)];
      const known = new Set(sources.flatMap(lawRefs));
      if (!summary || unverifiedQuantities([summary], sources).length || lawRefs(summary).some((n) => !known.has(n)))
        summary = out.length ? `${out.map((o) => `${o.label} ${o.changes.join("·")}`).join(", ")} — 공문서·법제 표준 문체에 맞게 정비함.` : "";
      return NextResponse.json({ request, summary, articles: out, rejected, unchanged: articles.length - out.length - rejected.length, upper: upper.map((u) => u.label), label: provider.label, model });
    }
    return NextResponse.json({ error: `AI(${provider.label})가 쓴 개정안이 검증을 통과하지 못했어요. 개정 내용을 구체적으로 적어 다시 요청하세요.` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof LLMError ? `AI(${provider.label})에 연결하지 못했어요. 잠시 후 다시 시도하세요.` : "개정 중 오류가 났어요.", detail: (e as Error).message }, { status: 502 });
  }
}
