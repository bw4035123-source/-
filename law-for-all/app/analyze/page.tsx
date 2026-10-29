import type { Metadata } from "next";
import { Suspense } from "react";
import { ModeGate } from "@/components/layout/mode-gate";
import { AnalyzeView } from "@/components/case-analysis/analyze-view";

export const metadata: Metadata = { title: "법률 상황 분석실", description: "상황을 이야기하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 분석합니다." };

export default function AnalyzePage() {
  return (
    <Suspense>
      <ModeGate mode="citizen" feature="법률 상황 분석실">
        <AnalyzeView />
      </ModeGate>
    </Suspense>
  );
}
