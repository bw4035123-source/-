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
import { DocSaveButtons } from "@/components/ui/doc-save";
import { fetchJson } from "@/lib/fetch-json";
import { maskPII } from "@/lib/privacy-mask";
import { PrivacyNotice } from "@/components/ui/privacy-notice";
import { AnalyzeForm } from "./analyze-form";
import { FactsCard } from "./facts-card";
import { Recommendations } from "./recommendations";
import { RolePanels } from "./role-panels";
import { ROLES } from "./roles";
import { LawLoader } from "@/components/ui/law-loader";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: AnalyzeResult };

export function AnalyzeView() {
  const params = useSearchParams();
  const initial = params.get("s") ?? "";
  const { provider, ready } = useSettings();
  const toast = useToast();
  const [state, setState] = React.useState<State>({ status: "idle" });
  const [situation, setSituation] = React.useState(initial);
  const [masked, setMasked] = React.useState<string[]>([]);

  const run = React.useCallback(
    async (input: string) => {
      // 개인정보는 서버로 보내기 전에 브라우저에서 가림
      const { text: s, found } = maskPII(input);
      if (found.length) toast(`개인정보 보호를 위해 ${found.join("·")}를 가리고 분석했어요`);
      setMasked(found);
      setSituation(s);
      setState({ status: "loading" });
      try {
        const j = await fetchJson<AnalyzeResult>("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ situation: s, provider: provider || undefined }),
          // 생성형 AI가 세 관점을 한 번에 쓰면 20~35초 걸림(서버 AI 제한 45초 + 근거 검색)
          timeoutMs: 90000,
        });
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
    [provider, toast],
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
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">법률 상황 분석실</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          겪고 있는 상황을 이야기하면 <strong className="text-foreground">관련 법령을 추천</strong>하고,<br className="hidden sm:block" /> <strong className="keep-phrase text-foreground">AI 변호사·검사·판사</strong>의 시각으로 각각 검토해 드려요.
        </p>
        <p className="mx-auto mt-3 block max-w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-semibold leading-5 text-amber-950 sm:inline-flex sm:items-start sm:gap-1.5 sm:text-left lg:whitespace-nowrap dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <span aria-hidden className="hidden sm:inline">⚠️</span>
          {/* 강제 줄바꿈 없이 화면 너비에 맞춰 흐르게 — 뜻 덩어리(ko-phrase)만 갈라지지 않게 묶음 */}
          <span>
            <span aria-hidden className="sm:hidden">⚠️ </span>AI가 만든 참고용 검토예요. <span className="ko-phrase">결과를 맹신하지 말고,</span> 중요한 결정 전에는 반드시{" "}
            <span className="ko-phrase">변호사 등 전문가의 자문을 받으세요</span>
            <span className="keep-phrase">(대한법률구조공단 ☎132)</span>.
          </span>
        </p>
      </header>

      <div className="mx-auto max-w-3xl">
        <AnalyzeForm initial={situation} onSubmit={run} busy={state.status === "loading"} />
      </div>

      <div id="analysis-result" className="scroll-mt-40">
        {state.status === "loading" && (
          <div className="mt-8 space-y-4">
            <LawLoader message="사실관계를 정리하고 관련 법령을 찾고 있어요" sub="AI 변호사·검사·판사 3관점 분석은 보통 15~35초 걸려요" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <Skeleton className="h-56 rounded-2xl" />
              <Skeleton className="h-56 rounded-2xl" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
        {state.status === "done" && masked.length > 0 && (
          <div className="mx-auto mt-6 max-w-5xl">
            <PrivacyNotice kinds={masked} id="privacy-notice" />
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
          <Badge variant={r.guard.passed ? "success" : "warning"}>{!r.guard.passed ? `확인 필요 표현 ${r.guard.unverifiedMentions.length}건` : r.provider.kind === "llm" ? "근거 검증 통과" : r.guard.fallbackKind === "connection" || r.guard.fallbackKind === "guard" ? "검수된 분석으로 대체(규칙기반)" : "검수된 분석(규칙기반)"}</Badge>
          <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}초</span>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <DocSaveButtons name="법률 상황 분석 결과" sections={() => [{ body: analysisText(r) }]} label="분석 결과" className="sm:w-auto" />
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onCopy}>
              <ClipboardCopy /> 복사
            </Button>
          </div>
        </div>
        {r.notices.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-secondary/70 px-4 py-2.5 text-xs text-muted-foreground">
            {r.notices.map((n, i) => (
              <li key={i}>ⓘ {n}</li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <FactsCard facts={r.facts} issues={r.issues} />
          <Recommendations recs={r.recommendations} citations={r.citations} />
        </div>

        <div className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="note">
          <span aria-hidden>⚠️</span>
          <p>
            <strong className="block">아래는 AI 변호사·검사·판사의 역할 시뮬레이션입니다.</strong>
            {/* 강제 줄바꿈 없이 화면 너비에 맞춰 흐르게 — 뜻 덩어리(ko-phrase)만 갈라지지 않게 묶음 */}
            실제 변호사의 자문, 검사의 처분, 법원의 판결이 아니므로 <span className="ko-phrase">결과를 맹신하지 마세요.</span> 실제 결과는 증거와 구체적 사정에 따라{" "}
            <span className="ko-phrase">달라질 수 있으니,</span> <span className="ko-phrase">중요한 결정 전에는 반드시</span>{" "}
            <strong className="ko-phrase">변호사·법률구조공단 등</strong> <strong className="ko-phrase">전문가의 자문</strong>을 받으세요.
          </p>
        </div>
        <RolePanels analyses={r.analyses} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RelatedCases query={r.caseQuery} variant="officer" title="이 쟁점의 실제 판례 · 법령해석례" />
          <ContactsCard contacts={r.contacts} />
        </div>

        <p className="rounded-xl border border-dashed p-4 text-center text-xs leading-5 text-muted-foreground">
          ⚖️ 이 화면은 법률가의 사고방식을 보여 주는 <strong>AI 역할 시뮬레이션</strong>이며 실제 변호사의 법률 자문, 검사의 처분, 법원의 판결이 아닙니다. AI 결과를 맹신하지 말고, 중요한 결정 전에는 반드시 전문가의 자문을 받으세요(대한법률구조공단 ☎132).
        </p>
      </div>
    </CitationProvider>
  );
}
