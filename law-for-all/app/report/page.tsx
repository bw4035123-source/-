import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportView } from "@/components/citizen-view/report-view";

export const metadata: Metadata = { title: "법률 리포트" };

export default function ReportPage() {
  return (
    <Suspense>
      <ReportView />
    </Suspense>
  );
}
