"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ClipboardCopy, Cpu, Database, Gavel, RefreshCw } from "lucide-react";
import type { AnalyzeResult } from "@/lib/answer/types";
import { useSettings } from "@/components/providers/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CitationProvider } from "@/components/law-search/citation-context";
import { ContactsCard } from "@/components/citizen-view/contacts-card";
import { RelatedCases } from "@/components/cases/related-cases";
import { copyText } from "@/lib/clipboard";
import { analysisText } from "@/lib/report-text";
import { AnalyzeForm } from "./analyze-form";
import { FactsCard } from "./facts-card";
import { Recommendations } from "./recommendations";
import { RolePanels } from "./role-panels";
import { ROLES } from "./roles";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: AnalyzeResult };

export function AnalyzeView() {
  const params = useSearchParams();
  const initial = params.get("s") ?? "";
  const { provider, ready } = useSettings();
  const toast = useToast();
  const [state, setState] = React.useState<State>({ status: "idle" });
  const [situation, setSituation] = React.useState(initial);

  const run = React.useCallback(
    async (s: string) => {
      setSituation(s);
      setState({ status: "loading" });
      try {
        const r = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ situation: s, provider: provider || undefined }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "요청 실패");
        setState({ status: "done", result: j });
        // 공유 가능한 주소로 갱신 — 라우터 내비게이션 대신 history API를 써서 페이지 재마운트(→ 자동 재분석 반복)를 막음
        try {
          window.history.replaceState(window.history.state, "", `/analyze?s=${encodeURIComponent(s.slice(0, 600))}`);
        } catch {
          /* 주소 갱신 실패는 무시 */
        }
        setTimeout(() => document.getElementById("analysis-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } catch (e) {
        setState({ status: "error", message: (e as Error).message });
      }
    },
    [provider],
  );

  // 링크로 진입(?s=) 시 1회만 자동 분석(같은 문장 중복 실행 방지)
  const auto = React.useRef(false);
  React.useEffect(() => {
    if (ready && initial.trim().length >= 10 && !auto.current) {
      auto.current = true;
      run(initial);
    }
  }, [ready, initial, run]);

  return (
    <div className="container max-w-6xl py-8">
      <header className="mb-6 text-center">
        <div className="mb-3 flex justify-center gap-2" aria-hidden>
          {(Object.keys(ROLES) as (keyof typeof ROLES)[]).map((k) => {
            const R = ROLES[k];
            return (
              <span key={k} className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${R.head} text-white shadow`}>
                <R.icon className="h-5 w-5" />
              </span>
            );
          })}
        </div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">AI 법률 상황 분석실</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          겪고 있는 상황을 이야기하면 <strong className="text-foreground">관련 법령을 추천</strong>하고, <strong className="text-foreground">변호사·검사·판사</strong>의 시각으로 각각 검토해 드려요.
        </p>
      </header>

      <div className="mx-auto max-w-3xl">
        <AnalyzeForm initial={situation} onSubmit={run} busy={state.status === "loading"} />
      </div>

      <div id="analysis-result" className="scroll-mt-24">
        {state.status === "loading" && (
          <div className="mt-8 space-y-4" role="status" aria-live="polite">
            <p className="flex items-center justify-center gap-2 font-semibold text-accent">
              <Gavel className="h-5 w-5 animate-bounce" /> 사실관계를 정리하고 관련 법령을 찾고 있어요…
            </p>
            <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <Skeleton className="h-56 rounded-2xl" />
              <Skeleton className="h-56 rounded-2xl" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          </div>
        )}
        {state.status === "error" && (
          <div className="mx-auto mt-8 max-w-3xl rounded-xl border-2 border-destructive/30 bg-destructive/5 p-5" role="alert">
            <p className="flex items-center gap-2 font-bold text-destructive">
              <AlertTriangle className="h-5 w-5" /> {state.message}
            </p>
            <Button className="mt-3" variant="outline" onClick={() => run(situation)} disabled={situation.trim().length < 10}>
              <RefreshCw /> 다시 시도
            </Button>
          </div>
        )}
        {state.status === "done" && <Result r={state.result} onCopy={async () => toast((await copyText(analysisText(state.result))) ? "분석 결과를 복사했습니다" : "복사 실패")} />}
      </div>
    </div>
  );
}

function Result({ r, onCopy }: { r: AnalyzeResult; onCopy: () => void }) {
  return (
    <CitationProvider citations={r.citations}>
      <div className="mt-10 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="gap-1">
            <Cpu className="h-3 w-3" /> {r.provider.label}
            {r.provider.kind === "llm" ? ` · ${r.provider.model}` : ""}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Database className="h-3 w-3" /> {r.dataSource === "live" ? "국가법령정보 실시간" : `법령 원문 ${MOCK_DATASET_DATE} 기준`}
          </Badge>
          <Badge variant={r.guard.passed ? "success" : "warning"}>{r.guard.passed ? "근거 검증 통과" : `확인 필요 표현 ${r.guard.unverifiedMentions.length}건`}</Badge>
          <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}초</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onCopy}>
            <ClipboardCopy /> 분석 결과 복사
          </Button>
        </div>
        {r.notices.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-secondary/70 px-4 py-2.5 text-xs text-muted-foreground">
            {r.notices.map((n, i) => (
              <li key={i}>ⓘ {n}</li>
            ))}
          </ul>
        )}

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <FactsCard facts={r.facts} issues={r.issues} />
          <Recommendations recs={r.recommendations} citations={r.citations} />
        </div>

        <RolePanels analyses={r.analyses} />

        <div className="grid gap-6 lg:grid-cols-2">
          <RelatedCases query={r.caseQuery} variant="officer" title="이 쟁점의 실제 판례 · 법령해석례" />
          <ContactsCard contacts={r.contacts} />
        </div>

        <p className="rounded-xl border border-dashed p-4 text-center text-xs leading-5 text-muted-foreground">
          ⚖️ 이 화면은 법률가의 사고방식을 보여 주는 <strong>AI 역할 시뮬레이션</strong>이며 실제 변호사의 법률 자문, 검사의 처분, 법원의 판결이 아닙니다. 실제 결과는 증거와 구체적 사정에 따라 달라질 수 있으니 중요한 결정 전에는 전문가와 상담하세요(대한법률구조공단 ☎132).
        </p>
      </div>
    </CitationProvider>
  );
}
