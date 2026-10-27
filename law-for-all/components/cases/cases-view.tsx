"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/components/providers/settings-provider";
import { RelatedCases } from "./related-cases";

const SUGGEST = ["부당해고", "임차보증금", "층간소음", "전세사기", "음주운전", "퇴직금", "육아휴직", "정보공개", "개인정보", "행정심판"];
/** 공직자 모드 — 업무 분야별 쟁점(법령해석례·판례 검색어) */
const OFFICER_SUGGEST: { group: string; items: string[] }[] = [
  { group: "인사·복무", items: ["겸직 허가", "징계 재량", "취업규칙 불이익 변경", "연차휴가", "시간외근무"] },
  { group: "청렴·선거", items: ["외부강의 사례금", "금품 수수", "공무원 선거운동", "정치적 중립"] },
  { group: "재산·계약", items: ["공유재산 사용허가", "대부료", "수의계약", "지방공기업 임원"] },
  { group: "행정·민원", items: ["사전통지 생략", "정보공개 비공개", "민원 처리기간", "보조금 환수", "과태료 부과"] },
];

/** 판례 보기 — 판례·법령해석례 검색 + 상세 보기 */
export function CasesView() {
  const initial = (useSearchParams().get("q") ?? "").slice(0, 100);
  const { mode } = useSettings();
  const officer = mode === "officer";
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
        <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{officer ? "판례·법령해석례 검토" : "판례 보기"}</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          {officer
            ? "업무 쟁점의 법제처 법령해석례(유권해석)와 법원 판례를 찾아, 검토보고서·민원 회신에 쓸 요지와 인용 표기를 바로 가져가세요."
            : "법원 판례와 법제처 법령해석례를 찾아 판시사항·판결요지·전문까지 확인하세요."}
        </p>
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
          placeholder={officer ? "업무 쟁점·법령·사건번호 (예: 겸직 허가, 공유재산 사용허가, 2023두54914)" : "사건명·키워드 (예: 부당해고, 임차보증금, 2023두54914)"}
          className="min-w-0 flex-1 bg-transparent py-2 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <Button type="submit" variant="accent" className="rounded-xl" disabled={!q.trim()}>
          검색
        </Button>
      </form>
      {officer ? (
        <div className="mx-auto mt-4 grid max-w-3xl gap-2 sm:grid-cols-2">
          {OFFICER_SUGGEST.map((g) => (
            <div key={g.group} className="rounded-xl border bg-card p-2.5">
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">{g.group}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((s) => (
                  <button key={s} type="button" onClick={() => go(s)} className="rounded-full border bg-secondary/40 px-2.5 py-0.5 text-[13px] font-semibold hover:border-accent hover:text-accent">
                    # {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUGGEST.map((s) => (
            <button key={s} type="button" onClick={() => go(s)} className="rounded-full border bg-card px-3 py-1 text-sm font-semibold hover:border-accent hover:text-accent">
              # {s}
            </button>
          ))}
        </div>
      )}
      <div className="mt-8">{query ? <RelatedCases key={`${query}-${run}`} query={query} variant="page" limit={10} /> : <p className="text-center text-sm text-muted-foreground">검색어를 입력하거나 추천 키워드를 눌러 보세요.</p>}</div>
    </div>
  );
}
