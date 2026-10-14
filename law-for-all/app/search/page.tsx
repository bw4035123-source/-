import type { Metadata } from "next";
import { SearchBox } from "@/components/law-search/search-box";
import { SearchResults } from "@/components/law-search/search-results";

export function generateMetadata({ searchParams }: { searchParams: { q?: string } }): Metadata {
  return { title: searchParams.q ? `“${searchParams.q.slice(0, 40)}” 검색 결과` : "법률 검색" };
}

export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim().slice(0, 500);
  return (
    <div className="container py-6 sm:py-8">
      <div className="no-print mx-auto mb-6 max-w-3xl">
        <SearchBox defaultValue={q} variant="compact" />
      </div>
      {q ? (
        <>
          <h1 className="mb-4 text-xl font-extrabold leading-snug sm:text-2xl">
            <span className="text-muted-foreground">Q.</span> {q}
          </h1>
          <SearchResults q={q} />
        </>
      ) : (
        <p className="py-20 text-center text-muted-foreground">검색어를 입력해 주세요.</p>
      )}
    </div>
  );
}
