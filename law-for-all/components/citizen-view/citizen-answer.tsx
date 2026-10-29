"use client";
import { motion } from "framer-motion";
import { BookA, Footprints, Lightbulb, MessageCircleHeart, Signpost, Sparkles } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { CitedLines, CitedText } from "@/components/law-search/cited-text";
import { useCitations } from "@/components/law-search/citation-context";
import { articleLabel } from "@/lib/law-api/util";

const STEP_COLORS = ["from-sage-500 to-sage-600", "from-sky-500 to-indigo-500", "from-amber-500 to-orange-500"];

/** 국민 모드 답변 — 쉬운 말풍선 요약, 용어 카드, 3단계 행동 가이드 */
export function CitizenAnswer({ result }: { result: AskResult }) {
  const { citations, open } = useCitations();
  const c = result.citizen;
  return (
    <div className="space-y-6">
      {/* 말풍선 요약 */}
      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3" aria-label="핵심 요약">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sage-500 to-sage-700 text-white shadow-md" aria-hidden>
          <MessageCircleHeart className="h-6 w-6" />
        </div>
        <div className="relative flex-1 rounded-2xl rounded-tl-sm border-2 border-sage-200 bg-sage-50 p-5 shadow-sm dark:border-sage-800 dark:bg-sage-800/20">
          <p className="mb-1 flex items-center gap-1 text-xs font-bold text-sage-700 dark:text-sage-400">
            <Sparkles className="h-3.5 w-3.5" /> 법도우미가 쉽게 알려드려요
          </p>
          {/* 문장마다 한 줄, 근거 번호가 문장 앞 */}
          <CitedLines text={result.summary} className="space-y-2 text-[1.05rem] leading-8" />
        </div>
      </motion.section>

      {/* 쉬운 용어 풀이 */}
      {c && c.easyTerms.length > 0 && (
        <section aria-labelledby="terms-h">
          <h2 id="terms-h" className="mb-3 flex items-center gap-2 text-lg font-extrabold">
            <BookA className="h-5 w-5 text-accent" /> 어려운 말, 쉽게 풀어볼게요
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.easyTerms.map((t, i) => (
              <motion.div
                key={t.term}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.06 }}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <p className="font-bold text-accent">{t.term}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/85">{t.meaning}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* 3단계 행동 가이드 */}
      {c && c.steps.length > 0 && (
        <section aria-labelledby="steps-h">
          <h2 id="steps-h" className="mb-3 flex items-center gap-2 text-lg font-extrabold">
            <Footprints className="h-5 w-5 text-accent" /> 지금 이렇게 하세요 · {c.steps.length}단계
          </h2>
          <ol className="relative space-y-4">
            {c.steps.map((s, i) => {
              const ref = s.ref ? citations.find((x) => x.key === s.ref) : undefined;
              return (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.1 }}
                  className="relative flex gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm"
                >
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${STEP_COLORS[i % 3]} text-xl font-black text-white shadow`} aria-hidden>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">STEP {i + 1}</p>
                    <h3 className="text-base font-extrabold">{s.title}</h3>
                    <p className="mt-1 leading-7 text-foreground/85">
                      <CitedText text={s.detail} />
                    </p>
                    {ref && (
                      <button type="button" onClick={() => open(ref.key)} className="mt-2 text-xs font-semibold text-accent underline-offset-2 hover:underline">
                        근거: {ref.lawName} {articleLabel(ref.articleNo)}
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </section>
      )}

      {/* 이런 경우라면 — 같은 주제 안의 구체적 상황별 안내(검수된 문장, 질문에 맞는 것이 앞) */}
      {c?.cases && c.cases.length > 0 && (
        <section aria-labelledby="cases-h">
          <h2 id="cases-h" className="mb-3 flex items-center gap-2 text-lg font-extrabold">
            <Signpost className="h-5 w-5 text-accent" /> 이런 경우라면
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.cases.map((x, i) => {
              const ref = x.ref ? citations.find((y) => y.key === x.ref) : undefined;
              return (
                <motion.div
                  key={x.situation}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                  className={`rounded-xl border bg-card p-4 shadow-sm ${i === 0 ? "border-accent/50 sm:col-span-2" : ""}`}
                >
                  <p className="font-bold text-accent">{x.situation}</p>
                  <p className="mt-1 text-sm leading-7 text-foreground/85">
                    <CitedText text={x.detail} />
                  </p>
                  {ref && (
                    <button type="button" onClick={() => open(ref.key)} className="mt-1 text-xs font-semibold text-accent underline-offset-2 hover:underline">
                      근거: {ref.lawName} {articleLabel(ref.articleNo)}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {c?.tip && (
        <motion.aside
          initial={{ opacity: 0, rotate: -1 }}
          animate={{ opacity: 1, rotate: 0 }}
          className="flex gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100"
        >
          <Lightbulb className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          <p className="text-sm leading-6">
            <strong>꼭 알아두세요 · </strong>
            <CitedText text={c.tip} />
          </p>
        </motion.aside>
      )}
    </div>
  );
}
