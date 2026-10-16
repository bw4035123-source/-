"use client";
import { Briefcase, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";

/** 국민 모드 ↔ 공직자·공기업 모드 토글 */
export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useSettings();
  const officer = mode === "officer";
  return (
    <div className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-3 py-1.5", className)}>
      <button type="button" onClick={() => setMode("citizen")} className={cn("flex items-center gap-1 text-xs font-bold sm:text-sm", !officer ? "text-accent" : "text-muted-foreground")} aria-pressed={!officer}>
        <Users className="h-4 w-4" aria-hidden />
        국민
      </button>
      <Switch checked={officer} onCheckedChange={(v) => setMode(v ? "officer" : "citizen")} aria-label="공직자·공기업 모드 전환" />
      <button type="button" onClick={() => setMode("officer")} className={cn("flex items-center gap-1 text-xs font-bold sm:text-sm", officer ? "text-accent" : "text-muted-foreground")} aria-pressed={officer}>
        <Briefcase className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">공직자·공기업</span>
        <span className="sm:hidden">공직</span>
      </button>
    </div>
  );
}
