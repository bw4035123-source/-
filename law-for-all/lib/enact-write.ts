/**
 * 제정안 AI 작성 — 표준 초안(lib/enact.ts)의 조문 체계를 그대로 두고, 조문 본문을 생성형 AI가 상위 조문 원문을 보고 구체적으로 쓴다.
 * 가드(Python 판 python/law_for_all/enact_write.py 와 같음):
 *  - 근거 목록 밖 법령 인용, 표준 초안에 없던 벌칙·과태료·벌금, 항 번호 체계가 깨진 조문은 버리고 표준 초안 유지
 *  - 상위 조문·제정 목적에 없는 수치(기간·금액·비율)는 기관이 정할 값이므로 쓰되 '확인 필요'로 알림
 */
import { extractQuantities, quantityLabel } from "./answer/numbers";

export interface WriteArticle {
  label: string; // 제5조(안전보건관리책임자 지정)
  text: string; // 표준 초안 본문
}
export interface WriteBasis {
  label: string;
  text: string;
}
export interface WriteInput {
  name: string;
  kind: string;
  org?: string;
  purpose: string;
  articles: WriteArticle[];
  basis: WriteBasis[];
}
export interface WriteResult {
  articles: { label: string; text: string; written: boolean }[];
  rejected: { label: string; reason: string }[];
  /** 상위 조문에 없는 수치 — 기관 실정에 맞는지 확인 */
  checks: { label: string; values: string[] }[];
}

/** 한 번에 쓰게 할 조문 수 — 묶음마다 동시에 요청(14조 → 4묶음) */
export const WRITE_CHUNK = 4;

export const WRITE_SYSTEM = `너는 공공기관 내부 규정(행정규칙·자치법규) 제정안을 쓰는 법제 보조 AI다.
[절대 규칙]
1. <조문초안>의 조문 순서·조 번호·조 제목은 그대로 두고, 각 조문의 본문만 구체적으로 다시 쓴다.
2. 본문은 <근거조문> 원문이 정한 의무·절차·기준을 기관(규정의 주체) 입장에서 실제로 시행할 수 있게 쓴다. 근거조문의 기준(기간·횟수·인원·금액)은 원문 그대로 옮긴다.
3. <근거조문>에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료·벌금 같은 제재를 만들지 않는다.
4. 항이 둘 이상이면 ①②③…을 차례대로 붙이고, 호는 1. 2. 3.으로 쓴다. 한 조문은 1~4개 항으로 간결하게 쓴다.
5. 법제 문체(~하여야 한다, ~할 수 있다, ~한다)로 쓴다. 기관명은 <규정>의 기관을 쓰고, 모르면 ○○를 쓴다.
6. 정의 조문은 각 용어를 근거조문의 정의에 맞춰 "1. “용어”란 …을 말한다." 형식으로 쓴다.
7. 기관 실정에 따라 정할 값(내부 부서명·점검 주기 등)이 근거조문에 없으면 ○○로 둔다.
8. 출력은 {"articles":[{"label":"제1조(목적)","text":"본문"}]} 형식의 JSON 객체 하나만 출력한다. 부칙은 쓰지 않는다.`;

export function buildWritePrompt(input: WriteInput): string {
  const basis = input.basis.length ? input.basis.map((b) => `<<${b.label}>>\n${b.text.slice(0, 1500)}`).join("\n\n") : "(없음 — 기관 자율 규정)";
  const arts = input.articles.map((a) => `${a.label} ${a.text}`).join("\n");
  return `<규정>\n이름: ${input.name || "(미정)"}\n종류: ${input.kind}\n기관: ${input.org || "○○"}\n제정 목적: ${input.purpose || "(미정)"}\n</규정>\n\n<근거조문>\n${basis}\n</근거조문>\n\n<조문초안>\n${arts}\n</조문초안>\n\n각 조문의 본문을 근거조문에 맞게 구체적으로 다시 써서 JSON으로 답하라.`;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const PENALTY = /(과태료|벌금|벌칙|징역|구류|과징금)/;
const lawRefs = (s: string) => Array.from(s.matchAll(/「([^」]{2,60})」/g), (m) => m[1].replace(/\s/g, ""));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function guardWrite(raw: unknown, input: WriteInput): WriteResult {
  const got = new Map<string, string>();
  const list = raw && typeof raw === "object" && Array.isArray((raw as { articles?: unknown }).articles) ? ((raw as { articles: unknown[] }).articles as { label?: unknown; text?: unknown }[]) : [];
  // 조 번호로 맞춤(긴 조 제목은 초안에서 '…'로 줄어 있어 AI가 제목을 온전히 쓰면 글자가 다름)
  const noOf = (label: string) => label.replace(/\s/g, "").match(/^제\d+조(?:의\d+)?/)?.[0] ?? label.replace(/\s/g, "");
  for (const a of list) if (typeof a?.label === "string" && typeof a?.text === "string") got.set(noOf(a.label), a.text.replace(/^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)\s*/, "").trim());
  const allowedLaws = new Set(input.basis.flatMap((b) => lawRefs(b.label)));
  // 조문 초안에 이미 있던 법령(목적 조문 등)도 인정
  for (const a of input.articles) for (const n of lawRefs(a.text)) allowedLaws.add(n);
  const sources = [input.purpose, ...input.basis.map((b) => `${b.label} ${b.text}`)];
  const known = new Set(sources.flatMap(extractQuantities));
  const rejected: WriteResult["rejected"] = [];
  const checks: WriteResult["checks"] = [];
  const articles = input.articles.map((a) => {
    const keep = { label: a.label, text: a.text, written: false };
    const t = got.get(noOf(a.label));
    if (!t || norm(t) === norm(a.text)) return keep;
    const outside = lawRefs(t).filter((n) => !allowedLaws.has(n));
    if (outside.length) {
      rejected.push({ label: a.label, reason: `근거 목록에 없는 법령 인용(${Array.from(new Set(outside)).join(", ")})` });
      return keep;
    }
    if (PENALTY.test(t) && !PENALTY.test(a.text)) {
      rejected.push({ label: a.label, reason: "초안에 없던 제재(벌칙·과태료 등)를 만듦" });
      return keep;
    }
    const marks = Array.from(t).filter((ch) => CIRCLED.includes(ch));
    if (marks.some((m, i) => m !== CIRCLED[i])) {
      rejected.push({ label: a.label, reason: `항 번호가 차례대로가 아님(${marks.join("")})` });
      return keep;
    }
    if (t.length > 1500) {
      rejected.push({ label: a.label, reason: "조문이 지나치게 김" });
      return keep;
    }
    const extra = extractQuantities(t).filter((q) => !known.has(q));
    if (extra.length) checks.push({ label: a.label, values: extra.map(quantityLabel) });
    return { label: a.label, text: t, written: true };
  });
  return { articles, rejected, checks };
}
