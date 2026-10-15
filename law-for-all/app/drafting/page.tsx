import type { Metadata } from "next";
import { Suspense } from "react";
import { ModeGate } from "@/components/layout/mode-gate";
import { DraftingView } from "@/components/drafting/drafting-view";

export const metadata: Metadata = { title: "규정 제·개정 지원", description: "개정 방향만 적으면 개정안·신구조문대비표·정합성 점검·개정이유·부칙·입법예고문 초안을 한 번에 만듭니다." };

export default function DraftingPage() {
  return (
    <Suspense>
      <ModeGate mode="officer" feature="규정 제·개정 지원">
        <DraftingView />
      </ModeGate>
    </Suspense>
  );
}
