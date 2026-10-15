"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelatedCases } from "./related-cases";

const SUGGEST = ["부당해고", "임차보증금", "층간소음", "전세사기", "음주운전", "퇴직금", "육아휴직", "정보공개", "개인정보", "행정심판"];

/** 판례 보기 — 판례·법령해석례 검색 + 상세 보기 */
export function CasesView() {
  const initial = (useSearchParams().get("q") ?? "").slice(0, 100);
  const [q, setQ] = React.useState(initial);
  const [query, setQuery] = React.useState(initial);
  const [run, setRun] = React.useState(0);
  const go = (v: string) => {
    const t = v.trim();
    if (!t) return;
    setQ(t);
    setQuery(t);
    setRun((n) => n + 1); // 같은 검색어로 다시 눌러도 새로 검색
    try {
      window.history.replaceState(window.history.state, "", `/cases?q=${encodeURIComponent(t)}`);
    } catch {
      /* 무시 */
    }
  };
  return (
    <div className="container max-w-4xl py-10">
      <header className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-navy-700 to-sage-600 text-white shadow">
          <Scale className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">판례 보기</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">법원 판례와 법제처 법령해석례를 찾아 판시사항·판결요지·전문까지 확인하세요.</p>
      </header>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-2xl border-2 bg-card p-2 pl-4 shadow-lg focus-within:border-accent"
      >
        <Search className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <label htmlFor="case-q" className="sr-only">
          판례 검색어
        </label>
        <input
          id="case-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          placeholder="사건명·키워드 (예: 부당해고, 임차보증금, 2023두54914)"
          className="min-w-0 flex-1 bg-transparent py-2 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <Button type="submit" variant="accent" className="rounded-xl" disabled={!q.trim()}>
          검색
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {SUGGEST.map((s) => (
          <button key={s} type="button" onClick={() => go(s)} className="rounded-full border bg-card px-3 py-1 text-sm font-semibold hover:border-accent hover:text-accent">
            # {s}
          </button>
        ))}
      </div>
      <div className="mt-8">{query ? <RelatedCases key={`${query}-${run}`} query={query} variant="page" limit={10} /> : <p className="text-center text-sm text-muted-foreground">검색어를 입력하거나 추천 키워드를 눌러 보세요.</p>}</div>
    </div>
  );
}
