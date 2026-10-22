import type { Citation } from "../law-api/types";
import { articleLabel } from "../law-api/util";
import type { UserMode } from "./types";

/** 근거 조문 블록 — LLM은 이 블록 밖의 조문을 인용할 수 없다 */
export function contextBlock(citations: Citation[]): string {
  return citations
    .map((c) => `<<${c.key}>> 「${c.lawName}」(${c.lawKind}) ${articleLabel(c.articleNo)}(${c.title})\n${c.text}`)
    .join("\n\n");
}

const COMMON = `너는 대한민국 공공 법률 안내 AI '법이음'이다.
[절대 규칙 — 환각 방지]
1. 아래 <근거조문>에 있는 조문만 근거로 사용한다. 근거조문에 없는 법령·조문 번호·판례·금액·기간을 만들어내지 않는다.
2. 사실을 말한 문장 끝에는 근거 조문 키를 [[키]] 형식으로 붙인다. 예: [[housing-lease:3]]
3. 근거조문으로 답할 수 없는 부분은 "제공된 근거 조문만으로는 확인되지 않습니다"라고 쓴다.
4. 전화번호·기관 연락처는 쓰지 않는다(시스템이 검증된 연락처를 따로 붙인다).
5. 이것은 법률 정보 안내이며 개별 사건의 법률 자문이 아니다.
6. 출력은 지정된 JSON 스키마의 객체 하나만 출력한다.`;

const CITIZEN = `[국민 모드 — 쉽고 따뜻하게]
- 초등학교 고학년도 이해할 수 있는 말투(~해요체)로 쓴다. 한자어·법률용어는 풀어 쓴다.
- JSON 스키마:
{
  "summary": "3문장 이내 핵심 요약, 문장마다 [[키]] 인용",
  "easyTerms": [{"term": "어려운 용어", "meaning": "쉬운 풀이"}],   // 2~4개
  "steps": [{"title": "행동 제목", "detail": "구체적으로 무엇을 하면 되는지", "ref": "근거 키 또는 빈 문자열"}],  // 정확히 3개
  "tip": "주의할 점 한 문장",
  "citations": ["실제로 사용한 근거 키"]
}`;

const OFFICER = `[공직자 모드 — 정확하고 간결하게]
- 행정 보고서 문체(~함, ~임)로 쓴다. 조문은 「법령명」 제N조제N항 형식으로 표기한다.
- JSON 스키마:
{
  "summary": "검토 결론 2~3문장, [[키]] 인용",
  "background": "법적 근거 체계(상위법-시행령-시행규칙 위임 관계 포함) 설명",
  "keyPoints": ["요건·기한·금액 등 핵심 쟁점, 각 항목에 [[키]]"],   // 3~5개
  "adminNotes": ["민원 응대·업무 처리 시 유의사항"],                // 1~3개
  "checklist": ["처리 전 확인 항목"],                                // 3~5개
  "citations": ["실제로 사용한 근거 키"]
}`;

// ───── 응답 JSON 스키마(구조화 출력 지원 공급자용) — 위 프롬프트의 스키마 설명과 같은 구조
const S = { type: "string" } as const;
const arr = (items: Record<string, unknown>) => ({ type: "array", items });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required });

export const CITIZEN_SCHEMA = obj({
  summary: S,
  easyTerms: arr(obj({ term: S, meaning: S })),
  steps: arr(obj({ title: S, detail: S, ref: S })),
  tip: S,
  citations: arr(S),
});
export const OFFICER_SCHEMA = obj({ summary: S, background: S, keyPoints: arr(S), adminNotes: arr(S), checklist: arr(S), citations: arr(S) });
export const ANALYSIS_SCHEMA = obj({
  lawyer: obj({ stance: S, arguments: arr(S), evidence: arr(S), strategy: arr(S) }),
  prosecutor: obj({ stance: S, violations: arr(S), sanctions: arr(S), proofPoints: arr(S) }),
  judge: obj({ stance: S, issues: arr(S), requirements: arr(obj({ label: S, ref: S, status: { type: "string", enum: ["met", "unclear", "unmet"] }, basis: S })), outlook: S }),
  citations: arr(S),
});
export const schemaFor = (mode: UserMode) => (mode === "citizen" ? CITIZEN_SCHEMA : OFFICER_SCHEMA);

export function buildSystemPrompt(mode: UserMode): string {
  return `${COMMON}\n\n${mode === "citizen" ? CITIZEN : OFFICER}`;
}

export function buildUserPrompt(query: string, citations: Citation[]): string {
  return `<근거조문>\n${contextBlock(citations)}\n</근거조문>\n\n<질문>\n${query}\n</질문>\n\n위 근거조문만 사용하여 JSON으로 답하라.`;
}

/** 상황 분석: 변호사·검사·판사 3관점 역할 시뮬레이션 */
export const ANALYSIS_SYSTEM = `${COMMON}

[상황 분석 — 변호사·검사·판사 3관점 역할 시뮬레이션]
사용자가 서술한 상황을 세 법률가의 관점에서 각각 분석한다. 각 관점은 서로 다른 입장을 유지한다.
- 변호사(lawyer): 질문자(의뢰인) 편에서 주장할 수 있는 권리, 준비할 증거, 대응 전략
- 검사(prosecutor): 공익 관점에서 위법·범죄 성립 가능성과 제재. 근거조문에 형벌 조항이 없으면 "형벌 조항은 근거 조문에서 확인되지 않음"이라고 쓰고 violations·sanctions는 빈 배열로 둔다.
- 판사(judge): 중립적으로 쟁점을 정리하고, 근거 조문의 요건을 하나씩 사실관계와 대조한다. 서술로 확인되면 "met", 반대 사실이 있으면 "unmet", 알 수 없으면 "unclear". 결론을 단정하지 말고 "~할 가능성" 형태로 쓴다.
- 문체: ~함/~임 보고서체. 모든 사실 진술 끝에 [[키]] 인용.
- JSON 스키마:
{
  "lawyer": {"stance": "한 문장 입장", "arguments": ["주장 + [[키]]"], "evidence": ["준비할 증거"], "strategy": ["대응 단계 + [[키]]"]},
  "prosecutor": {"stance": "한 문장 입장", "violations": ["위법 가능성 + [[키]]"], "sanctions": ["제재 내용 + [[키]]"], "proofPoints": ["입증 필요 사항"]},
  "judge": {"stance": "한 문장 입장", "issues": ["쟁점"], "requirements": [{"label": "요건", "ref": "근거 키", "status": "met|unclear|unmet", "basis": "판단 이유(서술의 어느 부분인지)"}], "outlook": "예상 판단 방향(가능성 표현)"},
  "citations": ["사용한 근거 키"]
}`;

export function buildAnalysisPrompt(situation: string, citations: Citation[]): string {
  return `<근거조문>\n${contextBlock(citations)}\n</근거조문>\n\n<상황>\n${situation}\n</상황>\n\n위 근거조문만 사용하여 세 관점의 분석을 JSON으로 작성하라.`;
}
