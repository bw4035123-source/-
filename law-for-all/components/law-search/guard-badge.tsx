"use client";
import * as React from "react";
import { ShieldAlert, ShieldCheck, Info } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { cn } from "@/lib/utils";

/** 환각 방지 검증 결과 표시 */
export function GuardBadge({ result }: { result: AskResult }) {
  const [open, setOpen] = React.useState(false);
  const g = result.guard;
  const ok = g.passed;
  const cited = new Set(Array.from(JSON.stringify([result.summary, result.citizen, result.officer]).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1])).size;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold",
          ok ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
        )}
      >
        {ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {ok ? `근거 검증 통과 · 인용 ${cited}건` : `확인 필요 표현 ${g.unverifiedMentions.length}건`}
        <Info className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="mt-2 max-w-xl rounded-lg border bg-card p-3 text-xs leading-5 text-muted-foreground shadow-sm">
          <p>
            <strong className="text-foreground">AI 검증 방식</strong>: 답변 문장은 검색된 근거 조문 목록 안에서만 인용할 수 있으며, 목록 밖 인용은 자동 제거됩니다. 본문에 쓰인 조문 번호는 근거 원문과 대조하고, 인용 카드에는 AI 문장이 아닌 법령 원문만 표시합니다.
          </p>
          {g.removedCitations.length > 0 && <p className="mt-1">· 자동 제거된 인용: {g.removedCitations.join(", ")}</p>}
          {g.unverifiedMentions.length > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">· 근거에서 확인되지 않은 표현: {g.unverifiedMentions.join(", ")}</p>}
          {g.fallbackReason && <p className="mt-1">· {g.fallbackReason}</p>}
        </div>
      )}
    </div>
  );
}
