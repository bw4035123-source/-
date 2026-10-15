/** 메인 검색 추천 해시태그 — 시민: 생활 상황 / 공무원: 실무 업무(처리기간 산정·불복 처리·행정처분 기준 등) */
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
  { label: "민원 처리기간 산정", query: "질의민원·고충민원 처리기간 산정과 연장 통지 기준", topic: "petition-deadline" },
  { label: "법정민원 거부·이의신청", query: "법정민원 거부처분 이의신청 기한과 결정 기간", topic: "petition-deadline" },
  { label: "정보공개 결정·연장 통지", query: "정보공개 청구 결정기한 연장 통지와 이의신청 처리 기한", topic: "info-disclosure" },
  { label: "개인정보 열람 처리", query: "개인정보 열람 요구 처리 기한과 연기·거절 통지", topic: "privacy-access" },
  { label: "행정심판 청구기간 판단", query: "행정심판 청구기간 90일 180일 기산과 불복 고지", topic: "admin-appeal" },
  { label: "층간소음 민원 처리절차", query: "층간소음 민원 관리주체 조치와 층간소음관리위원회 분쟁조정 안내", topic: "floor-noise" },
  { label: "확정일자·최우선변제 안내", query: "전입신고 확정일자 창구 안내와 소액임차인 최우선변제 기준 금액", topic: "jeonse-fraud" },
  { label: "음주운전 행정처분 기준", query: "음주운전 면허 취소·정지 행정처분 기준과 벌점", topic: "drunk-driving" },
  { label: "체불임금 진정 처리", query: "임금체불 진정 접수 시 금품청산 기한과 벌칙 안내", topic: "unpaid-wages" },
  { label: "육아휴직 급여 산정", query: "육아휴직 급여 월 지급액 상한액 산정 기준", topic: "parental-leave" },
];
