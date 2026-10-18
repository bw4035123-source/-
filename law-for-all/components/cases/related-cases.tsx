"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Gavel, Loader2, RefreshCw, Search } from "lucide-react";
import type { CaseItem } from "@/lib/law-api/types";
import { formatLawDate, cn } from "@/lib/utils";
import { CaseViewerSheet } from "./case-viewer-sheet";
import { fetchJson } from "@/lib/fetch-json";

interface Props {
  query: string | null;
  variant?: "citizen" | "officer" | "page";
  limit?: number;
  title?: string;
}

/** 관련 판례·법령해석례 — 답변과 별도로 불러와(답변 속도 보호) 목록 + 판례 보기 */
export function RelatedCases({ query, variant = "officer", limit = 5, title }: Props) {
  const [data, setData] = React.useState<{ cases: CaseItem[]; live: boolean; warnings?: string[]; error?: string; retrying?: boolean } | null>(null);
  const [open, setOpen] = React.useState<CaseItem | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const autoRetried = React.useRef(false);

  React.useEffect(() => {
    if (!query) return;
    setData(null);
    const ctrl = new AbortController();
    fetchJson<{ cases: CaseItem[]; live: boolean; warnings?: string[] }>(`/api/cases?q=${encodeURIComponent(query)}&limit=${limit}`, { signal: ctrl.signal, timeoutMs: 30000 })
      .then((j) => {
        // 본문 검색이 지연됐다면(서버는 계속 받아 캐시에 저장) 잠시 뒤 한 번 자동으로 다시 확인
        const slow = (j.warnings ?? []).some((w) => w.includes("본문 검색이 지연"));
        if (slow && !autoRetried.current) {
          autoRetried.current = true;
          setData({ ...j, retrying: true });
          setTimeout(() => !ctrl.signal.aborted && setNonce((n) => n + 1), 6000);
        } else setData(j);
      })
      .catch((e) => !ctrl.signal.aborted && setData({ cases: [], live: true, error: (e as Error).message }));
    return () => ctrl.abort();
  }, [query, limit, nonce]);

  const retry = (
    <button type="button" onClick={() => setNonce((n) => n + 1)} className="ml-1 inline-flex items-center gap-1 font-semibold text-accent hover:underline">
      <RefreshCw className="h-3.5 w-3.5" /> 다시 검색
    </button>
  );
  const authFail = (data?.warnings ?? []).some((w) => w.includes("인증 실패"));

  const heading = title ?? (variant === "citizen" ? "비슷한 사건, 법원은 어떻게 판단했을까요?" : "관련 판례 · 법령해석례");
  const prec = data?.cases.filter((c) => c.kind === "판례") ?? [];
  const expc = data?.cases.filter((c) => c.kind === "법령해석례") ?? [];

  const List = ({ items, label }: { items: CaseItem[]; label: string }) =>
    items.length ? (
      <div>
        <p className="mb-1.5 text-xs font-bold text-muted-foreground">
          {label} {items.length}건
        </p>
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={`${c.kind}-${c.id}`}>
              <button type="button" onClick={() => setOpen(c)} className="group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:border-accent hover:bg-secondary/40">
                <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold", c.kind === "판례" ? "bg-primary text-primary-foreground" : "bg-accent/15 text-accent")}>{c.kind === "판례" ? "판례" : "해석"}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-semibold group-hover:text-accent">{c.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{[c.court, c.caseNo, formatLawDate(c.date)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="mt-1 inline-flex shrink-0 items-center text-xs font-semibold text-accent">
                  판례 보기 <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <section aria-label={heading} className={cn(variant !== "page" && "rounded-2xl border bg-card p-5 shadow-sm")}>
      {variant !== "page" && (
        <h2 className="mb-3 flex items-center gap-2 font-extrabold">
          <Gavel className="h-5 w-5 text-accent" /> {heading}
        </h2>
      )}
      {!query ? (
        <p className="text-sm text-muted-foreground">이 질문에 맞는 판례 검색어가 없어요. 판례 보기 메뉴에서 직접 검색해 보세요.</p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 국가법령정보센터에서 판례를 찾는 중…
        </p>
      ) : !data.live ? (
        <p className="text-sm leading-6 text-muted-foreground">
          판례·법령해석례는 법제처 국가법령정보 인증키(LAW_API_OC)를 설정하면 실시간으로 보여 드려요. 확인되지 않은 사건번호를 임의로 만들어 보여 주지 않습니다.
        </p>
      ) : data.retrying && !data.cases.length ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 판례 본문까지 찾고 있어요. 잠시만 기다려 주세요…
        </p>
      ) : data.error ? (
        <p className="text-sm text-muted-foreground">
          {data.error}
          {retry}
        </p>
      ) : authFail ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100">
          국가법령정보센터가 인증키를 거절했어요. open.law.go.kr에서 인증키의 <strong>서버 IP 등록</strong>에 이 PC의 공인 IP가 들어 있는지 확인해 주세요. (키설정.bat 을 실행하면 연결 상태를 바로 점검할 수 있어요)
          {retry}
        </p>
      ) : data.cases.length ? (
        <div className="space-y-4">
          <List items={prec} label="판례" />
          <List items={expc} label="법령해석례" />
          {!!data.warnings?.length && (
            <p className="text-xs text-muted-foreground">
              ⓘ {data.warnings[data.warnings.length - 1]}
              {retry}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          ‘{query}’와 관련된 판례를 찾지 못했어요.{data.warnings?.length ? ` (${data.warnings[0]})` : ""}
          {retry}
        </p>
      )}
      {variant !== "page" && query && (
        <Link href={`/cases?q=${encodeURIComponent(query)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          <Search className="h-3.5 w-3.5" /> 판례 더 찾아보기
        </Link>
      )}
      <CaseViewerSheet item={open} onOpenChange={(o) => !o && setOpen(null)} />
    </section>
  );
}
