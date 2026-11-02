/**
 * 제정안 AI 채우기 — 표준 문형 초안의 ○○ 자리만 생성형 AI가 채우고, 가드가 결정적으로 검증한다(Python 판 python/law_for_all/enact_fill.py 와 같음)
 *  - 빈칸 밖 글자를 바꾸면(조문 체계·문형 변경) 그 조문은 버림
 *  - 채운 값에 근거 목록 밖 법령·조문 인용이 있거나, 초안에 없던 벌칙·과태료·의무를 만들면 버림
 *  - 상위 조문 기준(기한·금액)보다 큰 값은 경고
 */
export interface FillArticle {
  label: string;
  text: string;
}
export interface FillBasis {
  label: string;
  text: string;
}
export interface FillInput {
  name: string;
  kind: string;
  org?: string;
  purpose: string;
  articles: FillArticle[];
  basis: FillBasis[];
}
export interface FilledArticle {
  label: string;
  /** 채운 조문(버려졌으면 원래 초안) */
  text: string;
  /** 빈칸 사이 고정 문구와 채운 값(화면 강조용, parts.length = values.length + 1) */
  parts: string[];
  values: string[];
  filled: number;
}
export interface FillResult {
  articles: FilledArticle[];
  rejected: { label: string; reason: string }[];
  warnings: string[];
}

export const SLOT = /○○|○일|○명|○회/g;

export const FILL_SYSTEM = `너는 행정규칙·자치법규 제정안 작성을 돕는 법제 보조 AI다.
[절대 규칙]
1. 주어진 조문 초안에서 ○○, ○일, ○명, ○회 자리만 채운다. 그 밖의 글자·조사·문장부호·항 번호는 한 글자도 바꾸지 않는다.
2. ○일·○명·○회 자리에는 숫자를 넣는다(예: ○일 → 10일).
3. 근거 조문에 기한·금액 기준이 있으면 그 범위를 넘지 않게 채운다.
4. 근거 조문에 없는 법령명·조문 번호를 새로 쓰지 않는다.
5. 벌칙·과태료·벌금 같은 새 제재를 만들지 않는다.
6. 기관 실정에 따라 달라 확실하지 않은 자리는 ○○를 그대로 둔다.
7. 출력은 {"articles":[{"label":"제1조(목적)","text":"채운 조문 전체"}]} 형식의 JSON 객체 하나만 출력한다.`;

export function buildFillPrompt(input: FillInput): string {
  const basis = input.basis.length ? input.basis.map((b) => `<<${b.label}>>\n${b.text}`).join("\n\n") : "(없음)";
  const arts = input.articles.map((a) => `${a.label} ${a.text}`).join("\n");
  return `<규정>\n이름: ${input.name || "(미정)"}\n종류: ${input.kind}\n기관: ${input.org || "(미정)"}\n제정 목적: ${input.purpose || "(미정)"}\n</규정>\n\n<근거조문>\n${basis}\n</근거조문>\n\n<조문초안>\n${arts}\n</조문초안>\n\n위 조문초안의 빈칸만 채워 JSON으로 답하라.`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 빈칸 뒤 '을(를)' 같은 겸용 조사는 AI가 한쪽으로 정리해도 인정
const PARTICLE: [string, string][] = [
  ["을(를)", "(?:을\\(를\\)|을|를)"],
  ["이(가)", "(?:이\\(가\\)|이|가)"],
  ["은(는)", "(?:은\\(는\\)|은|는)"],
  ["과(와)", "(?:과\\(와\\)|과|와)"],
  ["으로(로)", "(?:으로\\(로\\)|으로|로)"],
];
const PENALTY = /(과태료|벌금|벌칙|징역|구류|과징금)/;
const normWs = (s: string) => s.replace(/\s+/g, " ").trim();

function fixedPattern(part: string): string {
  let out = esc(normWs(part)).replace(/ /g, "\\s*");
  for (const [p, re] of PARTICLE) out = out.split(esc(p)).join(re);
  return out;
}

/** 초안(빈칸 있음)과 AI가 채운 조문 대조 → 채운 값 목록(빈칸 밖이 바뀌었으면 null) */
export function matchFill(template: string, filled: string): string[] | null {
  const parts = normWs(template).split(SLOT);
  if (parts.length === 1) return normWs(template) === normWs(filled) ? [] : null;
  const re = new RegExp(`^${parts.map(fixedPattern).join("([^\\n]{1,60}?)")}$`, "s");
  const m = normWs(filled).match(re);
  return m ? m.slice(1).map((v) => v.trim()) : null;
}

const lawRefs = (s: string) => Array.from(s.matchAll(/「([^」]{2,60})」\s*(?:제\s*(\d+)조)?/g), (m) => ({ name: m[1].replace(/\s/g, ""), no: m[2] }));

/** 채운 낱말 뒤 겸용 조사 정리: '외부강의등을(를)' → '외부강의등을'(앞 글자 받침 기준, 빈칸이 남은 '○○을(를)'은 그대로) */
export function settleParticles(text: string): string {
  return text.replace(/([가-힣])(을\(를\)|이\(가\)|은\(는\)|과\(와\)|으로\(로\))/g, (_m, ch: string, pair: string) => {
    const code = ch.charCodeAt(0) - 0xac00;
    const jong = code % 28;
    const [a, b] = pair.replace(")", "").split("(");
    if (pair.startsWith("으로")) return ch + (jong === 0 || jong === 8 ? "로" : "으로");
    return ch + (jong ? a : b);
  });
}

export function guardFill(raw: unknown, input: FillInput): FillResult {
  const got = new Map<string, string>();
  const list = raw && typeof raw === "object" && Array.isArray((raw as { articles?: unknown }).articles) ? ((raw as { articles: unknown[] }).articles as { label?: unknown; text?: unknown }[]) : [];
  for (const a of list) if (typeof a?.label === "string" && typeof a?.text === "string") got.set(a.label.trim(), a.text);
  const basisLaws = input.basis.flatMap((b) => lawRefs(b.label));
  // 상위 조문 기준(같은 단위의 '이내·이하' 값)
  const limits = input.basis.flatMap((b) => Array.from(b.text.matchAll(/(\d[\d,]*)\s*(일|개월|년|만원|원)\s*(?:이내|이하|까지|를 넘지|을 넘지)/g), (m) => ({ v: Number(m[1].replace(/,/g, "")), unit: m[2], label: b.label.replace(/\(.*\)$/, "") })));
  const rejected: FillResult["rejected"] = [];
  const warnings: string[] = [];
  const articles: FilledArticle[] = input.articles.map((a) => {
    // 화면·결과는 원래 줄바꿈(①·② 항)을 살린 초안 조각으로, 대조만 공백을 정리해서
    const parts = a.text.split(SLOT);
    const keep: FilledArticle = { label: a.label, text: a.text, parts, values: parts.slice(1).map(() => "○○"), filled: 0 };
    if (parts.length === 1) return keep;
    const t = got.get(a.label);
    if (!t) return keep;
    const values = matchFill(a.text, t);
    if (!values) {
      rejected.push({ label: a.label, reason: "빈칸 밖 문구를 바꿈" });
      return keep;
    }
    const joined = values.join(" ");
    const outside = lawRefs(joined).filter((r) => !basisLaws.some((b) => b.name === r.name && (!r.no || !b.no || b.no === r.no)));
    if (outside.length) {
      rejected.push({ label: a.label, reason: `근거 목록에 없는 법령 인용(${outside.map((r) => r.name).join(", ")})` });
      return keep;
    }
    if (PENALTY.test(joined) && !PENALTY.test(a.text)) {
      rejected.push({ label: a.label, reason: "초안에 없던 제재(벌칙·과태료 등)를 만듦" });
      return keep;
    }
    for (const v of values)
      for (const m of Array.from(v.matchAll(/(\d[\d,]*)\s*(일|개월|년|만원|원)/g))) {
        const lim = limits.find((l) => l.unit === m[2]);
        if (lim && Number(m[1].replace(/,/g, "")) > lim.v) warnings.push(`${a.label}의 ‘${m[0]}’이(가) ${lim.label}의 기준(${lim.v}${lim.unit})보다 큽니다.`);
      }
    const filled = values.filter((v) => !/^○/.test(v)).length;
    return { label: a.label, text: settleParticles(parts.reduce((s, p, i) => s + values[i - 1] + p)), parts, values, filled };
  });
  return { articles, rejected, warnings };
}
