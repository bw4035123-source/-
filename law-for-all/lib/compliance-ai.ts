/**
 * 자체규정 AI 검토 — 규정 조문마다 국가법령정보에서 찾은 상위 조문 원문을 붙여 생성형 AI가 상충·검토 필요·적합을 판단하고,
 * 가드가 결정적으로 검증한다(Python 판 python/law_for_all/compliance_ai.py 와 같음).
 *  - 문제점의 근거는 그 조문에 붙인 상위 조문 키만 인정(다른 조문·지어낸 법령은 버림)
 *  - 문제점·고칠 방향의 금액·기간·비율은 규정 조문이나 근거 상위 조문 원문에 있어야 함
 *  - 근거가 확인된 문제점이 하나도 남지 않으면 상충·검토 필요 판단을 '판단 보류'로 낮춤
 * 판정은 담당자가 확인하는 참고 의견이며, 정해진 기준 규칙(lib/compliance.ts)과 함께 보여 준다.
 */
import { unverifiedQuantities } from "./answer/numbers";
import { resolveKey } from "./answer/guard";

export type AiVerdict = "상충" | "검토 필요" | "적합" | "판단 보류";
export const AI_VERDICTS: AiVerdict[] = ["상충", "검토 필요", "적합", "판단 보류"];

/** 목적·정의·시행일 같은 일반 조문은 상위 조문 검색을 건너뜀(낱말만 겹친 엉뚱한 법령이 붙지 않게 — 규칙이 연결한 조문만 사용) */
export const GENERIC_ARTICLE = /^(?:목적|정의|용어의 정의|시행일|적용 ?범위|위임|시행세칙|세부 ?사항|재검토기한)$/;

export interface UpperRef {
  key: string;
  label: string; // 「근로기준법」 제50조(근로시간)
  text: string;
}
export interface AiArticleInput {
  no: string; // "3", "3의2"
  label: string; // 제3조(근무시간)
  text: string;
  upper: UpperRef[];
}
export interface AiIssue {
  point: string;
  suggestion: string;
  basis: string[];
}
export interface AiArticleResult {
  no: string;
  verdict: AiVerdict;
  issues: AiIssue[];
  /** 가드가 버린 문제점 수(근거 밖 조문·확인되지 않은 수치) */
  dropped: number;
  /** 판단 보류로 낮춘 이유 */
  note?: string;
}

export const COMPLIANCE_SYSTEM = `너는 공공기관 자체규정(내부규정·조례·지침)을 상위법령과 대조하는 법제 검토 AI다.
[절대 규칙]
1. 각 조문은 그 조문에 붙은 <상위조문>에만 비추어 검토한다. 상위조문에 없는 법령·조문·금액·기간·비율을 만들어내지 않는다.
2. verdict 는 다음 중 하나다.
   - "상충": 상위조문과 명백히 어긋남(법정 기준 미달·초과, 금지된 것을 허용, 반드시 거쳐야 할 절차를 빠뜨림)
   - "검토 필요": 어긋날 가능성이 있거나 문구가 불명확함, 상위조문이 정한 사항이 빠짐
   - "적합": 붙은 상위조문의 기준을 충족함
   - "판단 보류": 붙은 상위조문이 이 조문과 관련이 없거나 판단할 근거가 부족함
3. 상충·검토 필요이면 문제점마다 {"point":"무엇이 왜 문제인지 한두 문장","basis":["근거 상위조문 키"],"suggestion":"고칠 방향 한 문장"}을 쓴다. basis 에는 그 조문의 <상위조문>에 있는 키만 쓴다.
4. 기관이 자율로 정할 수 있는 사항(내부 절차·부서명·서식 등)은 상위조문에 기준이 없으면 문제 삼지 않는다.
5. 공문서체(~함, ~임)로 간결하게 쓴다. 문제점은 조문당 3개 이내, point 는 2문장 이내, suggestion 은 1문장으로 쓰고 같은 내용을 되풀이하지 않는다. 조문 키·내부 용어("상위조문 목록" 등)를 문장에 쓰지 않는다.
6. 출력은 {"articles":[{"no":"3","verdict":"상충","issues":[...]}]} 형식의 JSON 객체 하나만 출력한다. 입력의 모든 조문에 대해 답한다.`;

export function buildCompliancePrompt(regName: string, orgType: string, articles: AiArticleInput[]): string {
  const body = articles
    .map((a) => {
      const up = a.upper.length ? a.upper.map((u) => `[[${u.key}]] ${u.label}\n${u.text.slice(0, 1200)}`).join("\n\n") : "(찾은 상위조문 없음)";
      return `<<조문 no=${a.no}>> ${a.label}\n${a.text}\n<상위조문>\n${up}\n</상위조문>`;
    })
    .join("\n\n");
  return `<규정>\n이름: ${regName || "(미정)"}\n기관 유형: ${orgType}\n</규정>\n\n${body}\n\n위 조문마다 상위조문과 대조한 결과를 JSON으로 답하라.`;
}

const normNo = (s: unknown) =>
  String(s ?? "")
    .replace(/\s/g, "")
    .replace(/^제/, "")
    .replace(/조(?:의(\d+))?.*$/, (_m, b?: string) => (b ? `의${b}` : ""));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function guardCompliance(raw: unknown, input: AiArticleInput[]): AiArticleResult[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { articles?: unknown }).articles) ? ((raw as { articles: unknown[] }).articles as Record<string, unknown>[]) : [];
  return input.map((a) => {
    const got = list.find((x) => x && normNo(x.no) === a.no);
    if (!got) return { no: a.no, verdict: "판단 보류", issues: [], dropped: 0, note: "AI가 이 조문에 답하지 않음" };
    const allowed = new Set(a.upper.map((u) => u.key));
    let verdict: AiVerdict = AI_VERDICTS.includes(str(got.verdict) as AiVerdict) ? (str(got.verdict) as AiVerdict) : "판단 보류";
    let dropped = 0;
    const issues: AiIssue[] = [];
    for (const it of Array.isArray(got.issues) ? (got.issues as Record<string, unknown>[]) : []) {
      // 내부 용어가 문장에 섞이면 화면용 말로
      const tidy = (t: string) => t.replace(/상위\s?조문\s?목록/g, "확인된 상위 조문").replace(/\[\[[^\]]+\]\]/g, "").trim();
      const point = tidy(str(it?.point));
      const suggestion = tidy(str(it?.suggestion));
      const basis = Array.from(new Set((Array.isArray(it?.basis) ? it.basis : []).map((k) => resolveKey(str(k).replace(/^\[\[|\]\]$/g, ""), allowed)).filter((k): k is string => !!k)));
      if (!point || !basis.length) {
        dropped++;
        continue;
      }
      // 수치는 규정 조문이나 근거 상위 조문 원문에 있어야(지어낸 기준 차단)
      const sources = [a.text, ...a.upper.filter((u) => basis.includes(u.key)).map((u) => u.text)];
      if (unverifiedQuantities([point, suggestion], sources).length) {
        dropped++;
        continue;
      }
      issues.push({ point, suggestion, basis });
    }
    let note: string | undefined;
    if ((verdict === "상충" || verdict === "검토 필요") && !issues.length) {
      note = dropped ? `근거가 확인되지 않은 지적 ${dropped}건을 버려 판단 보류` : "문제점 근거 없음";
      verdict = "판단 보류";
    }
    if (verdict === "적합" && !a.upper.length) verdict = "판단 보류";
    if (verdict === "적합" || verdict === "판단 보류") issues.length = 0;
    return { no: a.no, verdict, issues, dropped, note };
  });
}

/** 판정 합치기 — 규칙 판정과 AI 판정 중 더 엄격한 쪽. 단, 규칙은 상충인데 AI가 적합이면 단정하지 않고 '검토 필요(판단 다름)' */
type Sev = "conflict" | "review" | "ok" | "info";
const SEV_OF: Record<AiVerdict, Sev> = { 상충: "conflict", "검토 필요": "review", 적합: "ok", "판단 보류": "info" };
const RANK: Record<Sev, number> = { conflict: 3, review: 2, ok: 1, info: 0 };
export function mergeVerdict(rule: Sev, ai?: AiVerdict): { status: Sev; disagree: boolean } {
  if (!ai) return { status: rule, disagree: false };
  if (rule === "conflict" && ai === "적합") return { status: "review", disagree: true };
  const s = SEV_OF[ai];
  return { status: RANK[s] > RANK[rule] ? s : rule, disagree: false };
}
