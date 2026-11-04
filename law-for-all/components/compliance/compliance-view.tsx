"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCopy, FileDown, FilePenLine, FileText, FileUp, History, Info, Loader2, ScanSearch, ShieldCheck, Sparkles, X } from "lucide-react";
import type { Citation, LawDoc } from "@/lib/law-api/types";
import { articleLabel, toCitation } from "@/lib/law-api/util";
import {
  ORG_TYPES,
  SAMPLE_REGULATIONS,
  SEVERITY_LABEL,
  TARGET_LAWS,
  amendedText,
  complianceReport,
  crossCheck,
  parseRegulation,
  regArticleLabel,
  type ArticleResult,
  type BasisRef,
  type CheckReport,
  type OrgType,
  type Severity,
} from "@/lib/compliance";
import { diffWords } from "@/lib/drafting";
import { mergeVerdict, type AiArticleResult, type AiVerdict } from "@/lib/compliance-ai";
import { maskPII } from "@/lib/privacy-mask";
import { ACCEPT, ExtractError, extractText, type Extracted } from "@/lib/doc-extract";
import { MOCK_FILES } from "@/lib/mock-files";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { LawViewerSheet } from "@/components/law-search/law-viewer-sheet";
import { copyText } from "@/lib/clipboard";
import { downloadWord, escapeHtml } from "@/lib/word-export";
import { cn } from "@/lib/utils";
import { complianceDocs, type CheckItem, type Verdict } from "@/lib/reg-report";
import { RegReportPack } from "@/components/drafting/reg-report-pack";

const TONE: Record<Severity, string> = {
  conflict: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  review: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  info: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};
const ICON: Record<Severity, React.ElementType> = { conflict: AlertTriangle, review: Info, ok: CheckCircle2, info: Info };

type LawState = { status: "loading" | "ready" | "error"; docs: Map<string, LawDoc> };

/** AI 검토 결과(조문별) — 근거 상위 조문은 국가법령정보에서 찾은 원문 */
type AiResult = AiArticleResult & { upper: Citation[] };
type AiState =
  | { status: "idle" }
  | { status: "loading"; count: number; byNo: Map<string, AiResult>; first: number }
  | { status: "error"; message: string }
  | { status: "done"; byNo: Map<string, AiResult>; label: string; model: string; elapsedMs: number; dropped: number; laws: number };
const AI_SEV: Record<AiVerdict, Severity> = { 상충: "conflict", "검토 필요": "review", 적합: "ok", "판단 보류": "info" };

/** 우리 기관 규정 ↔ 상위법령 교차 검증 */
export function ComplianceView() {
  const toast = useToast();
  const [orgType, setOrgType] = React.useState<OrgType>("공기업·준정부기관");
  const [regName, setRegName] = React.useState("");
  const [text, setText] = React.useState("");
  const [laws, setLaws] = React.useState<LawState>({ status: "loading", docs: new Map() });
  const [report, setReport] = React.useState<CheckReport | null>(null);
  const [filter, setFilter] = React.useState<Severity | "all">("all");
  const [viewing, setViewing] = React.useState<Citation | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [extracting, setExtracting] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState<{ name: string; info: Extracted; articles: number } | null>(null);
  const [fileError, setFileError] = React.useState("");
  const [autoRun, setAutoRun] = React.useState(false);
  const [ai, setAi] = React.useState<AiState>({ status: "idle" });

  // 대조할 상위법령 원문(실시간 연결 시 전체 조문, 아니면 공식 원문 스냅샷)
  React.useEffect(() => {
    let alive = true;
    Promise.all(
      TARGET_LAWS.map((l) =>
        fetchJson<{ root: LawDoc }>(`/api/laws/${l.id}`, { timeoutMs: 15000 })
          .then((h) => h.root)
          .catch(() => null),
      ),
    ).then((list) => {
      if (!alive) return;
      const docs = new Map(list.filter((x): x is LawDoc => !!x).map((d) => [d.id, d]));
      setLaws({ status: docs.size ? "ready" : "error", docs });
    });
    return () => {
      alive = false;
    };
  }, []);

  const lawName = (id: string) => laws.docs.get(id)?.name ?? TARGET_LAWS.find((l) => l.id === id)?.name ?? id;
  const citationOf = (b: BasisRef): Citation | null => {
    const law = laws.docs.get(b.lawId);
    const art = law?.articles.find((a) => a.no === b.articleNo);
    return law && art ? toCitation(law, art) : null;
  };

  // AI 검토: 조문마다 국가법령정보에서 상위 조문을 찾아 생성형 AI가 대조(서버) — 조문 텍스트만 보냄(개인정보는 먼저 가림)
  const runAi = async (src: string, name: string, org: OrgType, rule: CheckReport) => {
    // 기준 규칙이 이미 연결한 상위 조문(근거·관련)을 AI에게 먼저 넘김 — 조문 글 검색만으로는 엉뚱한 조문이 붙을 수 있어
    const hintsOf = (no: string) => {
      const r = rule.results.find((x) => x.article.no === no);
      return r ? Array.from(new Set([...r.findings.flatMap((f) => f.basis), ...r.related].map((b) => `${b.lawId}:${b.articleNo}`))).slice(0, 4) : [];
    };
    const arts = parseRegulation(src).slice(0, 40).map((a) => ({ no: a.no, title: a.title, text: maskPII(a.text).text.slice(0, 3000), hints: hintsOf(a.no) }));
    if (!arts.length) return;
    // 규칙이 상충·검토 필요로 본 조문을 먼저 검토해 결과를 먼저 붙이고, 나머지는 이어서
    const flagged = new Set(rule.results.filter((r) => r.status === "conflict" || r.status === "review").map((r) => r.article.no));
    const batches = [arts.filter((a) => flagged.has(a.no)), arts.filter((a) => !flagged.has(a.no))].filter((b) => b.length);
    const byNo = new Map<string, AiResult>();
    setAi({ status: "loading", count: arts.length, byNo: new Map(), first: batches[0].length });
    const started = Date.now();
    let label = "";
    let model = "";
    try {
      for (const b of batches) {
        const j = await fetchJson<{ articles: AiResult[]; label: string; model: string }>("/api/compliance-ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regName: name, orgType: org, articles: b }),
          timeoutMs: 150000,
        });
        for (const r of j.articles) byNo.set(r.no, r);
        label = j.label;
        model = j.model;
        setAi({ status: "loading", count: arts.length, byNo: new Map(byNo), first: batches[0].length });
      }
      const all = Array.from(byNo.values());
      setAi({ status: "done", byNo, label, model, elapsedMs: Date.now() - started, dropped: all.reduce((n, r) => n + r.dropped, 0), laws: new Set(all.flatMap((r) => r.upper.map((c) => c.lawId))).size });
    } catch (e) {
      // 먼저 받은 결과는 살림
      if (byNo.size) {
        const all = Array.from(byNo.values());
        setAi({ status: "done", byNo, label, model, elapsedMs: Date.now() - started, dropped: all.reduce((n, r) => n + r.dropped, 0), laws: new Set(all.flatMap((r) => r.upper.map((c) => c.lawId))).size });
        toast(`나머지 조문 AI 검토는 하지 못했어요(${(e as Error).message})`);
      } else setAi({ status: "error", message: (e as Error).message });
    }
  };

  const run = () => {
    if (!text.trim()) return;
    const rule = crossCheck({ text, orgType, regName, laws: Array.from(laws.docs.values()) });
    setReport(rule);
    setFilter("all");
    void runAi(text, regName, orgType, rule);
    requestAnimationFrame(() => document.getElementById("compliance-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const loadSample = (i: number) => {
    const s = SAMPLE_REGULATIONS[i];
    setOrgType(s.orgType);
    setRegName(s.name);
    setText(s.text);
    setReport(null);
    setLoaded(null);
    setFileError("");
  };

  const onFile = async (f: File | undefined): Promise<boolean> => {
    if (!f) return false;
    setFileError("");
    setExtracting(f.name);
    try {
      const info = await extractText(f);
      setText(info.text);
      setRegName((v) => v || f.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim());
      setReport(null);
      const articles = (info.text.match(/^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?/gm) ?? []).length;
      setLoaded({ name: f.name, info, articles });
      toast(`${info.format} 문서에서 ${articles ? `${articles}개 조문을` : "내용을"} 불러왔어요.`);
      return true;
    } catch (e) {
      setLoaded(null);
      setFileError(e instanceof ExtractError ? e.message : "문서를 읽지 못했어요. 내용을 복사해 붙여 넣어 주세요.");
      return false;
    } finally {
      setExtracting(null);
    }
  };

  // 모의데이터 원클릭: 실제 파일(HWPX·DOCX·PDF)을 그대로 읽어 들인 뒤 곧바로 교차 검증까지
  const loadMock = async (i: number) => {
    const m = MOCK_FILES[i];
    setOrgType(m.orgType);
    setRegName(m.label);
    setExtracting(m.file);
    try {
      const blob = await (await fetch(m.url)).blob();
      if (await onFile(new File([blob], m.file))) setAutoRun(true);
    } catch {
      setExtracting(null);
      setFileError("모의데이터 파일을 불러오지 못했어요. 아래 예시 버튼을 이용해 주세요.");
    }
  };
  React.useEffect(() => {
    if (!autoRun || laws.status === "loading" || !text.trim()) return;
    setAutoRun(false);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, laws.status, text]);

  // 화면 어디에 떨어뜨려도 받되, 입력 영역 위에서만 강조 표시
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void onFile(f);
    },
  };

  // 판정: AI 검토와 기준 규칙 중 더 엄격한 쪽(AI 판단 보류는 규칙 판정을 그대로).
  // 다만 규칙은 상충인데 AI가 같은 조문을 보고 적합으로 판단하면 어느 한쪽으로 단정하지 않고 '검토 필요(판단 다름)'로
  const merged = React.useMemo(() => {
    if (!report) return null;
    if (ai.status !== "done" && ai.status !== "loading") return report;
    const results: (ArticleResult & { disagree?: boolean })[] = report.results.map((r) => {
      const m = mergeVerdict(r.status, ai.byNo.get(r.article.no)?.verdict);
      return m.status === r.status && !m.disagree ? r : { ...r, status: m.status, disagree: m.disagree };
    });
    const counts: Record<Severity, number> = { conflict: 0, review: 0, ok: 0, info: 0 };
    for (const r of results) counts[r.status]++;
    return { ...report, results, counts };
  }, [report, ai]);
  const aiText =
    ai.status === "done" && report
      ? [
          "",
          `■ AI 검토(${ai.label}) — 조문마다 국가법령정보에서 찾은 상위 조문 원문과 대조, 근거·수치는 가드가 검증(참고 의견)`,
          ...report.results.flatMap((r) => {
            const a = ai.byNo.get(r.article.no);
            if (!a || !a.issues.length) return [];
            return [`  ○ ${regArticleLabel(r.article)} — ${a.verdict}`, ...a.issues.map((it) => `    - ${it.point}${it.suggestion ? ` → ${it.suggestion}` : ""} (근거: ${it.basis.map((k) => { const c = a.upper.find((u) => u.key === k); return c ? `「${c.lawName}」 ${articleLabel(c.articleNo)}` : k; }).join(", ")})`)];
          }),
        ].join("\n")
      : "";
  const reportText = merged ? complianceReport(merged, lawName) + aiText : "";
  const copy = async (t: string, msg: string) => toast((await copyText(t)) ? msg : "복사하지 못했습니다. 직접 선택해 복사해 주세요.");
  const saveWord = () => {
    if (!report) return;
    const rows = report.results
      .map((r) => {
        const fs = r.findings.filter((f) => f.severity !== "info");
        const items = fs.length ? fs.map((f) => `<b>[${SEVERITY_LABEL[f.severity]}]</b> ${escapeHtml(f.title)}<br/><small>근거: ${escapeHtml(f.basis.map((b) => `「${lawName(b.lawId)}」 ${articleLabel(b.articleNo)}`).join(", ") || "일반 원칙")}</small>`).join("<br/>") : "위반 신호 없음";
        const am = amendedText(r);
        return `<tr><td>${escapeHtml(regArticleLabel(r.article))}</td><td>${SEVERITY_LABEL[r.status]}</td><td>${items}</td><td>${am ? escapeHtml(am) : ""}</td></tr>`;
      })
      .join("");
    downloadWord(`${report.regName}_교차검증`, [
      { title: "교차 검증 결과 보고", body: reportText },
      { title: "조문별 대조표", html: `<table border="1" cellspacing="0" cellpadding="4"><tr><th>규정 조문</th><th>판정</th><th>검토 내용·근거</th><th>개정안</th></tr>${rows}</table>` },
    ]);
  };

  // 보고서 바로 만들기: 화면의 판정(규칙+AI 합친 것)·지적·근거·자동 개정안을 그대로 보고서 서식에
  const VERDICT: Record<Severity, Verdict> = { conflict: "상충", review: "검토 필요", ok: "적합", info: "판단 보류" };
  const buildReport = (o: Parameters<typeof complianceDocs>[1]) => {
    const rs = merged?.results ?? [];
    const laws = new Set<string>();
    const items: CheckItem[] = rs.map((r) => {
      const points: string[] = [];
      for (const f of r.findings.filter((f) => f.severity !== "info")) {
        const b = f.basis.map((x) => `「${lawName(x.lawId)}」 ${articleLabel(x.articleNo)}`);
        f.basis.forEach((x) => laws.add(lawName(x.lawId)));
        points.push(`${f.title}${b.length ? ` (근거: ${b.join(", ")})` : ""}`);
      }
      const a = ai.status === "done" || ai.status === "loading" ? ai.byNo.get(r.article.no) : undefined;
      for (const it of a?.issues ?? []) {
        const cited = it.basis.map((k) => a!.upper.find((u) => u.key === k)).filter((c): c is Citation => !!c);
        cited.forEach((c) => laws.add(c.lawName));
        const b = cited.map((c) => `「${c.lawName}」 ${articleLabel(c.articleNo)}`);
        // 보고서에는 첫 문장만(규칙 점검과 겹치는 긴 설명은 화면에서 확인)
        const first = (t: string) => (t.match(/^.+?(?:함|임|됨|음|다)\.(?=\s|$)/)?.[0] ?? t).trim();
        points.push(`${first(it.point)}${it.suggestion ? ` → ${first(it.suggestion)}` : ""}${b.length ? ` (근거: ${b.join(", ")})` : ""}`);
      }
      points.splice(4);
      const am = amendedText(r);
      return { label: regArticleLabel(r.article), verdict: VERDICT[r.status], points, current: r.article.text, amended: am || undefined };
    });
    return complianceDocs({ regName: merged?.regName ?? regName, orgType: merged?.orgType ?? orgType, items, laws: Array.from(laws), aiLabel: ai.status === "done" ? ai.label : undefined }, o);
  };

  const shown = merged?.results.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div className="container max-w-6xl py-8">
      <header className="mb-6">
        <p className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-bold text-accent">공직자 실무</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
          <ScanSearch className="h-7 w-7 text-accent" /> 자체규정 점검
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground sm:text-base">
          <span className="block">우리 기관 규정 파일(한글·PDF·Word)을 넣으면</span>
          <span className="block text-balance">상위법령과 대조해 <span className="whitespace-nowrap">상충·검토 필요 조항,</span> <span className="whitespace-nowrap">근거 조문, 개정안을</span> 보여 드려요.</span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section {...dragProps} className={cn("space-y-4 rounded-2xl border bg-card p-5 shadow-sm transition", dragging && "border-accent ring-2 ring-accent/40")} aria-label="검증할 기관 규정">
          <div className="grid grid-cols-1 gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
              기관 유형
              <select value={orgType} onChange={(e) => setOrgType(e.target.value as OrgType)} className="h-10 w-full min-w-0 rounded-md border bg-card px-2 text-sm font-normal text-foreground">
                {ORG_TYPES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
              규정명
              <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="예) ○○공사 취업규칙, 임직원 행동강령" className="h-10 w-full min-w-0 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground" />
            </label>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-bold">규정 원문</p>
            <div className="mb-2 rounded-xl border border-accent/40 bg-accent/5 p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-foreground">
                <ScanSearch className="h-3.5 w-3.5 text-accent" /> 모의데이터로 바로 체험 <span className="font-normal text-muted-foreground">— 누르면 파일 읽기부터 검증까지 한 번에</span>
              </p>
              <div className="grid grid-cols-1 gap-1">
                {MOCK_FILES.map((m, i) => (
                  <button key={m.url} type="button" disabled={!!extracting} onClick={() => void loadMock(i)} className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs font-semibold hover:border-accent hover:text-accent disabled:opacity-60">
                    <Badge variant="secondary" className="w-14 shrink-0 justify-center whitespace-nowrap px-0 text-[10px]">{m.format}</Badge>
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    <span className="shrink-0 text-[11px] text-accent">검증 ▶</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-label="규정 파일 올리기: 한글, PDF, Word 파일을 끌어다 놓거나 눌러서 선택"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileRef.current?.click())}
              className={cn(
                "mb-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragging ? "border-accent bg-accent/10" : "border-muted-foreground/30 bg-secondary/30 hover:border-accent hover:bg-accent/5",
              )}
            >
              {extracting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                  <p className="text-sm font-semibold">‘{extracting}’ 읽는 중…</p>
                </>
              ) : (
                <>
                  <FileUp className={cn("h-6 w-6", dragging ? "text-accent" : "text-muted-foreground")} />
                  <p className="text-sm font-semibold">{dragging ? "여기에 놓으세요" : "파일을 끌어다 놓거나 눌러서 선택"}</p>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    <span className="block font-semibold">한글(HWP·HWPX) · PDF · Word(DOCX)</span>
                    <span className="block">파일 원본은 서버로 보내지 않고 이 브라우저에서 읽어요(AI 검토에는 조문 글만, 개인정보는 가려서 보냄)</span>
                  </p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            {fileError && (
              <p role="alert" className="mb-2 flex items-start gap-1.5 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {fileError}
              </p>
            )}
            {loaded && !fileError && (
              <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border bg-secondary/40 p-2 text-xs">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate">{loaded.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{loaded.info.format}</Badge>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {loaded.articles ? `조문 ${loaded.articles}개` : "조문 표시 없음"}
                    {loaded.info.pages ? ` · ${loaded.info.pages}쪽` : ""} · {loaded.info.text.length.toLocaleString()}자 — 아래에서 고친 뒤 검증할 수 있어요
                  </p>
                  {loaded.info.warnings.map((w) => (
                    <p key={w} className="mt-0.5 text-amber-700 dark:text-amber-300">△ {w}</p>
                  ))}
                </div>
                <button type="button" onClick={() => setLoaded(null)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="불러온 파일 정보 닫기">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={"또는 여기에 직접 붙여 넣으세요.\n제1조(목적) …\n제2조(근로시간) ① …"}
              className="w-full rounded-md border bg-card p-2.5 font-mono text-[13px] leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SAMPLE_REGULATIONS.map((s, i) => (
                <button key={s.label} type="button" onClick={() => loadSample(i)} className="rounded-full border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
                  예시: {s.label}
                </button>
              ))}
            </div>
          </div>
          <Button variant="accent" size="lg" className="w-full" onClick={run} disabled={!text.trim() || laws.status === "loading"}>
            {laws.status === "loading" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} 상위법령과 교차 검증
          </Button>
          <div className="space-y-1 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
            <p className="font-bold text-foreground">대조 법령</p>
            {TARGET_LAWS.map((l) => {
              const d = laws.docs.get(l.id);
              return (
                <p key={l.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">「{l.name}」</span>
                  <span className="shrink-0">{laws.status === "loading" ? "불러오는 중…" : d ? (d.source === "live" ? `실시간 원문 · ${d.articles.length}개 조문` : `원문 스냅샷 · ${d.articles.length}개 조문`) : "불러오지 못함"}</span>
                </p>
              );
            })}
            <p className="pt-1"><b className="text-foreground">AI 검토:</b> 국산 AI(Solar)가 조문마다 국가법령정보(법제처 Open API)에서 전체 현행 법령을 검색해 찾은 상위 조문 원문과 대조합니다. 근거 조문·수치는 가드가 검증하고, 위 법령의 법정 기준 수치는 정해진 규칙으로도 함께 점검합니다. 최종 판단은 소관 부처 해석을 확인하세요.</p>
          </div>
        </section>

        <section id="compliance-result" className="min-w-0 scroll-mt-40 space-y-4" aria-label="교차 검증 결과" aria-live="polite">
          {!report ? (
            <div className="grid min-h-[320px] place-items-center rounded-2xl border border-dashed bg-card/60 p-8 text-center text-sm text-muted-foreground">
              <div>
                <ScanSearch className="mx-auto h-10 w-10 text-accent/60" />
                <p className="mt-3 font-semibold text-foreground">왼쪽 ‘모의데이터로 바로 체험’에서 검증 ▶을 누르거나, 규정 파일을 넣고 교차 검증을 눌러 주세요.</p>
                <p className="mt-1">AI가 조문마다 국가법령정보에서 상위 조문을 찾아 대조하고, 근로시간·연차·금품 한도·임원 임기·사용허가기간 같은 법정 기준과 인용 조문의 현행 여부는 규칙으로도 점검합니다.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">{report.orgType}</p>
                    <h2 className="text-lg font-extrabold">「{report.regName}」 교차 검증 결과</h2>
                    <p className="text-xs text-muted-foreground">
                      {report.results.length}개 조문 · 인용 조문 검증 {report.refsChecked}건 · {report.liveLaws.length ? `실시간 원문 ${report.liveLaws.length}개 법령` : "공식 원문 스냅샷 기준"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <RegReportPack build={buildReport} disabled={ai.status === "loading"} label={ai.status === "loading" ? "AI 확인 후 보고서" : "보고서 바로 만들기"} />
                    <Button size="sm" variant="outline" onClick={() => copy(reportText, "검토 보고서를 복사했어요.")}>
                      <ClipboardCopy /> 보고서 복사
                    </Button>
                    <Button size="sm" variant="outline" onClick={saveWord}>
                      <FileDown /> Word 저장
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="판정별 보기">
                  {(["conflict", "review", "ok", "info"] as Severity[]).map((s) => {
                    const I = ICON[s];
                    return (
                      <button key={s} type="button" role="tab" aria-selected={filter === s} onClick={() => setFilter(filter === s ? "all" : s)} className={cn("flex items-center justify-between rounded-xl border px-3 py-2 text-left transition", TONE[s], filter === s && "ring-2 ring-ring")}>
                        <span className="flex items-center gap-1.5 text-xs font-bold">
                          <I className="h-4 w-4" /> {SEVERITY_LABEL[s]}
                        </span>
                        <span className="text-xl font-black">{merged!.counts[s]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className={cn("mt-3 rounded-xl border px-3 py-2 text-xs leading-5", ai.status === "error" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100")}>
                  {ai.status === "loading" ? (
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {ai.byNo.size
                        ? `AI 검토 ${ai.byNo.size}/${ai.count}개 조문 완료 — 상충·검토 필요 조문을 먼저 확인했어요. 나머지 조문을 이어서 대조하는 중…`
                        : `AI(국산 Solar)가 상충·검토 필요 조문 ${ai.first}개부터 국가법령정보 상위 조문과 대조하는 중… — 아래는 먼저 나온 1차 자동 점검(기준 규칙) 결과예요`}
                    </p>
                  ) : ai.status === "done" ? (
                    <p className="flex items-start gap-1.5">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <b>AI 검토 완료({ai.label} · {(ai.elapsedMs / 1000).toFixed(0)}초)</b> — 조문마다 국가법령정보에서 찾은 {ai.laws}개 법령의 상위 조문 원문과 대조했어요. 판정은 AI 의견과 기준 규칙 중 더 엄격한 쪽이에요.
                        {ai.dropped > 0 && ` 근거 조문·수치가 확인되지 않은 AI 지적 ${ai.dropped}건은 가드가 버렸어요.`} AI 검토는 참고 의견이니 최종 판단은 담당자와 소관 부처 해석으로 확인하세요.
                      </span>
                    </p>
                  ) : ai.status === "error" ? (
                    <p className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> AI 검토를 하지 못했어요({ai.message}). 아래 기준 규칙 점검 결과를 참고하세요.
                    </p>
                  ) : null}
                </div>
                {report.amendedArticles > 0 && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <History className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <b>상위법 최근 개정 {report.amendedArticles}개 조문</b> — 근거·관련 상위 조문이 최근 1년 안에 개정됐어요. 규정이 개정 내용을 따라갔는지 확인하세요(판정은 바꾸지 않고 따로 알림).
                    </span>
                  </p>
                )}
              </div>

              {shown.map((r) => (
                <ArticleCard key={r.article.no + r.article.title} r={r} ai={ai.status === "done" || ai.status === "loading" ? ai.byNo.get(r.article.no) : undefined} aiPending={ai.status === "loading" && !ai.byNo.has(r.article.no)} aiLabel={ai.status === "done" ? ai.label : "업스테이지 Solar"} lawName={lawName} citationOf={citationOf} onOpen={setViewing} onCopy={copy} />
              ))}
              {!shown.length && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">해당 판정의 조문이 없어요.</p>}
            </>
          )}
        </section>
      </div>
      <LawViewerSheet citation={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </div>
  );
}

function ArticleCard({
  r,
  ai,
  aiPending,
  aiLabel,
  lawName,
  citationOf,
  onOpen,
  onCopy,
}: {
  r: ArticleResult;
  ai?: AiResult;
  aiPending?: boolean;
  aiLabel: string;
  lawName: (id: string) => string;
  citationOf: (b: BasisRef) => Citation | null;
  onOpen: (c: Citation) => void;
  onCopy: (t: string, msg: string) => void;
}) {
  const I = ICON[r.status];
  const amended = amendedText(r);
  const diff = amended ? diffWords(r.article.text, amended) : null;
  const chip = (b: BasisRef, i: number) => {
    const c = citationOf(b);
    const label = `「${lawName(b.lawId)}」 ${articleLabel(b.articleNo)}${c ? `(${c.title})` : ""}`;
    return c ? (
      <button key={i} type="button" onClick={() => onOpen(c)} className="rounded-md border bg-card px-2 py-0.5 text-[11px] font-semibold text-accent hover:border-accent hover:underline">
        {label}
      </button>
    ) : (
      <span key={i} className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
        {label}
      </span>
    );
  };
  return (
    <article className={cn("rounded-2xl border bg-card p-5 shadow-sm", r.status === "conflict" && "border-l-4 border-l-rose-500", r.status === "review" && "border-l-4 border-l-amber-500")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold">{regArticleLabel(r.article)}</h3>
        <span className="flex flex-wrap items-center gap-1.5">
          {aiPending && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100">
              <Loader2 className="h-3 w-3 animate-spin" /> 1차 자동 점검 · AI 확인 중
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold", TONE[r.status])}>
            <I className="h-3.5 w-3.5" /> {SEVERITY_LABEL[r.status]}
          </span>
        </span>
      </div>
      <p className="law-text mt-2 whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-sm leading-7">{r.article.text}</p>
      {(r as ArticleResult & { disagree?: boolean }).disagree && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>규칙과 AI 판단이 달라요</b> — 기준 규칙은 상충으로, AI는 같은 상위 조문을 보고 적합으로 판단했어요. 한쪽으로 단정하지 않고 <b>검토 필요</b>로 두었으니 아래 두 근거를 비교해 확인하세요.
          </span>
        </p>
      )}

      {ai && (
        <div className={cn("mt-3 rounded-xl border p-3", TONE[AI_SEV[ai.verdict]])}>
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
            <Sparkles className="h-4 w-4" /> AI 검토 · {ai.verdict}
            <span className="text-[11px] font-semibold opacity-75">({aiLabel} · 국가법령정보 상위 조문 대조 · 참고 의견)</span>
          </p>
          {ai.issues.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {ai.issues.map((it, i) => (
                <li key={i} className="text-[13px] leading-6">
                  <p>• {it.point}</p>
                  {it.suggestion && <p className="pl-3 opacity-90">→ {it.suggestion}</p>}
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-3">
                    {it.basis.map((k) => {
                      const c = ai.upper.find((u) => u.key === k);
                      return c ? (
                        <button key={k} type="button" onClick={() => onOpen(c)} className="rounded-md border bg-card px-2 py-0.5 text-[11px] font-semibold text-accent hover:border-accent hover:underline">
                          「{c.lawName}」 {articleLabel(c.articleNo)}({c.title})
                        </button>
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] leading-6 opacity-90">
              {ai.verdict === "적합" ? "찾은 상위 조문의 기준과 어긋나는 점을 찾지 못했어요." : ai.note ?? "관련 상위 조문을 찾지 못했거나 판단할 근거가 부족해요(기관 자율 사항일 수 있음)."}
            </p>
          )}
          {ai.verdict === "적합" && ai.upper.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold opacity-80">대조한 상위 조문</span>
              {ai.upper.slice(0, 3).map((c) => (
                <button key={c.key} type="button" onClick={() => onOpen(c)} className="rounded-md border bg-card px-2 py-0.5 font-semibold text-accent hover:border-accent hover:underline">
                  「{c.lawName}」 {articleLabel(c.articleNo)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {r.findings.length > 0 && (
        <ul className="mt-3 space-y-2">
          {r.findings.map((f, i) => {
            const FI = ICON[f.severity];
            return (
              <li key={i} className={cn("rounded-xl border p-3", TONE[f.severity])}>
                <p className="flex items-start gap-1.5 text-sm font-bold">
                  <FI className="mt-0.5 h-4 w-4 shrink-0" /> {f.title}
                </p>
                <p className="mt-1 text-[13px] leading-6 opacity-90">{f.detail}</p>
                {f.basis.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{f.basis.map(chip)}</div>}
              </li>
            );
          })}
        </ul>
      )}

      {r.related.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-semibold">관련 상위 조문</span>
          {r.related.map(chip)}
        </div>
      )}
      {r.upstreamAmended.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <History className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">상위법 개정 — 규정 정비 확인</span>
          {r.upstreamAmended.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {chip(b, i)}
              <span className="font-semibold">{b.date} 개정</span>
            </span>
          ))}
          <Link href={`/drafting?mode=upper&law=${encodeURIComponent(lawName(r.upstreamAmended[0].lawId))}`} className="ml-auto font-semibold text-accent hover:underline">
            개정 전후 비교 →
          </Link>
        </div>
      )}
      {!r.findings.length && !r.related.length && !ai && <p className="mt-3 text-xs text-muted-foreground">대조 법령에서 직접 관련된 기준을 찾지 못했어요(기관 자율 사항일 수 있음).</p>}

      {diff && amended && (
        <div className="mt-4 rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <FilePenLine className="h-4 w-4 text-accent" /> 개정안(상위법 기준 반영)
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => onCopy(`${regArticleLabel(r.article)} ${amended}`, "개정안을 복사했어요.")}>
                <ClipboardCopy /> 복사
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/drafting?mode=amend">
                  <FilePenLine /> 제·개정 지원
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Badge variant="outline" className="mb-1 text-[10px]">현행</Badge>
              <p className="law-text whitespace-pre-wrap text-sm leading-7">
                {diff.old.map((p, i) => (p.op === "same" ? <span key={i}>{p.text}</span> : <del key={i} className="rounded bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">{p.text}</del>))}
              </p>
            </div>
            <div>
              <Badge variant="secondary" className="mb-1 text-[10px]">개정안</Badge>
              <p className="law-text whitespace-pre-wrap text-sm leading-7">
                {diff.new.map((p, i) => (p.op === "same" ? <span key={i}>{p.text}</span> : <ins key={i} className="rounded bg-sky-100 font-bold text-sky-900 no-underline dark:bg-sky-900/40 dark:text-sky-100">{p.text}</ins>))}
              </p>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
