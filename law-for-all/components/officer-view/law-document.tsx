"use client";
import * as React from "react";
import Link from "next/link";
import { BookOpenCheck, FileClock, GitCompareArrows, Gavel, Loader2, NotebookPen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArticleText } from "@/components/law-search/article-text";
import { ArticleActions } from "./article-actions";
import { ThreeTierCompare } from "./three-tier-compare";
import { CasesPanel } from "./cases-panel";
import type { CaseItem, LawDoc } from "@/lib/law-api/types";
import { articleAnchor, articleLabel } from "@/lib/law-api/util";
import { cn, formatLawDate } from "@/lib/utils";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

interface Props {
  root: LawDoc;
  lawsChildren: LawDoc[];
  initialLawId: string;
  warnings: string[];
}

/** 법제처 형식 법령 뷰어 — 조문 본문 / 3단 대조 / 제·개정 이유 / 실무 노트·판례 */
export function LawDocument({ root, lawsChildren, initialLawId, warnings }: Props) {
  const all = [root, ...lawsChildren];
  const [lawId, setLawId] = React.useState(initialLawId);
  const law = all.find((l) => l.id === lawId) ?? root;
  const [active, setActive] = React.useState<string>("");

  // URL 해시(#jo-3-2)로 진입 시 해당 조문 강조
  React.useEffect(() => {
    const h = decodeURIComponent(window.location.hash.slice(1));
    if (h) {
      setActive(h);
      setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
  }, []);

  const notes = all.flatMap((l) => l.practiceNotes ?? []);

  return (
    <div>
      {/* 법령 머리말(법제처 형식) */}
      <header className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {all.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLawId(l.id)}
              className={cn("rounded-full border px-3 py-1 text-xs font-bold transition", l.id === law.id ? "border-primary bg-primary text-primary-foreground" : "hover:border-accent hover:text-accent")}
              aria-pressed={l.id === law.id}
            >
              {l.kind === "법률" ? "법률" : l.kind === "대통령령" ? "시행령" : "시행규칙"} · {l.shortName ?? l.name}
            </button>
          ))}
        </div>
        <h1 className="mt-4 text-center font-serif text-2xl font-bold sm:text-3xl">{law.name}</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          [{law.kind}]{law.effectiveDate ? ` [시행 ${formatLawDate(law.effectiveDate)}]` : ""} · 소관 {law.ministry}
        </p>
        <p className="mt-3 flex justify-center">
          <Badge variant={law.source === "live" ? "success" : "outline"}>
            {law.source === "live" ? `국가법령정보 실시간 원문${law.fetchedAt ? ` · ${new Date(law.fetchedAt).toLocaleString("ko-KR")}` : ""}` : `국가법령정보센터 원문(${law.officialSnapshot ?? MOCK_DATASET_DATE} 수집) · OC 설정 시 실시간 조회`}
          </Badge>
        </p>
        {warnings.length > 0 && <p className="mt-3 text-center text-xs text-amber-700 dark:text-amber-300">ⓘ {warnings.join(" / ")}</p>}
      </header>

      <Tabs defaultValue="text" className="mt-6">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="text">
            <BookOpenCheck className="h-4 w-4" /> 조문 본문
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="h-4 w-4" /> 3단 대조
          </TabsTrigger>
          <TabsTrigger value="reason">
            <FileClock className="h-4 w-4" /> 제·개정 이유
          </TabsTrigger>
          <TabsTrigger value="notes">
            <Gavel className="h-4 w-4" /> 실무 노트·판례
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="조문 목차" className="hidden lg:block">
              <ol className="sticky top-24 max-h-[calc(100vh-8rem)] space-y-0.5 overflow-y-auto rounded-xl border bg-card p-3 text-sm">
                {law.articles.map((a) => (
                  <li key={a.no}>
                    <a
                      href={`#${articleAnchor(a.no)}`}
                      onClick={() => setActive(articleAnchor(a.no))}
                      className={cn("block rounded px-2 py-1 hover:bg-secondary", active === articleAnchor(a.no) && "bg-accent/10 font-bold text-accent")}
                    >
                      {articleLabel(a.no)} {a.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="space-y-4">
              {law.articles.map((a) => (
                <article
                  key={a.no}
                  id={articleAnchor(a.no)}
                  className={cn("scroll-mt-28 rounded-xl border bg-card p-5 transition", active === articleAnchor(a.no) && "border-accent ring-2 ring-accent/30")}
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-serif text-lg font-bold">
                      {articleLabel(a.no)}({a.title})
                    </h2>
                    <ArticleActions law={law} article={a} />
                  </div>
                  <ArticleText text={a.text} />
                  {a.delegates && a.delegates.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      ↳ 위임:{" "}
                      {a.delegates.map((d, i) => {
                        const l = all.find((x) => x.id === d.lawId);
                        return (
                          <button key={i} type="button" onClick={() => setLawId(d.lawId)} className="mr-2 font-semibold text-accent hover:underline">
                            {l?.shortName ?? l?.name ?? d.lawId} {articleLabel(d.articleNo)}
                          </button>
                        );
                      })}
                    </p>
                  )}
                </article>
              ))}
              {!law.articles.length && <p className="text-sm text-muted-foreground">조문 데이터가 없습니다.</p>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="compare">
          <ThreeTierCompare root={root} lawsChildren={lawsChildren} />
        </TabsContent>

        <TabsContent value="reason">
          <div className="space-y-4">
            {all.map((l) => (
              <section key={l.id} className="rounded-xl border bg-card p-5">
                <h2 className="font-bold">
                  「{l.name}」 <span className="text-sm font-normal text-muted-foreground">제·개정 이유</span>
                </h2>
                <p className="mt-2 whitespace-pre-line leading-7 text-foreground/90">{l.revisionReason ?? "제·개정 이유 정보가 없습니다."}</p>
              </section>
            ))}
            <p className="text-xs text-muted-foreground">※ 내장 데이터는 요약이며, 실시간 연동 시 국가법령정보센터의 제·개정 이유 원문이 표시됩니다.</p>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 font-extrabold">
                <NotebookPen className="h-5 w-5 text-accent" /> 실무 쟁점 노트
              </h2>
              {notes.length ? (
                notes.map((n) => (
                  <div key={n.title} className="rounded-xl border bg-card p-4">
                    <p className="font-bold">{n.title}</p>
                    <p className="mt-1 text-sm leading-6 text-foreground/85">{n.note}</p>
                    <Link href={`/search?q=${encodeURIComponent(n.query)}&mode=officer`} className="mt-2 inline-block text-xs font-semibold text-accent hover:underline">
                      AI 검토로 이어보기 →
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">등록된 실무 노트가 없습니다.</p>
              )}
            </section>
            <LiveCases query={root.name} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LiveCases({ query }: { query: string }) {
  const [data, setData] = React.useState<{ cases: CaseItem[]; live: boolean } | null>(null);
  React.useEffect(() => {
    fetch(`/api/cases?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ cases: [], live: false }));
  }, [query]);
  if (!data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 판례·해석례 조회 중…
      </p>
    );
  return <CasesPanel cases={data.cases} live={data.live} />;
}
