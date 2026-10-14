"use client";
import { motion } from "framer-motion";
import { ChevronRight, Scale } from "lucide-react";
import type { LawRecommendation } from "@/lib/answer/types";
import type { Citation } from "@/lib/law-api/types";
import { useCitations } from "@/components/law-search/citation-context";
import { articleLabel } from "@/lib/law-api/util";
import { cn } from "@/lib/utils";

const REL = {
  high: { label: "핵심", cls: "bg-accent text-accent-foreground", bar: "bg-accent" },
  medium: { label: "관련", cls: "bg-accent/15 text-accent", bar: "bg-accent/60" },
  low: { label: "참고", cls: "bg-secondary text-muted-foreground", bar: "bg-muted-foreground/40" },
} as const;

/** 추천 법령 순위 — 관련도와 추천 사유(설명 가능한 AI) */
export function Recommendations({ recs, citations }: { recs: LawRecommendation[]; citations: Citation[] }) {
  const { open } = useCitations();
  const max = Math.max(...recs.map((r) => r.score), 1);
  return (
    <section aria-labelledby="recs-h" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 id="recs-h" className="flex items-center gap-2 font-extrabold">
        <Scale className="h-5 w-5 text-accent" /> 추천 관련 법령 <span className="text-sm font-semibold text-muted-foreground">{recs.length}건</span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">관련도 순으로 정렬했어요. 항목을 누르면 조문 원문과 상·하위법령 연결을 볼 수 있어요.</p>
      <ol className="mt-4 space-y-2">
        {recs.map((r, i) => {
          const c = citations.find((x) => x.key === r.key);
          if (!c) return null;
          const rel = REL[r.relevance];
          return (
            <motion.li key={r.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <button type="button" onClick={() => open(r.key)} className="group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:border-accent hover:bg-secondary/40">
                <span className="mt-0.5 w-5 shrink-0 text-center text-sm font-black text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", rel.cls)}>{rel.label}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">{c.lawKind}</span>
                    <span className="font-bold">
                      {c.lawName} {articleLabel(c.articleNo)}
                    </span>
                    <span className="text-sm text-muted-foreground">({c.title})</span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{r.reason}</span>
                  <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
                    <span className={cn("block h-full rounded-full", rel.bar)} style={{ width: `${Math.max(8, (r.score / max) * 100)}%` }} />
                  </span>
                </span>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-accent" />
              </button>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
