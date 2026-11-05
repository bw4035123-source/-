"use client";
import { FileDown } from "lucide-react";
import { downloadDoc, type DocFormat } from "@/lib/word-export";
import type { DocSection } from "@/lib/doc-export/model";
import { cn } from "@/lib/utils";

/**
 * 한글·Word 저장 — 한 덩어리 단추([⤓ 이름 | 한글 | Word]). 누를 때 sections() 로 내용을 만들어 내려받음.
 * 휴대폰에서는 줄 너비를 채우고, 넓은 화면에서는 내용만큼
 */
export function DocSaveButtons({ name, sections, label = "", size = "sm", accent, className }: { name: string; sections: () => DocSection[]; label?: string; size?: "sm" | "default"; variant?: "outline" | "accent"; accent?: DocFormat; className?: string }) {
  const title = label.trim().replace(/\s*저장$/, "") || "저장";
  const h = size === "sm" ? "h-9" : "h-10";
  const part = (f: DocFormat, text: string) => (
    <button
      key={f}
      type="button"
      onClick={() => void downloadDoc(name, sections(), f)}
      title={f === "hwpx" ? "한글(HWPX) 파일 — 한글 2014 이상" : "Word(DOCX) 파일 — MS Word·한글에서 열림"}
      aria-label={`${title} ${f === "hwpx" ? "한글" : "Word"} 파일로 저장`}
      className={cn("border-l px-3 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", accent === f && "bg-accent text-accent-foreground hover:bg-accent/90")}
    >
      {text}
    </button>
  );
  return (
    <span className={cn("flex w-full items-stretch overflow-hidden rounded-md border bg-card sm:inline-flex sm:w-auto", h, className)} role="group" aria-label={`${title} 내려받기`}>
      <span className="flex flex-1 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs font-semibold text-muted-foreground sm:flex-none">
        <FileDown className="h-4 w-4" aria-hidden /> {title}
      </span>
      {part("hwpx", "한글")}
      {part("docx", "Word")}
    </span>
  );
}
