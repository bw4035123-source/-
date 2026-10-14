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

export const stripMarkers = (t: string) => t.replace(MARKER, "").replace(/\s+([.,])/g, "$1").trim();
