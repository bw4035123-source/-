import type { OrgType } from "@/lib/compliance";

/** 심사·시연용 모의 규정 파일(submission/mock-data 와 같은 파일, public/mock 에 둠) — 누르면 실제 파일 읽기부터 교차 검증까지 한 번에 */
export const MOCK_FILES: { label: string; format: string; file: string; url: string; orgType: OrgType }[] = [
  { label: "가상시설관리공단 복무 및 보수 규정", format: "HWPX", file: "가상시설관리공단_복무및보수규정(모의).hwpx", url: "/mock/mock-1.hwpx", orgType: "지방공기업" },
  { label: "가상도시개발공사 임직원 행동강령", format: "DOCX", file: "가상도시개발공사_임직원행동강령(모의).docx", url: "/mock/mock-2.docx", orgType: "공기업·준정부기관" },
  { label: "가상군 공유재산 사용허가 운영지침", format: "PDF", file: "가상군_공유재산사용허가운영지침(모의).pdf", url: "/mock/mock-3.pdf", orgType: "지방자치단체" },
];
