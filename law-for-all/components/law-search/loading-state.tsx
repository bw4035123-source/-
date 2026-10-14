"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const STEPS = ["질문의 의도를 분석하고 있어요", "관련 법령·조문을 찾고 있어요", "원문과 대조해 근거를 검증하고 있어요", "이해하기 쉽게 정리하고 있어요"];

export function LoadingState() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, STEPS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" role="status" aria-live="polite">
      <div className="space-y-4">
        <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 font-semibold text-accent">
          <Loader2 className="h-5 w-5 animate-spin" /> {STEPS[i]}…
        </motion.p>
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
