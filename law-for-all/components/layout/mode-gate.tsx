"use client";
import * as React from "react";
import { Briefcase, Users } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";
import { Button } from "@/components/ui/button";
import type { UserMode } from "@/lib/answer/types";

const LABEL: Record<UserMode, string> = { citizen: "국민 모드", officer: "공직자 모드" };

/** 특정 모드 전용 화면 — 다른 모드에서 열면 안내와 전환 버튼 표시 */
export function ModeGate({ mode, feature, children }: { mode: UserMode; feature: string; children: React.ReactNode }) {
  const { mode: current, setMode, ready } = useSettings();
  if (!ready) return null;
  if (current === mode) return <>{children}</>;
  const Icon = mode === "citizen" ? Users : Briefcase;
  return (
    <div className="container max-w-xl py-24 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-extrabold">{feature}은(는) {LABEL[mode]} 전용 기능이에요</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        현재 {LABEL[current]}입니다. {mode === "citizen" ? "생활 속 법률 상황을 변호사·검사·판사의 시각으로 살펴보는 기능은 국민 모드에서 제공해요." : "우리 기관 규정 검증·규정 제·개정 같은 실무 기능은 공직자 모드에서 제공해요."}
      </p>
      <Button variant="accent" size="lg" className="mt-6" onClick={() => setMode(mode)}>
        <Icon /> {LABEL[mode]}로 전환
      </Button>
    </div>
  );
}

/** 현재 모드에서만 보이는 요소 */
export function OnlyMode({ mode, children }: { mode: UserMode; children: React.ReactNode }) {
  const { mode: current, ready } = useSettings();
  return ready && current === mode ? <>{children}</> : null;
}
