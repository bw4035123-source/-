"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardCopy, FileDown, FilePenLine, Info, Loader2, Wand2 } from "lucide-react";
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
import { copyText } from "@/lib/clipboard";
import { downloadWord, escapeHtml } from "@/lib/word-export";
import { cn } from "@/lib/utils";

type Hier = { root: LawDoc; children: LawDoc[] };
const kindOf = (k?: string): DraftKind => (k === "행정규칙" ? "행정규칙" : k === "자치법규" ? "자치법규" : "법령");
const EXAMPLES = ["7일에서 5일로 단축", "‘행정기관의 장’을 ‘시장ㆍ군수ㆍ구청장’으로 변경", "‘다만,’ 이하 단서 문장을 삭제하려면 ‘삭제할 문장’ 삭제", "신설: ③ 제1항의 기간에는 공휴일과 토요일을 산입하지 아니한다."];

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

/** 규정 제·개정 지원: 개정 방향 → 개정안·신구조문대비표·정합성 점검·개정이유·부칙·입법예고문·절차를 한 번에 */
export function DraftingView() {
  const params = useSearchParams();
  const toast = useToast();
  const [source, setSource] = React.useState<"law" | "custom">("law");
  const [laws, setLaws] = React.useState<LawSummary[]>([]);
  const [lawId, setLawId] = React.useState(params.get("law") ?? "");
  const [hier, setHier] = React.useState<Hier | null>(null);
  const [loadingLaw, setLoadingLaw] = React.useState(false);
  const [no, setNo] = React.useState(params.get("no") ?? "");
  // 직접 입력(자체 규정·조례)
  const [custom, setCustom] = React.useState({ name: "", kind: "행정규칙" as DraftKind, label: "제1조(목적)", text: "" });
  const [instruction, setInstruction] = React.useState("");
  const [amended, setAmended] = React.useState("");
  const [applied, setApplied] = React.useState<Edit[]>([]);
  const [notFound, setNotFound] = React.useState<Edit[]>([]);
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
    : { kind: custom.kind, lawName: custom.name || "(규정명)", label: custom.label, current: custom.text };

  const current = meta.current;
  // 조문을 바꾸면 개정안 초기화
  React.useEffect(() => {
    setAmended(current);
    setApplied([]);
    setNotFound([]);
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

  const run = () => {
    const edits = parseInstruction(instruction);
    if (!edits.length) {
      toast("개정 방향에서 바꿀 표현을 찾지 못했어요. 예시처럼 적거나 개정안을 직접 고쳐 주세요");
      return;
    }
    const r = applyEdits(current, edits);
    setAmended(r.text);
    setApplied(r.applied);
    setNotFound(r.notFound);
    toast(`개정 사항 ${r.applied.length}건을 반영했어요`);
  };

  const ready = !!current.trim();
  const diff = React.useMemo(() => diffWords(current, amended), [current, amended]);
  const checks = React.useMemo(
    () => (ready ? consistencyChecks({ current, amended, lawArticleNos: source === "law" ? law?.articles.map((a) => a.no) : undefined, upper }) : []),
    [ready, current, amended, source, law, upper],
  );
  const dmeta = { kind: meta.kind, lawName: meta.lawName, articleLabel: meta.label, instruction, dept: dept || undefined, effectiveDays: days };
  const reason = reasonDraft(dmeta, applied);
  const docs = [
    { id: "reason", label: "개정이유·주요내용", body: reason },
    { id: "addenda", label: "부칙", body: addendaDraft(dmeta) },
    { id: "notice", label: "입법예고문", body: noticeDraft(dmeta, reason) },
    { id: "steps", label: "절차 체크리스트", body: procedureChecklist(meta.kind).map((s, i) => `□ ${i + 1}. ${s}`).join("\n") },
  ];
  const tableHtml = () => {
    const cell = (parts: DiffPart[], side: "old" | "new") =>
      parts.map((p) => (p.op === "same" ? escapeHtml(p.text) : side === "new" ? `<u>${escapeHtml(p.text)}</u>` : `<s>${escapeHtml(p.text)}</s>`)).join("");
    return `<table><tr><th>현 행</th><th>개 정 안</th></tr><tr><td>${escapeHtml(meta.label)}\n${cell(diff.old, "old")}</td><td>${escapeHtml(meta.label)}\n${cell(diff.new, "new")}</td></tr></table>`;
  };
  const exportAll = () =>
    downloadWord(`${meta.lawName} ${meta.label} 개정안`, [{ title: "신·구조문 대비표", html: tableHtml() }, ...docs.map((d) => ({ title: d.label, body: d.body }))]);

  const lawGroups = laws.filter((l) => !l.parentId);

  return (
    <div className="container max-w-6xl py-8">
      <header className="mb-6">
        <p className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-bold text-accent">공직자 실무</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
          <FilePenLine className="h-7 w-7 text-accent" /> 규정 제·개정 지원
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">바꾸고 싶은 내용을 말하듯 적으면 개정안, 신·구조문 대비표, 상위법 정합성 점검, 개정이유·부칙·입법예고문 초안을 한 번에 만들어 드려요.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* 왼쪽: 입력 */}
        <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" aria-label="개정 대상과 방향">
          <div>
            <p className="mb-2 text-sm font-bold">① 개정 대상</p>
            <div className="mb-3 flex gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold">
              {(["law", "custom"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSource(s)} className={cn("flex-1 rounded-md px-3 py-1.5", source === s ? "bg-card shadow-sm" : "text-muted-foreground")} aria-pressed={source === s}>
                  {s === "law" ? "법령에서 선택" : "직접 입력(자체 규정·조례)"}
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
              <div className="grid gap-2">
                <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="규정명 (예: ○○시 민원 처리 규정)" className="h-10 rounded-md border bg-card px-2.5 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value as DraftKind })} className="h-10 rounded-md border bg-card px-2 text-sm" aria-label="규범 종류">
                    <option value="행정규칙">훈령·예규·내부 규정</option>
                    <option value="자치법규">조례·규칙(자치법규)</option>
                    <option value="법령">법령</option>
                  </select>
                  <input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="제5조(처리기간)" className="h-10 rounded-md border bg-card px-2.5 text-sm" />
                </div>
                <textarea value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} rows={6} placeholder="현행 조문을 붙여 넣으세요" className="rounded-md border bg-card p-2.5 text-sm leading-6" />
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">② 개정 방향</p>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="예) 처리기간을 7일에서 5일로 단축 / ‘민원인’을 ‘신청인’으로 변경 / 신설: ③ …"
              className="w-full rounded-md border bg-card p-2.5 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setInstruction((v) => (v ? `${v}\n${x}` : x))} className="rounded-full border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
                  + {x.length > 22 ? `${x.slice(0, 22)}…` : x}
                </button>
              ))}
            </div>
          </div>

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

          <Button variant="accent" size="lg" className="w-full" onClick={run} disabled={!ready || !instruction.trim()}>
            <Wand2 /> 개정안 작성
          </Button>
          {(applied.length > 0 || notFound.length > 0) && (
            <div className="space-y-1 text-xs">
              {applied.map((e, i) => (
                <p key={i} className="text-emerald-700 dark:text-emerald-400">✓ {e.type === "replace" ? `‘${e.from}’ → ‘${e.to}’` : e.type === "delete" ? `‘${e.from}’ 삭제` : "항 신설"}</p>
              ))}
              {notFound.map((e, i) => (
                <p key={i} className="text-amber-700 dark:text-amber-300">△ 현행 조문에서 ‘{e.from}’을(를) 찾지 못했어요 — 개정안을 직접 고쳐 주세요</p>
              ))}
            </div>
          )}
        </section>

        {/* 오른쪽: 결과 */}
        <section className="min-w-0 space-y-5" aria-label="개정안과 검토 결과">
          {!ready ? (
            <div className="grid h-full min-h-[300px] place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {loadingLaw ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> 법령을 불러오는 중…
                </span>
              ) : (
                "왼쪽에서 개정할 조문을 선택하거나 직접 입력하세요."
              )}
            </div>
          ) : (
            <>
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-extrabold">신·구조문 대비표</h2>
                  <span className="text-xs text-muted-foreground">
                    <del className="bg-rose-100 px-1 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">삭제</del> · <ins className="bg-sky-100 px-1 font-bold text-sky-900 underline dark:bg-sky-900/40 dark:text-sky-100">개정(밑줄)</ins>
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-secondary/50 p-3">
                    <p className="mb-1 text-xs font-bold text-muted-foreground">현 행 · {meta.label}</p>
                    <DiffText parts={diff.old} side="old" />
                  </div>
                  <div className="rounded-xl bg-sky-50/60 p-3 dark:bg-sky-900/10">
                    <p className="mb-1 text-xs font-bold text-muted-foreground">개 정 안 · {meta.label}</p>
                    <DiffText parts={diff.new} side="new" />
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">개정안 직접 고치기</summary>
                  <textarea value={amended} onChange={(e) => setAmended(e.target.value)} rows={8} className="mt-2 w-full rounded-md border bg-card p-3 font-serif text-sm leading-7" aria-label="개정안 직접 수정" />
                </details>
              </div>

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
                  <h2 className="font-extrabold">제·개정 문서 초안</h2>
                  <Button size="sm" variant="accent" onClick={exportAll}>
                    <FileDown /> 대비표 포함 전체 Word 저장
                  </Button>
                </div>
                <Tabs defaultValue="reason">
                  <TabsList>
                    {docs.map((d) => (
                      <TabsTrigger key={d.id} value={d.id}>
                        {d.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {docs.map((d) => (
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
    </div>
  );
}
