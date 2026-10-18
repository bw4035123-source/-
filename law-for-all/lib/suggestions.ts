/** 메인 검색 추천 해시태그 — 국민: 생활 상황 / 공직자: 실무 핵심 법령(근로기준법·지방공기업법·공직선거법·청탁금지법·공유재산법) */
export interface Suggestion {
  label: string;
  query: string;
  /** 이 질문이 연결돼야 하는 토픽(테스트로 보장) */
  topic: string;
}

export const CITIZEN_SUGGESTIONS: Suggestion[] = [
  { label: "층간소음", query: "윗집 층간소음 기준이 어떻게 되나요?", topic: "floor-noise" },
  { label: "전세사기 예방", query: "전세 계약할 때 전세사기 예방하려면 뭘 확인해야 하나요?", topic: "jeonse-fraud" },
  { label: "보증금 반환", query: "계약이 끝났는데 집주인이 보증금을 안 돌려줘요", topic: "deposit-return" },
  { label: "육아휴직 급여", query: "육아휴직 급여는 얼마나 받을 수 있나요?", topic: "parental-leave" },
  { label: "민원 처리 기한", query: "민원 처리 기한은 며칠인가요?", topic: "petition-deadline" },
  { label: "임금체불", query: "퇴사했는데 마지막 월급을 안 줘요", topic: "unpaid-wages" },
  { label: "음주운전 처벌", query: "음주운전 처벌 기준이 궁금해요", topic: "drunk-driving" },
  { label: "정보공개 청구", query: "정보공개 청구하면 언제까지 결정해야 하나요?", topic: "info-disclosure" },
];

export const OFFICER_SUGGESTIONS: Suggestion[] = [
  { label: "근로기준법", query: "취업규칙(사규)의 근로시간·연장근로·연차휴가 기준이 근로기준법에 맞는지 검토", topic: "work-rules" },
  { label: "지방공기업법", query: "지방공기업법상 지방공사 사장·이사·감사 임기와 임원추천위원회 절차", topic: "local-public-enterprise" },
  { label: "공직선거법", query: "공직선거법상 선거기간 중 공무원·공사 상근 임원의 행사·출장·홍보 제한", topic: "election-neutrality" },
  { label: "부정청탁금지법", query: "부정청탁금지법상 공기업 임직원 금품수수 금지 기준과 외부강의 신고", topic: "anti-graft" },
  { label: "공유재산법", query: "공유재산법상 행정재산 사용허가기간과 일반재산 대부기간 상한", topic: "public-property" },
];
