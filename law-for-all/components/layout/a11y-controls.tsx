"use client";
import { Contrast, Moon, Sun } from "lucide-react";
import { useSettings, type FontScale } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";

const SCALES: { v: FontScale; label: string; aria: string }[] = [
  { v: 1, label: "가", aria: "기본 글자 크기" },
  { v: 1.15, label: "가+", aria: "큰 글자" },
  { v: 1.3, label: "가++", aria: "아주 큰 글자" },
];

/** 접근성 도구: 글자 크기(어르신 배려)·고대비·다크 모드 */
export function A11yControls({ className }: { className?: string }) {
  const { fontScale, setFontScale, highContrast, setHighContrast, dark, setDark } = useSettings();
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
      <button
        type="button"
        onClick={() => setHighContrast(!highContrast)}
        aria-pressed={highContrast}
        aria-label="고대비 모드"
        title="고대비 모드"
        className={cn("rounded-full border p-1.5", highContrast ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
      >
        <Contrast className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setDark(!dark)}
        aria-pressed={dark}
        aria-label="어두운 화면"
        title="어두운 화면"
        className="rounded-full border bg-card p-1.5 text-muted-foreground hover:text-foreground"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}
