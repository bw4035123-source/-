import type { Citation } from "../law-api/types";
import type { Topic } from "../law-api/mock/topics";
import { articleLabel } from "../law-api/util";
import { normalize, queryTerms, scoreArticleByTerms } from "../law-api/search";
import type { CitizenAnswer, OfficerAnswer } from "./types";

/** 조문 첫 문장(항 번호 제거) */
function firstSentence(text: string, max = 90): string {
  const line = text.split("\n")[0].replace(/^[①-⑳]\s*/, "");
  const s = line.split(/(?<=다\.)\s/)[0];
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 질문이 토픽 안의 특정 조문을 제목으로 가리키는데(예: '외부강의 사례금' → 청탁금지법 제10조) 토픽 요약이 그 조문을 다루지 않으면 앞에 붙일 문장 */
/** 조문에 붙은 별표 요지의 첫 줄(없으면 빈 문자열) */
const byeolpyo = (c: Citation) => c.text.split("\n").find((l) => l.startsWith("[별표")) ?? "";

function pinpoint(query: string, topic: Topic, citations: Citation[]): string {
  const terms = queryTerms(query).filter((t) => t.length >= 3 && !normalize(topic.label).includes(normalize(t)));
  // 흔한 말 하나('보증금'·'과태료')로는 붙이지 않음: 질문 낱말 두 개 이상이 제목에 있거나 제목 자체가 그 말일 때만(토픽 조문 안에서)
  const inTitle = (c: Citation) => terms.filter((t) => normalize(c.title).includes(normalize(t)) && !normalize(c.lawName).includes(normalize(t)));
  const hit = citations
    .filter((c) => topic.refs.includes(c.key) && (inTitle(c).length >= 2 || inTitle(c).some((t) => normalize(t) === normalize(c.title))))
    // 금액·기준이 든 별표 요지가 있는 조문(시행령)을 우선 — "상한은?" 같은 질문에 실제 금액으로 답함
    .sort((a, b) => scoreArticleByTerms(b, terms) + (byeolpyo(b) ? 10 : 0) - scoreArticleByTerms(a, terms) - (byeolpyo(a) ? 10 : 0))[0];
  if (!hit || topic.citizen.summary.includes(`[[${hit.key}]]`)) return "";
  const table = byeolpyo(hit);
  return `「${hit.lawName}」 ${articleLabel(hit.articleNo)}(${hit.title}): ${firstSentence(hit.text, 220)}${table ? ` ${table}` : ""} [[${hit.key}]] `;
}

/**
 * 규칙기반 답변 조립 — 토픽 사전(사람이 검수한 문장) 또는 검색된 조문 원문만 사용.
 */
export function buildRuleAnswer(query: string, topic: Topic | undefined, citations: Citation[]): { summary: string; citizen: CitizenAnswer; officer: OfficerAnswer } {
  if (topic) {
    return {
      summary: pinpoint(query, topic, citations) + topic.citizen.summary,
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
      summary: `'${query}'와(과) 직접 관련된 조문을 찾지 못했어요. ${/[가-힣]/.test(query) ? "" : "법이음은 한국어 질문으로 근거를 찾아요. "}더 구체적인 상황(예: "전세 보증금", "육아휴직 급여", "민원 처리 기한")으로 다시 검색해 보세요.`,
      citizen: {
        easyTerms: [],
        steps: [
          { title: "검색어 바꿔 보기", detail: "상황을 나타내는 핵심 단어(누가·무엇을·어떻게)를 넣어 다시 검색해 보세요." },
          { title: "정부민원안내콜센터 문의", detail: "어느 기관 소관인지 모를 때는 110으로 전화하면 담당 기관을 안내받을 수 있어요." },
          { title: "무료 법률상담", detail: "대한법률구조공단(132)에서 무료 법률상담을 받을 수 있어요." },
        ],
      },
      officer: {
        background: "관련 조문이 검색되지 않음(내장 법령 데이터, 연동 시 국가법령정보 Open API 전체 현행 법령 기준).",
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
