"use client";
import { motion } from "framer-motion";
import { BookMarked, ChevronRight, ClipboardCopy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useCitations } from "./citation-context";
import { ArticleText } from "./article-text";
import type { Citation } from "@/lib/law-api/types";
import { articleLabel, draftQuote } from "@/lib/law-api/util";
import { copyText } from "@/lib/clipboard";
import { recentAmendment } from "@/lib/law-api/amend";
import { cn } from "@/lib/utils";

/** 근거 법령 조문 카드(Citation Card) — 원문은 항상 법령 DB/Open API 원문 그대로 표시 */
export function CitationCard({ citation, index, cited, officer }: { citation: Citation; index: number; cited: boolean; officer: boolean }) {
  const { open } = useCitations();
  const toast = useToast();
  const amended = recentAmendment(citation.text);
  return (
    <motion.article
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 * index }}
      id={`cite-${index + 1}`}
      className={cn("group relative rounded-xl border bg-card p-4 shadow-sm transition hover:border-accent hover:shadow-md", cited && "border-l-4 border-l-accent")}
    >
      <button type="button" onClick={() => open(citation.key)} className="absolute inset-0 rounded-xl" aria-label={`${citation.lawName} ${articleLabel(citation.articleNo)} 원문 전문 보기`} />
      <div className="flex items-start gap-3">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-extrabold", cited ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground")}>{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">
              {citation.lawKind}
            </Badge>
            {!cited && (
              <Badge variant="outline" className="text-[10px]">
                참고
              </Badge>
            )}
            {amended && (
              <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="원문의 개정 표시 기준 최근 1년 안에 바뀐 조문이에요. 예전 기준으로 판단하지 않았는지 확인하세요.">
                최근 개정 {amended.label}
              </Badge>
            )}
            {citation.source === "live" && (
              <Badge variant="success" className="text-[10px]">
                실시간
              </Badge>
            )}
          </div>
          <h4 className="mt-1.5 text-sm font-bold leading-snug">
            <BookMarked className="mr-1 inline h-4 w-4 text-accent" aria-hidden />
            {citation.lawName} {articleLabel(citation.articleNo)}
            <span className="font-semibold text-muted-foreground">({citation.title})</span>
          </h4>
          <ArticleText text={citation.text} clamp className="mt-2 text-sm leading-6 text-foreground/80" />
          <div className="relative z-10 mt-3 flex items-center justify-between">
            {officer ? (
              <button
                type="button"
                onClick={async () => toast((await copyText(draftQuote(citation))) ? "기안문 인용문을 복사했습니다" : "복사 실패")}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
              >
                <ClipboardCopy className="h-3.5 w-3.5" /> 인용문 복사
              </button>
            ) : (
              <span />
            )}
            <span className="pointer-events-none inline-flex items-center text-xs font-semibold text-accent">
              원문 전문 <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
