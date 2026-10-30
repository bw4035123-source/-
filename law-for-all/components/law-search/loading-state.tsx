"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 규칙기반·생성형 AI 모두 같은 순서: 근거 검색 → 근거 조문만으로 답변 작성 → 원문 대조 검증(마지막 단계에서 기다림)
const STEPS = ["질문의 의도를 분석하고 있어요", "관련 법령·조문을 찾고 있어요", "찾은 조문만으로 답변을 쓰고 있어요", "답변을 법령 원문과 대조해 검증하고 있어요"];

export function LoadingState() {
  const [i, setI] = React.useState(0);
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, STEPS.length - 1)), 900);
    const s = setTimeout(() => setSlow(true), 5000);
    return () => {
      clearInterval(t);
      clearTimeout(s);
    };
  }, []);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" role="status" aria-live="polite">
      <div className="space-y-4">
        <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 font-semibold text-accent">
          <Loader2 className="h-5 w-5 animate-spin" /> {STEPS[i]}…
        </motion.p>
        {slow && (
          <p className="rounded-lg bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
            최신 원문 확인과 답변 검증에 시간이 조금 더 걸리고 있어요. 국가법령정보센터 응답이 늦으면 수집해 둔 공식 원문으로 먼저 보여 드리고, AI 답변이 검증을 통과하지 못하면 검수된 답변으로 안내해요.
          </p>
        )}
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
