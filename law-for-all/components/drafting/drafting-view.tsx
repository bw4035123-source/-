"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardCopy, FileDown, FilePenLine, Info, Loader2, Sparkles, Table2, Wand2 } from "lucide-react";
import type { LawArticle, LawDoc, LawSummary } from "@/lib/law-api/types";
import { articleLabel } from "@/lib/law-api/util";
import {
  addendaDraft,
  applyEdits,
  consistencyChecks,
  diffWords,
  noticeDraft,
  parseInstruction,
  procedureChecklist,
  reasonDraft,
  type DiffPart,
  type DraftKind,
  type Edit,
  type UpperArticle,
} from "@/lib/drafting";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { copyRich, copyText } from "@/lib/clipboard";
import { downloadWord, escapeHtml } from "@/lib/word-export";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { EnactPanel } from "./enact-panel";
import { RegReportPack } from "./reg-report-pack";
import { amendDocs } from "@/lib/reg-report";
import { RenumberPanel } from "./renumber-panel";
import { UpperPanel, type AmendHandoff } from "./upper-panel";

type Hier = { root: LawDoc; children: LawDoc[] };
const kindOf = (k?: string): DraftKind => (k === "행정규칙" ? "행정규칙" : k === "자치법규" ? "자치법규" : "법령");
/** 개정 방향 입력 틀 — 누르면 ② 칸에 틀이 들어가고 O 자리만 고쳐 쓰면 됨 */
const TEMPLATES = [
  { label: "단어·기한 변경", text: "제O항의 'OO'을 'OO'(으)로 변경" },
  { label: "단서·항목 신설", text: "제O항 뒤에 '다만, ~' 단서 추가" },
  { label: "조항 삭제", text: "제O조 제O항 삭제 및 번호 순차 이동" },
  { label: "용어 정비", text: "법제처 알기 쉬운 법령 기준에 맞게 용어 정비" },
];
const EXAMPLE_TEXT = "제5조(처리기간) ① 민원은 접수한 날부터 7일 이내에 처리하여야 한다.\n② 부득이한 사유로 제1항의 기간 내에 처리할 수 없는 경우에는 한 차례만 연장할 수 있다.";
const EXAMPLE_INSTRUCTION = "7일을 5일로 단축";
/** 오른쪽 패널 처음 화면(결과물 예시) */
const SAMPLE = {
  label: "제5조(처리기간)",
  current: "① 민원은 접수한 날부터 7일 이내에 처리하여야 한다.\n② 부득이한 사유로 제1항의 기간 내에 처리할 수 없는 경우에는 한 차례만 연장할 수 있다.",
  amended: "① 민원은 접수한 날부터 5일 이내에 처리하여야 한다.\n② 부득이한 사유로 제1항의 기간 내에 처리할 수 없는 경우에는 한 차례만 연장할 수 있다.",
  reason: "1. 개정이유\n민원 처리기간을 단축하여 민원인의 편의를 높이고 신속한 행정서비스를 제공하려는 것임.\n\n2. 주요내용\n가. 민원 처리기간을 접수한 날부터 7일 이내에서 5일 이내로 단축함(안 제5조제1항).",
};
const HEAD = /^\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?)\s*/;
const normHead = (h: string) => h.replace(/\s/g, "").replace(/\(/, "(");

/** 신·구조문 대비표 HTML(복사·Word 공용) */
function diffTableHtml(label: string, d: { old: DiffPart[]; new: DiffPart[] }) {
  const cell = (parts: DiffPart[], side: "old" | "new") =>
    parts.map((p) => (p.op === "same" ? escapeHtml(p.text) : side === "new" ? `<u><b>${escapeHtml(p.text)}</b></u>` : `<s>${escapeHtml(p.text)}</s>`)).join("").replace(/\n/g, "<br>");
  const head = label ? `${escapeHtml(label)}<br>` : "";
  return `<table border="1" cellspacing="0" cellpadding="6"><tr><th>현 행</th><th>개 정 안</th></tr><tr><td valign="top">${head}${cell(d.old, "old")}</td><td valign="top">${head}${cell(d.new, "new")}</td></tr></table>`;
}

/** 결과 탭: 신·구조문 대비표 / 개정문 전문 / 개정이유 */
function ResultTabs({ label, current, amended, reason, sample }: { label: string; current: string; amended: string; reason: string; sample?: boolean }) {
  const toast = useToast();
  const d = React.useMemo(() => diffWords(current, amended), [current, amended]);
  const full = `${label ? `${label} ` : ""}${amended}`;
  const copyTable = async () => {
    const text = `현행\t개정안\n${label} ${current.replace(/\n/g, " ")}\t${label} ${amended.replace(/\n/g, " ")}`;
    toast((await copyRich(diffTableHtml(label, d), text)) ? "대비표를 복사했어요 — 한글·Word에 붙이면 표로 들어가요" : "복사 실패");
  };
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      {sample && (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/50 bg-accent/5 px-2.5 py-0.5 text-[11px] font-bold text-accent">결과물 예시 화면 — 왼쪽에서 생성하면 이 자리에 실제 결과가 나와요</p>
      )}
      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">신·구조문 대비표</TabsTrigger>
          <TabsTrigger value="full">개정문 전문</TabsTrigger>
          <TabsTrigger value="reason">개정이유</TabsTrigger>
        </TabsList>
        <TabsContent value="table" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              <del className="bg-rose-100 px-1 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">삭제</del> · <ins className="bg-sky-100 px-1 font-bold text-sky-900 underline dark:bg-sky-900/40 dark:text-sky-100">개정(밑줄)</ins>
            </span>
            <Button size="sm" variant="outline" onClick={copyTable}>
              <Table2 /> 표 복사
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-secondary/70">
                  <th className="w-1/2 border px-3 py-2 text-center font-bold">현 행</th>
                  <th className="w-1/2 border px-3 py-2 text-center font-bold">개 정 안</th>
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  <td className="border px-3 py-2">
                    {label && <p className="text-sm font-bold">{label}</p>}
                    <DiffText parts={d.old} side="old" />
                  </td>
                  <td className="border bg-sky-50/40 px-3 py-2 dark:bg-sky-900/10">
                    {label && <p className="text-sm font-bold">{label}</p>}
                    <DiffText parts={d.new} side="new" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="full" className="space-y-2">
          <pre className="law-text whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 font-serif text-sm leading-7">{full}</pre>
          <Button size="sm" variant="outline" onClick={async () => toast((await copyText(full)) ? "개정문 전문을 복사했어요" : "복사 실패")}>
            <ClipboardCopy /> 복사
          </Button>
        </TabsContent>
        <TabsContent value="reason" className="space-y-2">
          <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 text-sm leading-7">{reason}</pre>
          <Button size="sm" variant="outline" onClick={async () => toast((await copyText(reason)) ? "개정이유를 복사했어요" : "복사 실패")}>
            <ClipboardCopy /> 복사
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DiffText({ parts, side }: { parts: DiffPart[]; side: "old" | "new" }) {
  return (
    <p className="law-text whitespace-pre-wrap text-sm leading-7">
      {parts.map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.text}</span>
        ) : side === "old" ? (
          <del key={i} className="rounded bg-rose-100 text-rose-800 decoration-rose-600 dark:bg-rose-900/40 dark:text-rose-200">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded bg-sky-100 font-bold text-sky-900 underline decoration-2 underline-offset-4 dark:bg-sky-900/40 dark:text-sky-100">
            {p.text}
          </ins>
        ),
      )}
    </p>
  );
}

/** 규정 제·개정 지원: (개정) 개정 방향 → 개정안·신구조문대비표·정합성 점검·개정이유·부칙·입법예고문·절차 / (제정) 목적·위임 조항 → 조문 체계·제정안 */
export function DraftingView() {
  const params = useSearchParams();
  const toast = useToast();
  const qm = params.get("mode");
  // 제정이 먼저(기본) — 법령 뷰어의 '개정안 작성'처럼 조문을 넘겨받으면 개정
  const [mode, setMode] = React.useState<"amend" | "enact" | "renumber" | "upper">(qm === "amend" || qm === "renumber" || qm === "upper" || qm === "enact" ? qm : params.get("law") && params.get("no") ? "amend" : "enact");
  const [source, setSource] = React.useState<"law" | "custom">(params.get("law") && params.get("no") ? "law" : "custom");
  const [laws, setLaws] = React.useState<LawSummary[]>([]);
  const [lawId, setLawId] = React.useState(params.get("law") ?? "");
  const [hier, setHier] = React.useState<Hier | null>(null);
  const [loadingLaw, setLoadingLaw] = React.useState(false);
  const [no, setNo] = React.useState(params.get("no") ?? "");
  // 직접 입력(자체 규정·조례)
  const [custom, setCustom] = React.useState({ name: "", kind: "행정규칙" as DraftKind, label: "", text: "" });
  // 결과는 '생성'을 누른 조문에서만 보여 줌(그 전에는 결과물 예시)
  const [ranFor, setRanFor] = React.useState<string | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [amended, setAmended] = React.useState("");
  const [applied, setApplied] = React.useState<Edit[]>([]);
  const [notFound, setNotFound] = React.useState<Edit[]>([]);
  // 규칙(문형)으로 반영하지 못한 개정 방향 → 생성형 AI가 쓴 개정안(가드 검증 통과분만)
  type AiAmend = { loading?: boolean; changes?: string[]; warnings?: string[]; label?: string; model?: string; retried?: boolean; failed?: string; text?: string };
  const [ai, setAi] = React.useState<AiAmend | null>(null);
  const [dept, setDept] = React.useState("");
  const [days, setDays] = React.useState(0);

  React.useEffect(() => {
    fetch("/api/laws")
      .then((r) => r.json())
      .then((j) => setLaws((j.laws ?? []).filter((l: LawSummary) => !l.id.startsWith("mst-"))))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!lawId) return setHier(null);
    setLoadingLaw(true);
    fetch(`/api/laws/${encodeURIComponent(lawId)}`)
      .then((r) => r.json())
      .then((j) => setHier(j.root ? j : null))
      .catch(() => setHier(null))
      .finally(() => setLoadingLaw(false));
  }, [lawId]);

  const all = hier ? [hier.root, ...hier.children] : [];
  const law = all.find((l) => l.id === lawId) ?? null;
  const article: LawArticle | undefined = law?.articles.find((a) => a.no === no);

  const meta = source === "law"
    ? { kind: kindOf(law?.kind === "법률" || law?.kind === "대통령령" || law?.kind?.includes("부령") ? "법령" : law?.kind), lawName: law?.name ?? "", label: article ? `${articleLabel(article.no)}(${article.title})` : "", current: article?.text ?? "" }
    : (() => {
        // 붙여 넣은 원문 첫머리의 '제N조(제목)'을 조 머리로 떼어 씀(상위법 개정 반영에서 넘어온 조문은 label 이 따로 있음)
        const m = custom.text.match(HEAD);
        return { kind: custom.kind, lawName: custom.name || "○○ 규정", label: m ? normHead(m[1]) : custom.label, current: m ? custom.text.slice(m[0].length).trim() : custom.text.trim() };
      })();

  const current = meta.current;
  // 조문을 바꾸면 개정안 초기화
  React.useEffect(() => {
    setAmended(current);
    setApplied([]);
    setNotFound([]);
    setAi(null);
  }, [current]);

  const upper: UpperArticle[] = React.useMemo(() => {
    if (source !== "law" || !article) return [];
    const out: UpperArticle[] = [];
    for (const l of all)
      for (const a of l.articles)
        if (a.delegates?.some((d) => d.lawId === lawId && d.articleNo === article.no) || (l.id !== lawId && article.delegates?.some((d) => d.lawId === l.id && d.articleNo === a.no)))
          out.push({ label: `「${l.name}」 ${articleLabel(a.no)}`, text: a.text });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, article, hier, lawId]);

  // 상위법 개정 반영 → 우리 규정 조문과 개정 방향을 채워 개정 화면으로
  const [upperCtx, setUpperCtx] = React.useState<{ key: string; notes: string[]; basis: string } | null>(null);
  const handoff = (h: AmendHandoff) => {
    setUpperCtx({ key: h.text, notes: h.notes, basis: h.basis });
    setSource("custom");
    setCustom({ name: h.name, kind: "행정규칙", label: h.label, text: h.text });
    setInstruction(h.instruction);
    setMode("amend");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast(h.instruction ? "개정 방향을 채웠어요 — ‘개정안 작성’을 누르세요" : "조문을 옮겼어요 — 개정 방향을 적어 주세요");
  };

  const run = async () => {
    setRanFor(current);
    const edits = parseInstruction(instruction);
    const r = applyEdits(current, edits);
    setAmended(r.text);
    setApplied(r.applied);
    setNotFound(r.notFound);
    setAi(null);
    // 문형으로 알아듣지 못한 줄(또는 현행에서 찾지 못한 표현)이 있으면 그 부분만 생성형 AI에 맡김
    const leftover = instruction.split("\n").map((x) => x.trim()).filter((x) => x && !parseInstruction(x).length);
    if (!leftover.length && !r.notFound.length) {
      toast(`개정 사항 ${r.applied.length}건을 반영했어요`);
      return;
    }
    setAi({ loading: true });
    try {
      const j = await fetchJson<{ ok: boolean; text?: string; changes?: string[]; warnings?: string[]; reason?: string; retried?: boolean; model: string; label: string }>("/api/amend-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lawName: meta.lawName, kind: meta.kind, label: meta.label, current: r.text, original: current, instruction, upper: upper.slice(0, 6) }),
        timeoutMs: 75000,
      });
      if (j.ok && j.text) {
        setAmended(j.text);
        setAi({ changes: j.changes, warnings: j.warnings, label: j.label, model: j.model, retried: j.retried, text: j.text });
        toast("AI가 쓴 개정안이 검증을 통과했어요 — 내용을 꼭 확인하세요");
      } else {
        setAi({
          failed:
            j.reason === "현행과 바뀐 내용이 없음"
              ? `AI(${j.label})가 근거 없이 바꿀 내용을 정하지 않았어요. 따를 기준(예: 상위 규정의 금액·기간)을 개정 방향에 구체적으로 적거나, 개정안을 직접 고쳐 주세요.`
              : `AI(${j.label})가 쓴 개정안이 검증을 통과하지 못해 쓰지 않았어요(${j.reason ?? "검증 실패"}). 개정안을 직접 고쳐 주세요.`,
        });
      }
    } catch (e) {
      setAi({ failed: `${(e as Error).message} ${r.applied.length ? `규칙으로 반영한 ${r.applied.length}건만 적용했어요.` : ""}`.trim() });
    }
  };

  const ready = !!current.trim();
  const diff = React.useMemo(() => diffWords(current, amended), [current, amended]);
  // 상위법 개정 반영에서 넘어온 조문이면(그 뒤 조문을 바꾸지 않았을 때만) 확인 사항·개정 근거를 이어 씀
  const fromUpper = upperCtx && source === "custom" && upperCtx.key === current ? upperCtx : null;
  const checks = React.useMemo(() => {
    if (!ready) return [];
    const base = consistencyChecks({ current, amended, lawArticleNos: source === "law" ? law?.articles.map((a) => a.no) : undefined, upper });
    if (!fromUpper?.notes.length) return base;
    const extra = fromUpper.notes.map((n) => ({ level: "warn" as const, title: "상위법 개정 — 확인 필요", detail: n }));
    // 확인할 사항이 있으므로 '자동 점검 이상 없음'은 빼고
    return [...extra, ...base.filter((c) => c.level !== "ok")];
  }, [ready, current, amended, source, law, upper, fromUpper]);
  const dmeta = { kind: meta.kind, lawName: meta.lawName, articleLabel: meta.label, instruction, dept: dept || undefined, effectiveDays: days, upperBasis: fromUpper?.basis };
  const reason = reasonDraft(dmeta, applied, ai?.text && ai.text === amended ? ai.changes ?? [] : []);
  const docs = [
    { id: "reason", label: "개정이유·주요내용", body: reason },
    { id: "addenda", label: "부칙", body: addendaDraft(dmeta) },
    { id: "notice", label: "입법예고문", body: noticeDraft(dmeta, reason) },
    { id: "steps", label: "절차 체크리스트", body: procedureChecklist(meta.kind).map((s, i) => `□ ${i + 1}. ${s}`).join("\n") },
  ];
  const buildReport = (o: Parameters<typeof amendDocs>[1]) =>
    amendDocs({ lawName: meta.lawName, kind: meta.kind, label: meta.label, current, amended, reason, addenda: addendaDraft(dmeta), checks, effectiveDays: days, upperBasis: fromUpper?.basis }, o);
  const exportAll = () =>
    downloadWord(`${meta.lawName} ${meta.label} 개정안`, [{ title: "신·구조문 대비표", html: diffTableHtml(meta.label, diff) }, ...docs.map((d) => ({ title: d.label, body: d.body }))]);

  const lawGroups = laws.filter((l) => !l.parentId);

  return (
    <div className="container max-w-6xl py-8">
      <header className="mb-6">
        <p className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-bold text-accent">공직자 실무</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
          <FilePenLine className="h-7 w-7 text-accent" /> 규정 제·개정 지원
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          {mode === "amend"
            ? "바꾸고 싶은 내용을 말하듯 적으면 개정안, 신·구조문 대비표, 상위법 정합성 점검, 개정이유·부칙·입법예고문 초안을 한 번에 만들어 드려요."
            : mode === "enact"
              ? "제정 목적과 상위법 위임 조항을 넣으면 조문 체계와 표준 조문 초안, 위임 사항 대조, 제정이유·입법예고문 초안을 만들어 드려요."
              : mode === "upper"
                ? "상위법이 개정되면 개정 전·후 조문을 나란히 보여 주고, 우리 규정에서 바뀌기 전 용어나 개정·삭제된 조문을 인용한 곳을 찾아 개정안으로 이어 드려요."
                : "조문을 새로 넣거나 삭제해 번호가 바뀔 때, 같은 규정 안에서 고쳐야 할 인용을 모두 찾고 정정한 전문을 만들어 드려요."}
        </p>
        <div className="mt-4 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold" role="tablist" aria-label="제정·개정 선택">
          {(["enact", "amend", "renumber", "upper"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-4 py-1.5", mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
              {m === "amend" ? "개정(조문 고치기)" : m === "enact" ? "제정(새 규정 만들기)" : m === "renumber" ? "조 번호 정리(인용 정정)" : "상위법 개정 반영"}
            </button>
          ))}
        </div>
      </header>

      {mode === "enact" ? (
        <EnactPanel laws={laws} initialOne={params.get("one") ?? undefined} />
      ) : mode === "renumber" ? (
        <RenumberPanel />
      ) : mode === "upper" ? (
        <UpperPanel onAmend={handoff} initialLaw={params.get("law") ?? undefined} />
      ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
        {/* 왼쪽: 입력 */}
        <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm" aria-label="개정 대상과 방향">
          <div>
            <p className="mb-2 text-sm font-bold">① 개정 대상</p>
            <div className="mb-3 flex gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold" role="tablist" aria-label="개정 대상 입력 방식">
              {(["custom", "law"] as const).map((s) => (
                <button key={s} type="button" role="tab" onClick={() => setSource(s)} className={cn("flex-1 rounded-md px-3 py-1.5", source === s ? "bg-card shadow-sm" : "text-muted-foreground")} aria-selected={source === s}>
                  {s === "law" ? "법령에서 선택" : "직접 입력"}
                </button>
              ))}
            </div>
            {source === "law" ? (
              <div className="space-y-2">
                <select value={lawId} onChange={(e) => { setLawId(e.target.value); setNo(""); }} className="h-10 w-full rounded-md border bg-card px-2 text-sm" aria-label="법령 선택">
                  <option value="">법령을 선택하세요</option>
                  {lawGroups.map((l) => (
                    <optgroup key={l.id} label={l.name}>
                      <option value={l.id}>{l.name}</option>
                      {laws.filter((c) => c.parentId === l.id).map((c) => (
                        <option key={c.id} value={c.id}>
                          └ {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <select value={no} onChange={(e) => setNo(e.target.value)} disabled={!law} className="h-10 w-full rounded-md border bg-card px-2 text-sm disabled:opacity-50" aria-label="조문 선택">
                  <option value="">{loadingLaw ? "불러오는 중…" : "조문을 선택하세요"}</option>
                  {law?.articles.map((a) => (
                    <option key={a.no} value={a.no}>
                      {articleLabel(a.no)}({a.title})
                    </option>
                  ))}
                </select>
                {law && <p className="text-xs text-muted-foreground">{law.kind} · {law.source === "live" ? "국가법령정보 실시간 원문" : "국가법령정보센터 원문 스냅샷"}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">현행 조문 원문</span>
                  <button type="button" onClick={() => { setCustom({ ...custom, label: "", text: EXAMPLE_TEXT }); setInstruction(EXAMPLE_INSTRUCTION); }} className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
                    예시 채우기
                  </button>
                </div>
                <textarea value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} rows={7} placeholder="기존 조문을 그대로 붙여넣으세요." className="w-full rounded-md border bg-card p-2.5 font-serif text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="현행 조문 원문" />
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-muted-foreground">규정명·규범 종류 (선택 — 개정이유·부칙에 들어가요)</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="○○시 민원 처리 규정" className="h-9 rounded-md border bg-card px-2.5 text-sm" aria-label="규정명" />
                    <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value as DraftKind })} className="h-9 rounded-md border bg-card px-2 text-sm" aria-label="규범 종류">
                      <option value="행정규칙">훈령·예규·내부 규정</option>
                      <option value="자치법규">조례·규칙(자치법규)</option>
                      <option value="법령">법령</option>
                    </select>
                  </div>
                </details>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">② 개정 방향</p>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="바꿀 내용을 적으세요. 예: 7일을 5일로 단축"
              className="w-full rounded-md border bg-card p-2.5 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="개정 방향"
            />
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="개정 방향 입력 틀">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" title={t.text} onClick={() => setInstruction((v) => (v.trim() ? `${v.replace(/\s+$/, "")}\n${t.text}` : t.text))} className="rounded-md border bg-secondary/60 px-2 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent">
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                소관 부서
                <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="○○과" className="h-9 rounded-md border bg-card px-2 text-sm font-normal text-foreground" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                시행 시기
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border bg-card px-2 text-sm font-normal text-foreground">
                  <option value={0}>공포한 날부터</option>
                  <option value={30}>공포 후 30일</option>
                  <option value={90}>공포 후 3개월</option>
                  <option value={180}>공포 후 6개월</option>
                </select>
              </label>
            </div>
            <Button variant="accent" size="lg" className="w-full" onClick={run} disabled={!ready || !instruction.trim() || !!ai?.loading}>
              {ai?.loading ? <Loader2 className="animate-spin" /> : <Wand2 />} {ai?.loading ? "AI가 개정 조문을 쓰는 중…" : "개정안 및 신·구조문대비표 생성"}
            </Button>
          </div>
          {(applied.length > 0 || notFound.length > 0) && (
            <div className="space-y-1 text-xs">
              {applied.map((e, i) => (
                <p key={i} className="text-emerald-700 dark:text-emerald-400">✓ {e.type === "replace" ? `‘${e.from}’ → ‘${e.to}’` : e.type === "delete" ? `‘${e.from}’ 삭제` : e.type === "deleteParagraph" ? `제${e.no}항 삭제(번호는 남기고 ‘삭제’ 표시)` : "항 신설"}</p>
              ))}
              {notFound.map((e, i) => (
                <p key={i} className="text-amber-700 dark:text-amber-300">△ 현행 조문에서 {e.type === "deleteParagraph" ? `제${e.no}항` : `‘${e.from}’`}을(를) 찾지 못했어요{ai ? "" : " — 개정안을 직접 고쳐 주세요"}</p>
              ))}
            </div>
          )}
        </section>

        {/* 오른쪽: 결과(생성 전에는 결과물 예시) */}
        <section className="min-w-0 space-y-5" aria-label="개정안과 검토 결과">
          {loadingLaw && source === "law" ? (
            <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 법령을 불러오는 중…
              </span>
            </div>
          ) : !ready || ranFor !== current ? (
            <ResultTabs sample label={SAMPLE.label} current={SAMPLE.current} amended={SAMPLE.amended} reason={SAMPLE.reason} />
          ) : (
            <>
              {ai && !ai.loading && (
                <div className={cn("rounded-2xl border p-4 text-sm", ai.failed ? "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100" : "border-sky-200 bg-sky-50 text-sky-950 dark:bg-sky-900/20 dark:text-sky-100")}>
                  {ai.failed ? (
                    <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {ai.failed}</p>
                  ) : (
                    <>
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        <Sparkles className="h-4 w-4" /> AI({ai.label}{ai.model ? ` · ${ai.model}` : ""})가 쓴 개정안 — 검증 통과 · 담당자 확인 필요
                        {ai.text !== amended && <Badge variant="outline">직접 고침</Badge>}
                      </p>
                      <p className="mt-1 text-xs opacity-90">
                        문형으로 알아듣지 못한 개정 방향을 AI가 조문으로 썼어요. 가드가 항 번호 체계, 지시에 없는 항 삭제, 현행·개정 방향·상위법에 없는 수치·법령 인용, 새 벌칙을 검사해 통과한 안만 보여 줍니다{ai.retried ? "(첫 안이 검증에 걸려 이유를 알려 다시 쓰게 함)" : ""}.
                      </p>
                      {!!ai.changes?.length && <p className="mt-1 text-xs font-semibold">바뀐 곳: {ai.changes.join(" · ")}</p>}
                      {ai.warnings?.map((w, i) => (
                        <p key={i} className="mt-1 flex gap-1.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}</p>
                      ))}
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3">
                <p className="text-sm font-semibold">개정안이 만들어졌어요 — 결재용 보고서·기안문·신·구조문대비표를 바로 만들 수 있어요.</p>
                <RegReportPack build={buildReport} label="개정 보고서 바로 만들기" />
              </div>
              <ResultTabs label={meta.label} current={current} amended={amended} reason={reason} />
              <details className="rounded-2xl border bg-card px-5 py-3 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold text-accent">개정안 직접 고치기</summary>
                <textarea value={amended} onChange={(e) => setAmended(e.target.value)} rows={8} className="mt-2 w-full rounded-md border bg-card p-3 font-serif text-sm leading-7" aria-label="개정안 직접 수정" />
              </details>

              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <h2 className="mb-3 font-extrabold">정합성 점검</h2>
                <ul className="space-y-2">
                  {checks.map((c, i) => {
                    const Icon = c.level === "warn" ? AlertTriangle : c.level === "ok" ? CheckCircle2 : Info;
                    return (
                      <li key={i} className={cn("flex gap-2 rounded-lg p-3 text-sm", c.level === "warn" ? "bg-amber-50 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100" : c.level === "ok" ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100" : "bg-secondary/60")}>
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                          <strong>{c.title}</strong> — {c.detail}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {upper.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold">위임 관계 조문 {upper.length}건(점검에 사용)</summary>
                    <ul className="mt-2 space-y-2">
                      {upper.map((u) => (
                        <li key={u.label} className="rounded-lg border-l-4 border-accent bg-secondary/50 p-3 text-xs leading-6">
                          <Badge variant="accent" className="mb-1">{u.label}</Badge>
                          <p className="whitespace-pre-line">{u.text}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-extrabold">부칙·입법예고문·절차</h2>
                  <Button size="sm" variant="outline" onClick={exportAll}>
                    <FileDown /> 대비표 포함 전체 Word 저장
                  </Button>
                </div>
                <Tabs defaultValue="addenda">
                  <TabsList>
                    {docs.filter((d) => d.id !== "reason").map((d) => (
                      <TabsTrigger key={d.id} value={d.id}>
                        {d.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {docs.filter((d) => d.id !== "reason").map((d) => (
                    <TabsContent key={d.id} value={d.id} className="space-y-2">
                      <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 text-sm leading-7">{d.body}</pre>
                      <Button size="sm" variant="outline" onClick={async () => toast((await copyText(d.body)) ? `${d.label}을(를) 복사했습니다` : "복사 실패")}>
                        <ClipboardCopy /> 복사
                      </Button>
                    </TabsContent>
                  ))}
                </Tabs>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">※ 자동 작성된 초안입니다. 법제 심사 기준, 상위법 위임 범위, 관계 부서 의견을 반영해 최종 확정하세요.</p>
              </div>
            </>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
