"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, BookOpen, Gavel, ClipboardCopy, Cpu, Database, FileDown, FileText, Link2, Phone, RefreshCw } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { useSettings } from "@/components/providers/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CitationProvider } from "./citation-context";
import { CitationCard } from "./citation-card";
import { GuardBadge } from "./guard-badge";
import { LoadingState } from "./loading-state";
import { CitizenAnswer } from "@/components/citizen-view/citizen-answer";
import { ContactsCard } from "@/components/citizen-view/contacts-card";
import { OfficerReport } from "@/components/officer-view/officer-report";
import { RelatedCases } from "@/components/cases/related-cases";
import { DocumentPack } from "@/components/officer-view/document-pack";
import { FollowUpChat } from "./follow-up-chat";
import { VerificationReceipt } from "./verification-receipt";
import { FormDraft } from "@/components/citizen-view/form-draft";
import { copyText } from "@/lib/clipboard";
import { fetchJson } from "@/lib/fetch-json";
import { REPORT_STORAGE_KEY, draftBasisBlock, officerReportText } from "@/lib/report-text";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: AskResult };

export function SearchResults({ q }: { q: string }) {
  const { mode, provider, ready } = useSettings();
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState<State>({ status: "idle" });
  const cache = React.useRef(new Map<string, AskResult>());
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!ready || !q) return;
    // 규칙엔진 결과는 두 모드를 모두 포함하므로 모드 전환 시 재요청하지 않음
    const anyKey = `${q}|${provider}`;
    const cached = cache.current.get(`${anyKey}|${mode}`) ?? (() => {
      const other = cache.current.get(`${anyKey}|${mode === "citizen" ? "officer" : "citizen"}`);
      return other && (mode === "citizen" ? other.citizen : other.officer) ? { ...other, mode } : undefined;
    })();
    if (cached && nonce === 0) {
      setState({ status: "done", result: cached });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetchJson<AskResult>("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, mode, provider: provider || undefined }),
      signal: ctrl.signal,
    })
      .then((result) => {
        cache.current.set(`${anyKey}|${mode}`, result);
        setState({ status: "done", result });
        setNonce(0);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", message: (e as Error).message });
      });
    return () => ctrl.abort();
  }, [q, mode, provider, ready, nonce]);

  if (!q) return null;
  if (state.status === "idle" || state.status === "loading") return <LoadingState />;
  if (state.status === "error")
    return (
      <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-6" role="alert">
        <p className="flex items-center gap-2 font-bold text-destructive">
          <AlertTriangle className="h-5 w-5" /> 답변을 가져오지 못했습니다
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw /> 다시 시도
        </Button>
      </div>
    );

  const r = state.result;
  const officer = mode === "officer";
  const citedKeys = new Set(Array.from(JSON.stringify([r.summary, r.citizen, r.officer]).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1]));

  const copy = async (text: string, msg: string) => toast((await copyText(text)) ? msg : "복사하지 못했습니다");
  const openReport = () => {
    try {
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(r));
    } catch {
      /* 저장 실패 시 리포트 화면에서 재조회 */
    }
    router.push(`/report?q=${encodeURIComponent(q)}`);
  };

  return (
    <CitationProvider citations={r.citations}>
      {/* 메타 정보 */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        {r.topic && <Badge variant="accent">#{r.topic.label}</Badge>}
        <Badge variant="outline" className="gap-1">
          <Cpu className="h-3 w-3" /> {r.provider.label}
          {r.provider.kind === "llm" ? ` · ${r.provider.model}` : ""}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Database className="h-3 w-3" /> {r.dataSource === "live" ? "국가법령정보 실시간" : `법령 원문 ${MOCK_DATASET_DATE} 기준`}
        </Badge>
        <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}초</span>
        <div className="ml-auto">
          <GuardBadge result={r} />
        </div>
      </div>
      {r.notices.length > 0 && (
        <ul className="mb-5 space-y-1 rounded-lg bg-secondary/70 px-4 py-2.5 text-xs text-muted-foreground">
          {r.notices.map((n, i) => (
            <li key={i}>ⓘ {n}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* 좌측: AI 요약·가이드 */}
        <div className="min-w-0 space-y-6">
          {officer ? <OfficerReport result={r} /> : <CitizenAnswer result={r} />}

          {/* 하단 액션 */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="no-print flex flex-wrap gap-2 rounded-xl border bg-card p-3">
            {officer ? (
              <>
                <DocumentPack result={r} />
                <Button variant="outline" onClick={() => copy(draftBasisBlock(r), "기안문 '관련 근거' 인용문을 복사했습니다")}>
                  <ClipboardCopy /> 기안문 인용문 복사
                </Button>
                <Button variant="outline" onClick={() => copy(officerReportText(r), "검토 보고서 전문을 복사했습니다")}>
                  <FileText /> 보고서 텍스트 복사
                </Button>
                <Button variant="outline" onClick={openReport}>
                  <FileDown /> PDF 저장
                </Button>
              </>
            ) : (
              <>
                <Button variant="accent" onClick={openReport}>
                  <FileDown /> PDF 법률 리포트 다운로드
                </Button>
                <Button variant="outline" onClick={() => document.getElementById("contacts-h")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                  <Phone /> 관련 기관 연락처
                </Button>
              </>
            )}
            {!officer && (
              <Button variant="outline" asChild>
                <Link href={`/analyze?s=${encodeURIComponent(q)}`}>
                  <Gavel /> 변호사·검사·판사 관점 분석
                </Link>
              </Button>
            )}
            <VerificationReceipt result={r} />
            <Button variant="ghost" onClick={() => copy(window.location.href, "검색 결과 링크를 복사했습니다")}>
              <Link2 /> 링크 복사
            </Button>
          </motion.div>

          {/* 이어서 묻기 — 질문·모드가 바뀌면 대화를 새로 시작 */}
          <FollowUpChat key={`${q}|${mode}`} prevQuery={q} />

          {officer ? (
            <RelatedCases query={r.caseQuery} variant="officer" />
          ) : (
            <>
              <FormDraft result={r} />
              <ContactsCard contacts={r.contacts} />
              <RelatedCases query={r.caseQuery} variant="citizen" />
            </>
          )}
        </div>

        {/* 우측: 근거 조문 카드 */}
        <aside aria-labelledby="cite-h" className="space-y-3 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
          <h2 id="cite-h" className="flex items-center gap-2 text-base font-extrabold">
            <BookOpen className="h-5 w-5 text-accent" /> 근거 법령 조문 <span className="text-sm font-semibold text-muted-foreground">{r.citations.length}건</span>
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">카드를 누르면 조문 원문 전문과 상·하위법령 연결 조문을 볼 수 있어요.</p>
          {r.citations.map((c, i) => (
            <CitationCard key={c.key} citation={c} index={i} cited={citedKeys.has(c.key)} officer={officer} />
          ))}
          {r.relatedLaws.length > 0 && (
            <div className="rounded-xl border bg-secondary/50 p-4 text-sm">
              <p className="mb-2 font-bold">관련 법령 전문 보기</p>
              <ul className="space-y-1">
                {r.relatedLaws.map((l) => (
                  <li key={l.id}>
                    <Link href={`/laws/${l.id}`} className="font-medium text-accent hover:underline">
                      「{l.name}」
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      <p className="mt-10 text-center text-xs text-muted-foreground">
        본 답변은 법률 정보 제공을 위한 AI 보조 결과로 법률 자문이 아닙니다. 개별 사안은 원문 확인 및 전문가 상담을 권장합니다.
      </p>
    </CitationProvider>
  );
}
