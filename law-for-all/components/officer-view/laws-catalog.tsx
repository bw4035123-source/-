"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, CornerDownRight, Loader2 } from "lucide-react";
import type { LawSummary } from "@/lib/law-api/types";
import { Badge } from "@/components/ui/badge";

/** 법령 목록(체계별) — /api/laws 조회(Node·Python 서버 공통) */
export function LawsCatalog() {
  const q = (useSearchParams().get("q") ?? "").slice(0, 100);
  const [data, setData] = React.useState<{ laws: LawSummary[]; mode: string } | null>(null);
  React.useEffect(() => {
    setData(null);
    fetch(`/api/laws?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ laws: [], mode: "mock" }));
  }, [q]);

  const laws = data?.laws ?? [];
  const roots = laws.filter((l) => !l.parentId);
  const childrenOf = (id: string) => laws.filter((l) => l.parentId === id);
  const orphans = laws.filter((l) => l.parentId && !roots.some((r) => r.id === l.parentId));

  return (
    <div className="container py-10">
      <h1 className="text-2xl font-extrabold">법령 둘러보기</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        법률과 하위법령(시행령·시행규칙)을 체계별로 확인합니다. {data?.mode === "live" ? "국가법령정보 실시간 검색 결과를 포함합니다." : "현재 내장 시연 데이터 모드입니다."}
      </p>
      <form className="mt-5 flex max-w-lg gap-2" action="/laws">
        <label htmlFor="law-name-q" className="sr-only">
          법령명 검색
        </label>
        <input id="law-name-q" name="q" defaultValue={q} placeholder="법령명 또는 키워드 (예: 임대차, 민원)" className="h-10 flex-1 rounded-md border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">검색</button>
      </form>
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
                    <Badge variant="secondary">{l.kind}</Badge>
                    {l.source === "live" && <Badge variant="success">실시간</Badge>}
                  </span>
                  <span className="mt-1.5 block text-lg font-bold group-hover:text-accent">{l.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.ministry}
                    {l.articleCount ? ` · 조문 ${l.articleCount}개` : ""}
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
      {data && !laws.length && <p className="py-16 text-center text-muted-foreground">검색 결과가 없습니다.</p>}
    </div>
  );
}
