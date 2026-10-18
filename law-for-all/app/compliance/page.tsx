import type { Metadata } from "next";
import { Suspense } from "react";
import { ModeGate } from "@/components/layout/mode-gate";
import { ComplianceView } from "@/components/compliance/compliance-view";

export const metadata: Metadata = { title: "자체규정 점검", description: "우리 기관 규정을 근로기준법·청탁금지법·공직선거법·지방공기업법·공유재산법과 조문 단위로 대조합니다." };

export default function CompliancePage() {
  return (
    <Suspense>
      <ModeGate mode="officer" feature="자체규정 점검">
        <ComplianceView />
      </ModeGate>
    </Suspense>
  );
}
