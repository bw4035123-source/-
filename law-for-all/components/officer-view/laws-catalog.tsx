"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, CornerDownRight, Loader2 } from "lucide-react";
import type { LawSummary } from "@/lib/law-api/types";
import { Badge } from "@/components/ui/badge";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

/** 법령 목록(체계별) — /api/laws 조회(Node·Python 서버 공통) */
const KINDS = [
  { id: "law", label: "법령", hint: "법률·대통령령·총리령·부령", example: "법령명 또는 키워드 (예: 주차장법, 건축)" },
  { id: "admrul", label: "행정규칙", hint: "훈령·예규·고시·지침", example: "행정규칙명 (예: 층간소음, 공무원 여비)" },
  { id: "ordin", label: "자치법규", hint: "조례·규칙", example: "조례명 또는 지자체 (예: 서울특별시 주차장, 층간소음)" },
] as const;
type KindId = (typeof KINDS)[number]["id"];

export function LawsCatalog() {
  const sp = useSearchParams();
  const q = (sp.get("q") ?? "").slice(0, 100);
  const kindParam = sp.get("kind");
  const kind: KindId = kindParam === "admrul" || kindParam === "ordin" ? kindParam : "law";
  const meta = KINDS.find((k) => k.id === kind)!;
  const [data, setData] = React.useState<{ laws: LawSummary[]; mode: string; warnings?: string[] } | null>(null);
  React.useEffect(() => {
    setData(null);
    fetch(`/api/laws?q=${encodeURIComponent(q)}&kind=${kind}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ laws: [], mode: "mock" }));
  }, [q, kind]);

  const laws = data?.laws ?? [];
  const roots = laws.filter((l) => !l.parentId);
  const childrenOf = (id: string) => laws.filter((l) => l.parentId === id);
  const orphans = laws.filter((l) => l.parentId && !roots.some((r) => r.id === l.parentId));

  return (
    <div className="container py-10">
      <h1 className="text-2xl font-extrabold">법령 둘러보기</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {data?.mode === "live"
          ? "법제처 국가법령정보 Open API로 현행 법령·행정규칙·자치법규 전체를 실시간 검색합니다."
          : `인증키(LAW_API_OC)가 없어 내장 핵심 법령(국가법령정보센터 원문 ${MOCK_DATASET_DATE} 수집)만 표시합니다.`}
      </p>
      <div className="mt-5 flex flex-wrap gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold sm:inline-flex" role="tablist" aria-label="법령 종류">
        {KINDS.map((k) => (
          <Link
            key={k.id}
            role="tab"
            aria-selected={kind === k.id}
            href={`/laws?kind=${k.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-md px-3 py-1.5 ${kind === k.id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {k.label} <span className="hidden text-xs font-normal text-muted-foreground sm:inline">{k.hint}</span>
          </Link>
        ))}
      </div>
      <form className="mt-3 flex max-w-xl gap-2" action="/laws">
        <input type="hidden" name="kind" value={kind} />
        <label htmlFor="law-name-q" className="sr-only">
          {meta.label} 검색
        </label>
        <input id="law-name-q" name="q" defaultValue={q} placeholder={meta.example} className="h-10 flex-1 rounded-md border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">검색</button>
      </form>
      {data?.warnings?.length ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">△ {data.warnings[0]}</p> : null}
      {!data ? (
        <p className="flex items-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> 불러오는 중…
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {[...roots, ...orphans].map((l) => (
            <li key={l.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <Link href={`/laws/${l.id}`} className="group flex items-start justify-between gap-2">
                <span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{l.subKind || l.kind}</Badge>
                    {l.source === "live" && <Badge variant="success">실시간</Badge>}
                  </span>
                  <span className="mt-1.5 block text-lg font-bold group-hover:text-accent">{l.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.ministry}
                    {l.articleCount ? ` · 조문 ${l.articleCount}개` : ""}
                    {l.effectiveDate && /^\d{8}$/.test(l.effectiveDate) ? ` · 시행 ${l.effectiveDate.slice(0, 4)}.${Number(l.effectiveDate.slice(4, 6))}.${Number(l.effectiveDate.slice(6))}.` : ""}
                  </span>
                </span>
                <ChevronRight className="mt-6 h-5 w-5 text-muted-foreground group-hover:text-accent" />
              </Link>
              {childrenOf(l.id).length > 0 && (
                <ul className="mt-3 space-y-1 border-t pt-3">
                  {childrenOf(l.id).map((c) => (
                    <li key={c.id}>
                      <Link href={`/laws/${c.id}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent">
                        <CornerDownRight className="h-4 w-4" /> {c.name} <span className="text-xs">({c.kind})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && !laws.length && (
        <p className="py-16 text-center text-muted-foreground">
          {kind !== "law" && !q ? `${meta.label} 이름을 입력해 검색하세요.` : kind !== "law" && data.mode !== "live" ? `${meta.label}는 법제처 Open API 인증키(LAW_API_OC) 설정 시 검색됩니다.` : "검색 결과가 없습니다."}
        </p>
      )}
    </div>
  );
}
