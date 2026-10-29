"use client";
import * as React from "react";
import { FileSearch, ShieldAlert, ShieldCheck, Info } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { cn } from "@/lib/utils";

/** 환각 방지 검증 결과 표시 */
export function GuardBadge({ result }: { result: AskResult }) {
  const [open, setOpen] = React.useState(false);
  const g = result.guard;
  const ok = g.passed;
  const cited = new Set(Array.from(JSON.stringify([result.summary, result.citizen, result.officer]).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1])).size;
  // 답변 방식에 맞게: 근거 없음 / 사람이 검수한 규칙기반 답변 / 생성형 AI 답변(검증을 통과했을 때만 '검증 통과')
  const none = result.citations.length === 0;
  const llm = result.provider.kind === "llm";
  const label = none ? "관련 조문 없음 · 지어내지 않음" : !ok ? `확인 필요 표현 ${g.unverifiedMentions.length}건` : llm ? `근거 검증 통과 · 인용 ${cited}건` : `검수된 답변 · 인용 ${cited}건`;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold",
          none ? "bg-secondary text-foreground/80" : ok ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
        )}
      >
        {none ? <FileSearch className="h-4 w-4" /> : ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {label}
        <Info className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="mt-2 max-w-xl rounded-lg border bg-card p-3 text-xs leading-5 text-muted-foreground shadow-sm">
          <p className="mb-1">
            <strong className="text-foreground">답변 방식</strong>:{" "}
            {none
              ? "질문과 맞는 근거 조문을 찾지 못해 답을 지어내지 않고 상담 기관을 안내했어요."
              : llm
                ? `생성형 AI(${result.provider.model ?? result.provider.label})가 검색된 근거 조문만 보고 쓴 답변을 아래 방식으로 검증했어요.`
                : "생성형 AI를 쓰지 않고, 사람이 검수한 문장과 법령 원문으로 조립한 규칙기반 답변이에요."}
          </p>
          <p>
            <strong className="text-foreground">검증 방식</strong>: 답변 문장은 검색된 근거 조문 목록 안에서만 인용할 수 있으며, 목록 밖 인용은 자동 제거됩니다. 생성형 AI 답변은 금액·기간·비율도 원문과 대조해 다르면 쓰지 않습니다. 본문에 쓰인 조문 번호는 근거 원문과 대조하고, 인용 카드에는 AI 문장이 아닌 법령 원문만 표시합니다.
          </p>
          {g.removedCitations.length > 0 && <p className="mt-1">· 자동 제거된 인용: {g.removedCitations.join(", ")}</p>}
          {g.unverifiedMentions.length > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">· 근거에서 확인되지 않은 표현: {g.unverifiedMentions.join(", ")}</p>}
          {g.fallbackReason && <p className="mt-1">· {g.fallbackReason}</p>}
        </div>
      )}
    </div>
  );
}
