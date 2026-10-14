import type { Metadata } from "next";
import { MOCK_LAWS, getMockLaw } from "@/lib/law-api/mock";
import { LawPageClient } from "@/components/officer-view/law-page-client";

/** 내장 법령은 미리 생성(정적 배포·Python 서버용), 그 외(mst-…)는 서버가 placeholder("_") 페이지로 응답 */
export function generateStaticParams() {
  return [...MOCK_LAWS.map((l) => ({ id: l.id })), { id: "_" }];
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { title: getMockLaw(params.id)?.name ?? "법령 본문" };
}

export default function LawPage() {
  return <LawPageClient />;
}
