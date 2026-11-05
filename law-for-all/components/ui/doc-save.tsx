"use client";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadDoc, type DocFormat } from "@/lib/word-export";
import type { DocSection } from "@/lib/doc-export/model";

/** 한글·Word 저장 버튼 한 쌍 — 누를 때 sections() 로 내용을 만들어 내려받음 */
export function DocSaveButtons({ name, sections, label = "", size = "sm", variant = "outline", accent }: { name: string; sections: () => DocSection[]; label?: string; size?: "sm" | "default"; variant?: "outline" | "accent"; accent?: DocFormat }) {
  const btn = (f: DocFormat, text: string) => (
    <Button key={f} size={size} variant={accent === f ? "accent" : variant} onClick={() => void downloadDoc(name, sections(), f)} title={f === "hwpx" ? "한글(HWPX) 파일 — 한글 2014 이상" : "Word(DOCX) 파일 — MS Word·한글에서 열림"}>
      <FileDown /> {label}{text}
    </Button>
  );
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {btn("hwpx", "한글")}
      {btn("docx", "Word")}
    </span>
  );
}
