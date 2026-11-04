/**
 * 한 줄 제정 — "우리 공단 산업안전보건 관리 지침 만들어줘" 한 줄에서, 국가법령정보에서 찾은 상위 조문을 보고
 * 생성형 AI가 규정의 설계(규정명·종류·목적·담을 조문·정의할 용어·근거 조문)를 정한다(Python 판 python/law_for_all/enact_plan.py 와 같음).
 * 설계만 AI가 하고, 조문 문형은 결정적 표준 초안(lib/enact.ts)이 만들며, 기관마다 다른 빈칸은 AI 채우기(lib/enact-fill.ts)가 가드 검증을 거쳐 채운다.
 * 가드: 근거 조문은 찾은 조문 키만, 벌칙·과태료 조문은 빼고(기관 규정이 정할 수 없음), 길이·개수 제한.
 */
import { resolveKey } from "./answer/guard";

export interface PlanEvidence {
  key: string;
  label: string; // 「산업안전보건법」 제29조(근로자에 대한 안전보건교육)
  text: string;
}
export interface EnactPlan {
  name: string;
  kind: "행정규칙" | "자치법규";
  purpose: string;
  items: string[];
  terms: string[];
  basis: string[];
  notes: string[];
}

export const PLAN_SYSTEM = `너는 공공기관 내부 규정(행정규칙·자치법규) 제정을 설계하는 법제 보조 AI다.
[절대 규칙]
1. 사용자의 요청과 <상위조문>을 보고 제정할 규정의 설계만 한다. 조문 문장은 쓰지 않는다.
2. name: 기관명을 넣은 규정 이름(예: "○○공단 산업안전보건 관리 지침"). 기관명을 모르면 "○○"을 쓴다.
3. kind: 기관 내부 규정이면 "행정규칙", 지방자치단체 조례·규칙이면 "자치법규".
4. purpose: 제정 목적 한 문장(~하기 위함).
5. items: 규정에 담을 조문 제목 5~10개(명사구, 예: "안전보건관리책임자 지정", "안전보건교육"). <상위조문>이 사업주·기관에 부과한 의무와 절차를 빠짐없이 반영한다. 목적·정의·부칙은 넣지 않는다.
6. terms: 정의가 필요한 용어 0~5개.
7. basis: 근거가 되는 상위조문 키 1~4개. <상위조문>에 있는 키만 쓴다.
8. 벌칙·과태료·벌금 같은 제재 조문은 넣지 않는다(내부 규정이 정할 수 없음).
9. 출력은 {"name":"","kind":"행정규칙","purpose":"","items":[],"terms":[],"basis":[]} 형식의 JSON 객체 하나만 출력한다.`;

export function buildPlanPrompt(request: string, org: string, evidence: PlanEvidence[]): string {
  const up = evidence.length ? evidence.map((e) => `[[${e.key}]] ${e.label}\n${e.text.slice(0, 900)}`).join("\n\n") : "(찾은 상위조문 없음)";
  return `<요청>\n${request}\n</요청>\n<기관>${org || "(미정)"}</기관>\n\n<상위조문>\n${up}\n</상위조문>\n\n위 요청에 맞는 규정 설계를 JSON으로 답하라.`;
}

const PENALTY = /(벌칙|과태료|벌금|징역|과징금|양벌)/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

export function guardPlan(raw: unknown, evidence: PlanEvidence[], org = ""): EnactPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const allowed = new Set(evidence.map((e) => e.key));
  const name = str(o.name, 50) || `${org || "○○"} 규정`;
  const kind = o.kind === "자치법규" ? "자치법규" : "행정규칙";
  const purpose = str(o.purpose, 200);
  const items: string[] = [];
  for (const x of list(o.items)) {
    const t = str(x, 30).replace(/^\s*(?:\d+[.)]|제\s*\d+\s*조)\s*/, "").replace(/^[(（]|[)）]$/g, "");
    if (!t || items.includes(t) || /^(목적|정의|부칙|시행일)$/.test(t)) continue;
    if (PENALTY.test(t)) {
      notes.push(`‘${t}’ 조문은 뺐어요(벌칙·과태료는 내부 규정이 정할 수 없음)`);
      continue;
    }
    items.push(t);
  }
  const terms = Array.from(new Set(list(o.terms).map((x) => str(x, 20)).filter(Boolean))).slice(0, 5);
  const basis = Array.from(new Set(list(o.basis).map((k) => resolveKey(str(k, 80).replace(/^\[\[|\]\]$/g, ""), allowed)).filter((k): k is string => !!k))).slice(0, 4);
  if (list(o.basis).length && !basis.length) notes.push("AI가 고른 근거 조문이 찾은 조문 밖이라 뺐어요");
  if (!basis.length && evidence.length) {
    basis.push(...evidence.slice(0, 2).map((e) => e.key));
    notes.push("근거 조문은 검색 상위 조문으로 넣었어요 — 맞는지 확인하세요");
  }
  return { name, kind, purpose, items: items.slice(0, 10), terms, basis, notes };
}
