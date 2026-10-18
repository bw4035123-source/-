"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCopy, FileDown, FilePenLine, FileText, FileUp, Info, Loader2, ScanSearch, ShieldCheck, X } from "lucide-react";
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
  regArticleLabel,
  type ArticleResult,
  type BasisRef,
  type CheckReport,
  type OrgType,
  type Severity,
} from "@/lib/compliance";
import { diffWords } from "@/lib/drafting";
import { ACCEPT, ExtractError, extractText, type Extracted } from "@/lib/doc-extract";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { LawViewerSheet } from "@/components/law-search/law-viewer-sheet";
import { copyText } from "@/lib/clipboard";
import { downloadWord, escapeHtml } from "@/lib/word-export";
import { cn } from "@/lib/utils";

const TONE: Record<Severity, string> = {
  conflict: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  review: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  info: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};
const ICON: Record<Severity, React.ElementType> = { conflict: AlertTriangle, review: Info, ok: CheckCircle2, info: Info };

type LawState = { status: "loading" | "ready" | "error"; docs: Map<string, LawDoc> };

/** 사규·내규 ↔ 상위법령 교차 검증 */
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

  const run = () => {
    if (!text.trim()) return;
    setReport(crossCheck({ text, orgType, regName, laws: Array.from(laws.docs.values()) }));
    setFilter("all");
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

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileError("");
    setExtracting(f.name);
    try {
      const info = await extractText(f);
      setText(info.text);
      setRegName((v) => v || f.name.replace(/\.[^.]+$/, ""));
      setReport(null);
      const articles = (info.text.match(/^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?/gm) ?? []).length;
      setLoaded({ name: f.name, info, articles });
      toast(`${info.format} 문서에서 ${articles ? `${articles}개 조문을` : "내용을"} 불러왔어요.`);
    } catch (e) {
      setLoaded(null);
      setFileError(e instanceof ExtractError ? e.message : "문서를 읽지 못했어요. 내용을 복사해 붙여 넣어 주세요.");
    } finally {
      setExtracting(null);
    }
  };

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

  const reportText = report ? complianceReport(report, lawName) : "";
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
      { title: "조문별 대조표", html: `<table border="1" cellspacing="0" cellpadding="4"><tr><th>내규 조문</th><th>판정</th><th>검토 내용·근거</th><th>개정안</th></tr>${rows}</table>` },
    ]);
  };

  const shown = report?.results.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div className="container max-w-6xl py-8">
      <header className="mb-6">
        <p className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-bold text-accent">공직자 실무</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
          <ScanSearch className="h-7 w-7 text-accent" /> 사규·내규 교차 검증
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">기관의 사규·내규 파일(한글·PDF·Word)을 끌어다 놓거나 붙여 넣으면 근로기준법·청탁금지법·공직선거법·지방공기업법·공유재산법과 조문 단위로 대조해 상충·검토 필요 조항, 근거 조문, 개정안을 보여 드려요.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section {...dragProps} className={cn("space-y-4 rounded-2xl border bg-card p-5 shadow-sm transition", dragging && "border-accent ring-2 ring-accent/40")} aria-label="검증할 내규">
          <div className="grid gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              기관 유형
              <select value={orgType} onChange={(e) => setOrgType(e.target.value as OrgType)} className="h-10 rounded-md border bg-card px-2 text-sm font-normal text-foreground">
                {ORG_TYPES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              규정명
              <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="예) ○○공사 취업규칙, 임직원 행동강령" className="h-10 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground" />
            </label>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-bold">내규 원문</p>
            <div
              role="button"
              tabIndex={0}
              aria-label="내규 파일 올리기: 한글, PDF, Word, 텍스트 파일을 끌어다 놓거나 눌러서 선택"
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
                  <p className="text-[11px] text-muted-foreground">한글(HWP·HWPX) · PDF · Word(DOCX) · TXT — 파일은 서버로 보내지 않고 이 브라우저에서만 읽어요</p>
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
            <p className="pt-1">판정은 정해진 기준과 조문 원문으로만 하며 AI 생성 문장으로 위반을 단정하지 않습니다. 최종 판단은 소관 부처 해석을 확인하세요.</p>
          </div>
        </section>

        <section id="compliance-result" className="min-w-0 space-y-4" aria-label="교차 검증 결과" aria-live="polite">
          {!report ? (
            <div className="grid h-full min-h-[320px] place-items-center rounded-2xl border border-dashed bg-card/60 p-8 text-center text-sm text-muted-foreground">
              <div>
                <ScanSearch className="mx-auto h-10 w-10 text-accent/60" />
                <p className="mt-3 font-semibold text-foreground">내규를 붙여 넣거나 예시를 고른 뒤 교차 검증을 눌러 주세요.</p>
                <p className="mt-1">근로시간·연차·가산수당, 금품 수수 한도, 선거운동, 임원 임기, 사용허가·대부기간, 인용 조문의 현행 여부를 점검합니다.</p>
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
                        <span className="text-xl font-black">{report.counts[s]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {shown.map((r) => (
                <ArticleCard key={r.article.no + r.article.title} r={r} lawName={lawName} citationOf={citationOf} onOpen={setViewing} onCopy={copy} />
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
  lawName,
  citationOf,
  onOpen,
  onCopy,
}: {
  r: ArticleResult;
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
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold", TONE[r.status])}>
          <I className="h-3.5 w-3.5" /> {SEVERITY_LABEL[r.status]}
        </span>
      </div>
      <p className="law-text mt-2 whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-sm leading-7">{r.article.text}</p>

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
      {!r.findings.length && !r.related.length && <p className="mt-3 text-xs text-muted-foreground">대조 법령에서 직접 관련된 기준을 찾지 못했어요(기관 자율 사항일 수 있음).</p>}

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
                <Link href="/drafting">
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
