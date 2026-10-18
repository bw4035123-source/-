"use client";
import * as React from "react";
import { useCitations } from "./citation-context";
import { articleLabel } from "@/lib/law-api/util";

const MARKER = /\[\[([^\]\s]+)\]\]/g;

/** "[[lawId:no]]" 인용 표식을 번호 앵커 버튼으로 렌더링(클릭 시 원문 슬라이드 오버) */
export function CitedText({ text, className }: { text: string; className?: string }) {
  const { citations, indexOf, open } = useCitations();
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of Array.from(text.matchAll(MARKER))) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const key = m[1];
    const i = indexOf(key);
    if (i >= 0) {
      const c = citations[i];
      parts.push(
        <button
          key={`${key}-${m.index}`}
          type="button"
          onClick={() => open(key)}
          className="mx-0.5 inline-flex -translate-y-0.5 items-center rounded-md bg-accent/15 px-1.5 py-0 align-baseline text-[0.72em] font-bold text-accent ring-1 ring-accent/25 transition hover:bg-accent hover:text-accent-foreground"
          aria-label={`근거 ${i + 1}: ${c.lawName} ${articleLabel(c.articleNo)} 원문 보기`}
          title={`${c.lawName} ${articleLabel(c.articleNo)}(${c.title})`}
        >
          {i + 1}
        </button>,
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}

/** 문장 단위로 나누고 각 문장의 근거 표식을 모음(표식은 문장 끝·마침표 앞뒤 어디에 있어도 됨) */
export function splitCitedSentences(text: string): { keys: string[]; text: string }[] {
  // "…요. [[k]]" 처럼 마침표 뒤에 붙은 표식을 마침표 앞으로 옮겨 같은 문장에 묶음
  const norm = text.replace(/([.?!])\s*((?:\[\[[^\]\s]+\]\]\s*)+)/g, " $2$1 ");
  return norm
    .split(/(?<=[.?!])\s+(?=\S)/)
    .map((raw) => ({
      keys: Array.from(new Set(Array.from(raw.matchAll(MARKER), (m) => m[1]))),
      text: raw.replace(MARKER, "").replace(/\s+([.,?!])/g, "$1").replace(/\s{2,}/g, " ").trim(),
    }))
    .filter((x) => x.text);
}

/** 문장마다 한 줄, 근거 번호를 문장 앞에 두는 형식(번호 칸 너비를 맞춰 글머리가 가지런하게) */
export function CitedLines({ text, className }: { text: string; className?: string }) {
  const { citations, indexOf, open } = useCitations();
  const lines = splitCitedSentences(text);
  return (
    <ol className={className}>
      {lines.map((l, li) => {
        const nums = l.keys.map((k) => ({ k, i: indexOf(k) })).filter((x) => x.i >= 0);
        return (
          <li key={li} className="flex items-start gap-2.5">
            <span className="flex min-w-[1.75rem] shrink-0 justify-end gap-1 pt-[0.2em]">
              {nums.length ? (
                nums.map(({ k, i }) => {
                  const c = citations[i];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => open(k)}
                      className="grid h-6 min-w-6 place-items-center rounded-md bg-accent/15 px-1.5 text-xs font-bold text-accent ring-1 ring-accent/25 transition hover:bg-accent hover:text-accent-foreground"
                      aria-label={`근거 ${i + 1}: ${c.lawName} ${articleLabel(c.articleNo)} 원문 보기`}
                      title={`${c.lawName} ${articleLabel(c.articleNo)}(${c.title})`}
                    >
                      {i + 1}
                    </button>
                  );
                })
              ) : (
                <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-accent/50" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">{l.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const stripMarkers = (t: string) => t.replace(MARKER, "").replace(/\s+([.,])/g, "$1").trim();
