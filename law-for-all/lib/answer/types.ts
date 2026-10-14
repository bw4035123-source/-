/** 클라이언트·서버 공용 답변 타입(서버 전용 모듈을 import 하지 않음) */
import type { CaseItem, Citation } from "../law-api/types";
import type { Contact } from "../law-api/mock/topics";

export type UserMode = "citizen" | "officer";

export interface CitizenAnswer {
  easyTerms: { term: string; meaning: string }[];
  steps: { title: string; detail: string; ref?: string }[];
  tip?: string;
}

export interface OfficerAnswer {
  background: string;
  keyPoints: string[];
  adminNotes: string[];
  checklist: string[];
}

export interface GuardReport {
  /** 근거 목록에 없어 제거된 인용 키 */
  removedCitations: string[];
  /** 본문에 언급됐지만 근거 조문에서 확인되지 않은 조문 표현 */
  unverifiedMentions: string[];
  /** LLM 응답을 쓰지 못해 규칙엔진으로 대체한 사유 */
  fallbackReason?: string;
  /** 검증 통과 여부 */
  passed: boolean;
}

export interface AskResult {
  query: string;
  mode: UserMode;
  topic?: { id: string; label: string };
  provider: { id: string; label: string; model: string; kind: "llm" | "rule" };
  /** [[lawId:no]] 인용 표식이 포함된 요약 */
  summary: string;
  citizen?: CitizenAnswer;
  officer?: OfficerAnswer;
  citations: Citation[];
  contacts: Contact[];
  cases: CaseItem[];
  relatedLaws: { id: string; name: string }[];
  guard: GuardReport;
  dataSource: "mock" | "live";
  notices: string[];
  elapsedMs: number;
  generatedAt: string;
}

// ───────────── 상황 분석(변호사·검사·판사 관점)
export type RoleId = "lawyer" | "prosecutor" | "judge";
export type ReqStatus = "met" | "unclear" | "unmet";

export interface ExtractedFact {
  kind: "당사자" | "금액" | "기간·시점" | "행위·사건" | "장소";
  value: string;
}

export interface LawRecommendation {
  key: string;
  relevance: "high" | "medium" | "low";
  score: number;
  issue?: string;
  reason: string;
}

export interface RolePerspectives {
  lawyer: { stance: string; arguments: string[]; evidence: string[]; strategy: string[] };
  prosecutor: { stance: string; violations: string[]; sanctions: string[]; proofPoints: string[] };
  judge: {
    stance: string;
    issues: string[];
    requirements: { label: string; ref?: string; status: ReqStatus; basis: string }[];
    outlook: string;
  };
}

export interface IssueAnalysis {
  issue: { id: string; label: string };
  perspectives: RolePerspectives;
}

export interface AnalyzeResult {
  situation: string;
  facts: ExtractedFact[];
  issues: { id: string; label: string; score: number }[];
  recommendations: LawRecommendation[];
  analyses: IssueAnalysis[];
  citations: Citation[];
  contacts: Contact[];
  provider: { id: string; label: string; model: string; kind: "llm" | "rule" };
  guard: GuardReport;
  dataSource: "mock" | "live";
  notices: string[];
  elapsedMs: number;
  generatedAt: string;
}
