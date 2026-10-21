import type { UserMode } from "./types";

/** 이어서 묻기 추천 질문(화면·서버 공용) — Python 판 followup.py 와 같은 목록 */
export const FOLLOWUP_SUGGESTIONS: Record<UserMode, string[]> = {
  citizen: ["기한이 있나요?", "어디에 신고·상담하나요?", "무엇을 준비해야 하나요?", "어기면 처벌받나요?", "예외가 있나요?"],
  officer: ["기한·기간 기준은?", "위반 시 제재는?", "필요 서류와 절차는?", "관련 신고·구제 경로는?", "예외 규정은?"],
};
