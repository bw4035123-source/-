"use client";
import * as React from "react";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { ACCEPT, ExtractError, extractText, type Extracted } from "@/lib/doc-extract";
import { cn } from "@/lib/utils";

/**
 * 규정 파일 끌어다 놓기(한글 HWP·HWPX · PDF · Word DOCX) — 파일은 서버로 보내지 않고 이 브라우저에서 글만 꺼냄(lib/doc-extract).
 * 자체규정 점검과 같은 읽기 방식. compact 는 한 줄짜리(개정 화면처럼 입력칸 위에 두는 곳)
 */
export function RegFileDrop({ onLoaded, compact, hint, className }: { onLoaded: (r: { name: string; info: Extracted }) => void; compact?: boolean; hint?: string; className?: string }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [reading, setReading] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const read = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    setReading(f.name);
    try {
      onLoaded({ name: f.name, info: await extractText(f) });
    } catch (e) {
      setError(e instanceof ExtractError ? e.message : "문서를 읽지 못했어요. 내용을 복사해 붙여 넣어 주세요.");
    } finally {
      setReading(null);
    }
  };

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="규정 파일 올리기: 한글, PDF, Word 파일을 끌어다 놓거나 눌러서 선택"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileRef.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void read(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "px-3 py-3" : "flex-col px-4 py-5",
          dragging ? "border-accent bg-accent/10" : "border-muted-foreground/30 bg-secondary/30 hover:border-accent hover:bg-accent/5",
        )}
      >
        {reading ? (
          <>
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
            <p className="text-sm font-semibold">‘{reading}’ 읽는 중…</p>
          </>
        ) : (
          <>
            <FileUp className={cn("h-5 w-5 shrink-0", dragging ? "text-accent" : "text-muted-foreground")} />
            <div className={compact ? "text-left" : undefined}>
              <p className="text-sm font-semibold">{dragging ? "여기에 놓으세요" : "규정 파일을 끌어다 놓거나 눌러서 선택"}</p>
              <p className="text-[11px] leading-5 text-muted-foreground">
                <span className="ko-phrase">한글(HWP·HWPX) · PDF · Word</span> <span className="ko-phrase">— {hint ?? "파일은 서버로 보내지 않고 이 브라우저에서 읽어요"}</span>
              </p>
            </div>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
