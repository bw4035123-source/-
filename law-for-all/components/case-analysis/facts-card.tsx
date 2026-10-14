import { ListChecks } from "lucide-react";
import type { ExtractedFact } from "@/lib/answer/types";

const ORDER: ExtractedFact["kind"][] = ["당사자", "행위·사건", "금액", "기간·시점", "장소"];

/** 사실관계 정리 — 상황 서술에서 자동 추출한 단서 */
export function FactsCard({ facts, issues }: { facts: ExtractedFact[]; issues: { id: string; label: string }[] }) {
  return (
    <section aria-labelledby="facts-h" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="facts-h" className="flex items-center gap-2 font-extrabold">
        <ListChecks className="h-5 w-5 text-accent" /> 사실관계 정리
      </h2>
      {facts.length ? (
        <dl className="mt-3 space-y-2">
          {ORDER.filter((k) => facts.some((f) => f.kind === k)).map((k) => (
            <div key={k} className="flex flex-wrap items-start gap-2 text-sm">
              <dt className="w-20 shrink-0 pt-0.5 text-xs font-bold text-muted-foreground">{k}</dt>
              <dd className="flex flex-1 flex-wrap gap-1.5">
                {facts
                  .filter((f) => f.kind === k)
                  .map((f) => (
                    <span key={f.value} className="rounded-md bg-secondary px-2 py-0.5 font-medium">
                      {f.value}
                    </span>
                  ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">서술에서 뚜렷한 사실 단서를 찾지 못했어요.</p>
      )}
      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-bold text-muted-foreground">발견된 법률 쟁점</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {issues.length ? (
            issues.map((i, n) => (
              <span key={i.id} className={n === 0 ? "rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground" : "rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-accent"}>
                {n === 0 ? "주 쟁점 · " : ""}
                {i.label}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">특정 쟁점 미발견 — 조문 검색 결과로 분석</span>
          )}
        </div>
      </div>
    </section>
  );
}
