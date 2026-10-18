"use client";
import { motion } from "framer-motion";
import { CheckSquare, ClipboardList, FileWarning, Landmark, Scale } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { CitedText } from "@/components/law-search/cited-text";

function Section({ no, title, icon: Icon, children }: { no: string; title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 flex items-center gap-2 font-bold text-primary">
        <span className="font-serif text-accent">{no}.</span>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      <div className="pl-6 leading-7">{children}</div>
    </section>
  );
}

/** 공직자 모드 답변 — 행정 요약 보고서 형식 */
export function OfficerReport({ result }: { result: AskResult }) {
  const o = result.officer;
  const today = new Date(result.generatedAt).toLocaleDateString("ko-KR");
  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="법령 검토 요약 보고서">
      <header className="border-b bg-navy-700 px-6 py-4 text-white dark:bg-navy-800">
        <p className="text-xs font-semibold tracking-widest text-navy-200">법령 검토 요약 보고</p>
        <h2 className="mt-1 text-lg font-extrabold leading-snug">{result.topic?.label ?? result.query}</h2>
        <p className="mt-1 text-xs text-navy-200">
          작성일 {today} · 근거 조문 {result.citations.length}건 · {result.provider.label}
        </p>
      </header>
      <div className="space-y-5 p-6 text-[0.95rem]">
        <Section no="1" title="검토 결론" icon={Scale}>
          <p>
            <CitedText text={result.summary} />
          </p>
        </Section>
        {o && (
          <>
            {o.background && (
              <Section no="2" title="법적 근거 체계" icon={Landmark}>
                <p>
                  <CitedText text={o.background} />
                </p>
              </Section>
            )}
            {o.keyPoints.length > 0 && (
              <Section no="3" title="주요 쟁점(요건·기한·금액)" icon={ClipboardList}>
                <ul className="list-disc space-y-1.5 pl-4 marker:text-accent">
                  {o.keyPoints.map((k, i) => (
                    <li key={i}>
                      <CitedText text={k} />
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {o.adminNotes.length > 0 && (
              <Section no="4" title="업무 처리 유의사항" icon={FileWarning}>
                <ul className="list-disc space-y-1.5 pl-4 marker:text-accent">
                  {o.adminNotes.map((k, i) => (
                    <li key={i}>
                      <CitedText text={k} />
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {o.checklist.length > 0 && (
              <Section no="5" title="처리 전 확인 체크리스트" icon={CheckSquare}>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {o.checklist.map((k, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-secondary">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--accent))]" />
                        <span>{k}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </motion.article>
  );
}
