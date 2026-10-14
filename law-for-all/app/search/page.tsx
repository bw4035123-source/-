"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SearchBox } from "@/components/law-search/search-box";
import { SearchResults } from "@/components/law-search/search-results";

function SearchInner() {
  const q = (useSearchParams().get("q") ?? "").trim().slice(0, 500);
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

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}
