import type { Metadata } from "next";
import { Suspense } from "react";
import { CasesView } from "@/components/cases/cases-view";

export const metadata: Metadata = { title: "판례 보기", description: "국가법령정보센터 판례·법령해석례를 검색하고 판시사항·판결요지·전문을 확인합니다." };

export default function CasesPage() {
  return (
    <Suspense>
      <CasesView />
    </Suspense>
  );
}
