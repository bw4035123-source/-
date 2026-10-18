"use client";
import { useSettings, type FontScale } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";

const SCALES: { v: FontScale; label: string; aria: string }[] = [
  { v: 1, label: "가", aria: "기본 글자 크기" },
  { v: 1.15, label: "가+", aria: "큰 글자" },
  { v: 1.3, label: "가++", aria: "아주 큰 글자" },
];

/** 접근성 도구: 글자 크기 */
export function A11yControls({ className }: { className?: string }) {
  const { fontScale, setFontScale } = useSettings();
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} role="group" aria-label="보기 설정">
      <div className="flex shrink-0 rounded-full border bg-card p-0.5">
        {SCALES.map((s) => (
          <button
            key={s.v}
            type="button"
            onClick={() => setFontScale(s.v)}
            aria-pressed={fontScale === s.v}
            aria-label={s.aria}
            className={cn("whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold", fontScale === s.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
