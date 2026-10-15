import Link from "next/link";
import { ArrowRight, BadgeCheck, FileSearch, GitCompareArrows } from "lucide-react";
import { SearchBox } from "@/components/law-search/search-box";
import { HeroHeading } from "@/components/law-search/hero-heading";
import { FeatureGrid, ModeCta } from "@/components/law-search/home-mode-blocks";
import { MOCK_LAWS } from "@/lib/law-api/mock";



export default function HomePage() {
  const laws = MOCK_LAWS.filter((l) => l.kind === "법률");
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-navy-50 via-background to-sage-50 dark:from-navy-900 dark:via-background dark:to-sage-800/20" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-sage-200/40 blur-3xl dark:bg-sage-700/20" />
        <div className="container relative flex flex-col items-center py-16 text-center sm:py-24">
          <HeroHeading />
          <div className="mt-8 w-full max-w-3xl">
            <SearchBox autoFocus />
          </div>
          <ModeCta />
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BadgeCheck className="h-4 w-4 text-accent" /> 국가법령정보 Open API 연동
            </span>
            <span className="inline-flex items-center gap-1">
              <FileSearch className="h-4 w-4 text-accent" /> 핵심 법령 {laws.length}종 + 하위법령 내장
            </span>
            <span className="inline-flex items-center gap-1">
              <GitCompareArrows className="h-4 w-4 text-accent" /> 키 없이도 완전 시연
            </span>
          </p>
        </div>
      </section>

      <section className="container py-14" aria-labelledby="feat-h">
        <h2 id="feat-h" className="text-center text-2xl font-extrabold tracking-tight">누구에게나, 정확하게</h2>
        <FeatureGrid />
      </section>

      <section className="container pb-6" aria-labelledby="laws-h">
        <div className="flex items-end justify-between">
          <h2 id="laws-h" className="text-xl font-extrabold">바로 볼 수 있는 법령</h2>
          <Link href="/laws" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            전체 보기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {laws.map((l) => (
            <li key={l.id}>
              <Link href={`/laws/${l.id}`} className="flex h-full flex-col rounded-xl border bg-card p-4 transition hover:border-accent">
                <span className="font-bold">{l.name}</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {l.ministry} · 조문 {l.articles.length}개{MOCK_LAWS.some((c) => c.parentId === l.id) ? " · 하위법령 연계" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
