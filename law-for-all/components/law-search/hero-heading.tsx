"use client";
import { motion } from "framer-motion";
import { useSettings } from "@/components/providers/settings-provider";

export function HeroHeading() {
  const { mode } = useSettings();
  const officer = mode === "officer";
  return (
    <motion.div key={mode} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <p className="mx-auto inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-bold text-accent shadow-sm">
        {officer ? "공직자 모드" : "국민 모드"} · AI 법률 지능형 포털
      </p>
      <h1 className="mt-5 text-balance text-3xl font-black leading-tight tracking-tight sm:text-5xl">
        {officer ? (
          <>
            정확한 근거로,
            <br className="sm:hidden" /> <span className="bg-gradient-to-r from-navy-700 to-sage-600 bg-clip-text text-transparent dark:from-white dark:to-sage-400">빠른 행정 판단</span>
          </>
        ) : (
          <>
            법은 가깝게,
            <br className="sm:hidden" /> <span className="bg-gradient-to-r from-navy-700 to-sage-600 bg-clip-text text-transparent dark:from-white dark:to-sage-400">권리는 든든하게.</span>
          </>
        )}
      </h1>
      {/* 의미 단위로 줄을 나눠 가운데 정렬 — 좁은 화면에서는 각 줄이 낱말 단위로 고르게 다시 나뉨 */}
      <p className="mx-auto mt-5 max-w-3xl text-balance text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9">
        {(officer
          ? ["근거 조문·판례 검토부터 우리 기관 규정 검증까지,", "검토 보고서·기안문과 규정 제·개정 초안을 한 곳에서 처리하세요."]
          : ["어려운 법률을 일상의 언어로 연결합니다.", "궁금한 상황을 물어보면 관련 법 조항과 판례, 해야 할 일을 차근차근 알려드려요."]
        ).map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </p>
    </motion.div>
  );
}
