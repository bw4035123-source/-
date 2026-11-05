"use client";
import * as React from "react";
import { AlertTriangle, Loader2, PencilLine, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { diffWords, type DraftKind } from "@/lib/drafting";
import { batchAmendDocs, changeSummary, oldNewTableHtml, type Verdict } from "@/lib/reg-report";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { DocSaveButtons } from "@/components/ui/doc-save";
import { RegReportPack } from "@/components/drafting/reg-report-pack";
import { cn } from "@/lib/utils";

/** 점검 결과에서 넘겨받는 조문 하나 */
export interface BatchSource {
  no: string;
  label: string; // 제8조(근무시간)
  current: string; // 현행 본문
  /** 법정 기준 규칙이 고친 본문(수치 위반) — 있으면 이것을 바탕으로 AI가 나머지를 고침 */
  ruleFixed: string | null;
  /** 지적 사항·고칠 방향(개정 방향으로 AI에 넘김) */
  instruction: string;
  upper: { label: string; text: string }[];
  verdict: Verdict;
  basis: string[];
}
type Row = BatchSource & { amended: string; source: "규칙" | "AI" | "규칙+AI" | "없음"; reason?: string; warnings?: string[]; include: boolean; edit: boolean };

/**
 * 자체규정 점검 → 상충·검토 필요 조문 한 번에 개정. 개정 화면과 같은 AI·가드(/api/amend-batch → lib/amend-ai guardAmend):
 * 근거 밖 수치·법령, 새 벌칙, 의무↔재량 표현 변경, 지시에 없는 항 삭제는 막고 그 조문은 현행 유지(이유 표시).
 * 담당자가 반영할 조문을 고르고 고친 뒤 일부개정(안) 보고·신구조문대비표(한글·Word)를 만듦
 */
export function BatchAmendPanel({ sources, regName, kind }: { sources: BatchSource[]; regName: string; kind: DraftKind }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [meta, setMeta] = React.useState<{ label: string; model: string; sec: number } | null>(null);
  const [days, setDays] = React.useState(0);
  const key = sources.map((s) => s.no).join(",");
  React.useEffect(() => setRows(null), [key]);

  const run = async () => {
    setBusy(true);
    const t = Date.now();
    const base: Row[] = sources.map((s) => ({ ...s, amended: s.ruleFixed ?? s.current, source: s.ruleFixed ? "규칙" : "없음", include: !!s.ruleFixed, edit: false }));
    try {
      const j = await fetchJson<{ results: { id: string; ok: boolean; text?: string; warnings?: string[]; reason?: string }[]; label: string; model: string }>("/api/amend-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lawName: regName,
          kind,
          items: sources.map((s) => ({ id: s.no, label: s.label, current: s.ruleFixed ?? s.current, original: s.current, instruction: s.instruction.slice(0, 1000), upper: s.upper.slice(0, 6) })),
        }),
        timeoutMs: 180000,
      });
      for (const r of j.results) {
        const row = base.find((b) => b.no === r.id);
        if (!row) continue;
        if (r.ok && r.text) Object.assign(row, { amended: r.text, source: row.ruleFixed ? "규칙+AI" : "AI", warnings: r.warnings, include: true });
        else row.reason = r.reason;
      }
      setMeta({ label: j.label, model: j.model, sec: Math.round((Date.now() - t) / 100) / 10 });
      toast(`${base.filter((b) => b.include).length}개 조문의 개정안을 만들었어요 — 반영할 조문을 확인하세요`);
    } catch (e) {
      toast(`AI 개정안을 쓰지 못했어요(${(e as Error).message}) — 규칙으로 고친 조문만 담았어요`);
    } finally {
      setRows(base);
      setBusy(false);
    }
  };

  const set = (no: string, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r) => (r.no === no ? { ...r, ...patch } : r)));
  const chosen = (rows ?? []).filter((r) => r.include && r.amended.trim() && r.amended !== r.current);
  const items = chosen.map((r) => ({ label: r.label, current: r.current, amended: r.amended, verdict: r.verdict, basis: r.basis }));
  const conflict = sources.filter((s) => s.verdict === "상충").length;

  return (
    <section id="batch-amend" className="scroll-mt-40 rounded-2xl border border-accent/30 bg-accent/5 p-4 shadow-sm" aria-label="상충·검토 필요 조문 한 번에 개정">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-extrabold">
            <Wand2 className="h-4 w-4 text-accent" /> 상충·검토 필요 조문 한 번에 개정
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            상충 {conflict}개 · 검토 필요 {sources.length - conflict}개 조문을 근거 상위 조문에 맞게 고쳐 일부개정(안) 보고까지 — 개정 화면과 같은 AI·가드
          </p>
        </div>
        {!rows && (
          <Button variant="accent" onClick={run} disabled={busy || !sources.length}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "개정안 쓰는 중…" : `${sources.length}개 조문 개정안 쓰기`}
          </Button>
        )}
      </div>
      {busy && <p className="mt-2 text-xs text-muted-foreground">수치 위반은 법정 기준 규칙으로, 그 밖의 지적은 국산 AI(Solar)가 조문마다 동시에 고치고 가드가 검증해요(보통 20~40초).</p>}

      {rows && (
        <div className="mt-3 space-y-2">
          {meta && (
            <p className="text-xs text-muted-foreground">
              AI({meta.label} · {meta.model}) 약 {meta.sec}초 · 반영 {chosen.length}개 / {rows.length}개 조문 — 내용은 담당자가 확인해 확정하세요
            </p>
          )}
          {rows.map((r) => {
            const d = diffWords(r.current, r.amended);
            const none = r.amended === r.current;
            return (
              <div key={r.no} className={cn("rounded-xl border bg-card p-3", r.include && !none ? "border-accent/40" : "opacity-90")}>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-sm font-bold">
                    <input type="checkbox" checked={r.include && !none} disabled={none} onChange={(e) => set(r.no, { include: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--accent))]" aria-label={`${r.label} 개정안 반영`} />
                    {r.label}
                  </label>
                  <Badge variant={r.verdict === "상충" ? "danger" : "warning"}>{r.verdict}</Badge>
                  {!none && <Badge variant="outline">{r.source === "규칙" ? "법정 기준 규칙" : r.source === "AI" ? "AI 작성·가드 통과" : "규칙 + AI"}</Badge>}
                  {!none && <span className="text-xs text-muted-foreground">{changeSummary(r.current, r.amended)}</span>}
                  <button type="button" onClick={() => set(r.no, { edit: !r.edit })} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                    <PencilLine className="h-3.5 w-3.5" /> {r.edit ? "닫기" : "직접 고치기"}
                  </button>
                </div>
                {none ? (
                  <p className="mt-2 flex gap-1.5 rounded-lg bg-secondary/60 p-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>개정안 없음 — {r.reason ?? "상위 조문에 따를 기준이 없어 바꾸지 않았어요"}. 담당자가 판단해 ‘직접 고치기’로 쓰면 반영돼요.</span>
                  </p>
                ) : (
                  <div className="mt-2 grid gap-2 text-sm leading-6 md:grid-cols-2">
                    <p className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-2">
                      {d.old.map((p, i) => (p.op === "same" ? <span key={i}>{p.text}</span> : <del key={i} className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">{p.text}</del>))}
                    </p>
                    <p className="whitespace-pre-wrap rounded-lg bg-sky-50/70 p-2 dark:bg-sky-900/10">
                      {d.new.map((p, i) => (p.op === "same" ? <span key={i}>{p.text}</span> : <ins key={i} className="bg-sky-100 font-bold text-sky-900 underline dark:bg-sky-900/40 dark:text-sky-100">{p.text}</ins>))}
                    </p>
                  </div>
                )}
                {r.warnings?.map((w) => (
                  <p key={w} className="mt-1 text-xs text-amber-800 dark:text-amber-300">! {w}</p>
                ))}
                {r.edit && (
                  <textarea
                    value={r.amended}
                    onChange={(e) => set(r.no, { amended: e.target.value, include: true, source: r.source === "없음" ? "AI" : r.source })}
                    rows={4}
                    className="mt-2 w-full rounded-md border bg-card p-2 font-serif text-sm leading-6"
                    aria-label={`${r.label} 개정안 직접 수정`}
                  />
                )}
              </div>
            );
          })}
          <div className="grid gap-2 border-t pt-3 sm:flex sm:flex-wrap sm:items-center">
            <label className="flex items-center justify-between gap-1.5 text-xs font-semibold text-muted-foreground sm:justify-start">
              시행일
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 flex-1 rounded-md border bg-card px-2 text-sm text-foreground sm:h-8 sm:flex-none sm:text-xs">
                <option value={0}>공포한 날부터</option>
                <option value={30}>공포 후 30일</option>
                <option value={90}>공포 후 3개월</option>
                <option value={180}>공포 후 6개월</option>
              </select>
            </label>
            <RegReportPack build={(o) => batchAmendDocs({ regName, kind, items, effectiveDays: days }, o)} label={`일부개정(안) 보고서 바로 만들기(${chosen.length}개 조문)`} disabled={!chosen.length} size="default" className="w-full sm:w-auto" />
            <DocSaveButtons name={`${regName} 신·구조문대비표`} sections={() => [{ title: "신·구조문대비표", html: oldNewTableHtml(items) }]} label="신·구조문대비표" />
            <Button size="sm" variant="ghost" className="justify-self-center sm:ml-auto" onClick={() => setRows(null)}>
              <RotateCcw /> 다시 쓰기
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
