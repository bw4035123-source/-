"use client";
import { useRouter } from "next/navigation";
import { Briefcase, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";

/** 국민 모드 ↔ 공직자 모드 토글 — 바꾸면 그 모드의 첫 화면으로 */
export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useSettings();
  const router = useRouter();
  const officer = mode === "officer";
  const switchTo = (m: typeof mode) => {
    if (m === mode) return;
    setMode(m);
    router.push("/");
    window.scrollTo(0, 0);
  };
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2 py-1.5 sm:gap-2 sm:px-3", className)}>
      <button type="button" onClick={() => switchTo("citizen")} className={cn("flex items-center gap-1 text-xs font-bold sm:text-sm", !officer ? "text-accent" : "text-muted-foreground")} aria-pressed={!officer}>
        <Users className="h-4 w-4" aria-hidden />
        국민
      </button>
      <Switch checked={officer} onCheckedChange={(v) => switchTo(v ? "officer" : "citizen")} aria-label="공직자 모드 전환" />
      <button type="button" onClick={() => switchTo("officer")} className={cn("flex items-center gap-1 text-xs font-bold sm:text-sm", officer ? "text-accent" : "text-muted-foreground")} aria-pressed={officer}>
        <Briefcase className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">공직자</span>
        <span className="sm:hidden">공직</span>
      </button>
    </div>
  );
}
