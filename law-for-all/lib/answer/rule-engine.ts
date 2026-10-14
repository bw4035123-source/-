import type { Citation } from "../law-api/types";
import type { Topic } from "../law-api/mock/topics";
import { articleLabel } from "../law-api/util";
import type { CitizenAnswer, OfficerAnswer } from "./types";

/** 조문 첫 문장(항 번호 제거) */
function firstSentence(text: string, max = 90): string {
  const line = text.split("\n")[0].replace(/^[①-⑳]\s*/, "");
  const s = line.split(/(?<=다\.)\s/)[0];
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * 규칙기반 답변 조립 — 토픽 사전(사람이 검수한 문장) 또는 검색된 조문 원문만 사용.
 */
export function buildRuleAnswer(query: string, topic: Topic | undefined, citations: Citation[]): { summary: string; citizen: CitizenAnswer; officer: OfficerAnswer } {
  if (topic) {
    return {
      summary: topic.citizen.summary,
      citizen: { easyTerms: topic.citizen.easyTerms, steps: topic.citizen.steps, tip: topic.citizen.tip },
      officer: {
        background: topic.officer.background,
        keyPoints: topic.officer.keyPoints,
        adminNotes: topic.officer.adminNotes,
        checklist: topic.officer.checklist,
      },
    };
  }

  if (!citations.length) {
    return {
      summary: `'${query}'와(과) 직접 관련된 조문을 내장 법령 데이터에서 찾지 못했어요. 더 구체적인 상황(예: "전세 보증금", "육아휴직 급여", "민원 처리 기한")으로 다시 검색해 보세요.`,
      citizen: {
        easyTerms: [],
        steps: [
          { title: "검색어 바꿔 보기", detail: "상황을 나타내는 핵심 단어(누가·무엇을·어떻게)를 넣어 다시 검색해 보세요." },
          { title: "정부민원안내콜센터 문의", detail: "어느 기관 소관인지 모를 때는 110으로 전화하면 담당 기관을 안내받을 수 있어요." },
          { title: "무료 법률상담", detail: "대한법률구조공단(132)에서 무료 법률상담을 받을 수 있어요." },
        ],
      },
      officer: {
        background: "내장 데이터 범위에서 관련 조문이 검색되지 않음. 국가법령정보 Open API(OC) 연동 시 전체 법령에서 검색 가능.",
        keyPoints: [],
        adminNotes: ["소관 법령이 불분명한 경우 법제처 법령해석 및 소관 부처 질의 검토"],
        checklist: ["검색어 재설정", "소관 부처 확인"],
      },
    };
  }

  const top = citations.slice(0, 3);
  const list = top.map((c) => `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title}) [[${c.key}]]`).join(", ");
  return {
    summary: `질문과 관련된 조문으로 ${list}이(가) 확인돼요. 핵심 내용은 다음과 같아요: ${firstSentence(top[0].text)} [[${top[0].key}]]`,
    citizen: {
      easyTerms: [],
      steps: [
        { title: "근거 조문 원문 확인", detail: "오른쪽 근거 조문 카드를 눌러 원문 전체를 확인하세요.", ref: top[0].key },
        { title: "담당 기관 상담", detail: "정부민원안내콜센터(110)에 문의하면 소관 기관을 안내받을 수 있어요." },
        { title: "전문가 도움 받기", detail: "분쟁이 생겼다면 대한법률구조공단(132)의 무료 법률상담을 이용하세요." },
      ],
    },
    officer: {
      background: `검색된 관련 근거: ${top.map((c) => `「${c.lawName}」 ${articleLabel(c.articleNo)}`).join(", ")}.`,
      keyPoints: top.map((c) => `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title}): ${firstSentence(c.text)} [[${c.key}]]`),
      adminNotes: ["규칙기반 검색 결과이므로 하위법령·행정규칙 및 최신 개정 여부를 원문에서 확인할 것"],
      checklist: ["현행 조문 확인", "하위법령 위임사항 확인", "관련 판례·해석례 확인"],
    },
  };
}
