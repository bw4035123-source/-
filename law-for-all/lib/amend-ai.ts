/**
 * 개정안 AI 작성 — 개정 방향 문장을 규칙(문형)으로 알아듣지 못했을 때만 생성형 AI가 개정 조문을 쓰고, 가드가 결정적으로 검증한다
 * (Python 판 python/law_for_all/amend_ai.py 와 같음)
 *  - 바꾼 내용이 없거나, 조문 머리(제N조(제목))·항 번호 체계가 깨지면 버림
 *  - 지시에 없는 항 삭제, 근거(현행·지시·상위법) 밖 수치·법령 인용, 현행에 없던 벌칙·과태료를 만들면 버림
 *  - 현행에 없던 조문 인용(제N조)은 실재 확인 경고
 * 통과한 안도 담당자가 확인·수정하는 초안이다.
 */
import { unverifiedQuantities, quantityLabel } from "./answer/numbers";

export interface AmendInput {
  lawName: string;
  kind: string;
  /** 조문 머리 — 제5조(처리기간) */
  label: string;
  /** 고칠 조문(규칙으로 이미 반영한 사항이 있으면 반영한 뒤의 조문) */
  current: string;
  /** 처음 현행 조문(수치·인용 근거 대조용, current 와 같으면 생략) */
  original?: string;
  instruction: string;
  /** 상위법 조문(기준 대조용) */
  upper: { label: string; text: string }[];
}

export type AmendResult =
  | { ok: true; text: string; changes: string[]; warnings: string[] }
  | { ok: false; reason: string };

export const AMEND_SYSTEM = `너는 행정규칙·자치법규·법령 개정안 작성을 돕는 법제 보조 AI다.
[절대 규칙]
1. 개정 방향에 적힌 내용만 고친다. 그 밖의 문장·조사·문장부호는 현행 그대로 둔다.
2. 항 번호(①②③…)는 차례대로 쓰고, 항을 새로 두면 다음 번호를 붙인다. 조문 머리(제N조(제목))는 쓰지 않고 본문만 쓴다.
3. 개정 방향에 없는 항을 지우지 않는다. 항 삭제 지시가 있으면 그 항을 '② 삭제'처럼 번호를 남기고 '삭제'라고만 쓴다.
4. 기간·인원·금액·시각 같은 수치는 개정 방향·현행 조문·상위법 조문에 있는 값만 쓴다. 시각은 개정 방향에 쓴 표기(예: 오후 6시)를 그대로 쓴다.
5. 현행 조문·상위법 조문에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료·벌금 같은 새 제재를 만들지 않는다.
6. 법제 문체(~한다, ~할 수 있다)로 쓴다.
7. 출력은 {"amended":"개정한 조문 본문 전체"} 형식의 JSON 객체 하나만 출력한다.`;

export function buildAmendPrompt(input: AmendInput): string {
  const upper = input.upper.length ? input.upper.map((u) => `<<${u.label}>>\n${u.text}`).join("\n\n") : "(없음)";
  return `<규정>\n이름: ${input.lawName || "(미정)"}\n종류: ${input.kind}\n조문: ${input.label}\n</규정>\n\n<현행조문>\n${input.current}\n</현행조문>\n\n<개정방향>\n${input.instruction}\n</개정방향>\n\n<상위법조문>\n${upper}\n</상위법조문>\n\n위 현행조문을 개정방향대로 고친 개정 조문 본문 전체를 JSON으로 답하라.`;
}

/** 다시 쓰게 할 때(가드에 걸린 이유를 알려 줌) */
export const AMEND_RETRY = (reason: string) => `방금 개정안이 검증에 걸렸다: ${reason}\n절대 규칙을 지켜 같은 JSON 형식으로 개정 조문 본문 전체를 다시 써라.`;

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const PENALTY = /(과태료|벌금|벌칙|징역|구류|과징금|금고)/;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** 항 단위로 나눔: ['', '① …', '② …'] — 맨 앞은 항 번호 앞 본문 */
export function paragraphs(text: string): string[] {
  const out: string[] = [""];
  for (const ch of Array.from(text)) {
    if (CIRCLED.includes(ch)) out.push(ch);
    else out[out.length - 1] += ch;
  }
  return out.map(norm);
}
const marks = (text: string) => Array.from(text).filter((ch) => CIRCLED.includes(ch));
const lawRefs = (s: string) => Array.from(s.matchAll(/「([^」]{2,60})」/g), (m) => m[1].replace(/\s/g, ""));
const articleRefs = (s: string) => Array.from(s.matchAll(/제\s*(\d+)\s*조(?:의\s*(\d+))?/g), (m) => (m[2] ? `${m[1]}의${m[2]}` : m[1]));

/** 인원·횟수·시각 등 금액·기간 외 수치(시각은 '오후 6시' = 18시로도 인정) */
function counts(text: string, withPm = false): Set<string> {
  const out = new Set<string>();
  const t = text.replace(/제\s*\d+\s*(?:조(?:의\s*\d+)?|항|호|목)/g, " ");
  for (const m of t.matchAll(/(오전|오후)?\s*(\d+)\s*(명|회|시|분|층|건|개|인)(?![간기])/g)) {
    const n = Number(m[2]);
    out.add(`${m[3]}:${n}`);
    if (withPm && m[1] === "오후" && m[3] === "시" && n < 12) out.add(`시:${n + 12}`);
  }
  return out;
}

export function guardAmend(raw: unknown, input: AmendInput): AmendResult {
  const got = raw && typeof raw === "object" && typeof (raw as { amended?: unknown }).amended === "string" ? (raw as { amended: string }).amended : "";
  // AI가 조문 머리를 다시 붙여도 본문만
  const text = got.replace(/^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)\s*/, "").trim();
  if (!text) return { ok: false, reason: "개정 조문이 비어 있음" };
  if (text.length > input.current.length * 3 + 600) return { ok: false, reason: "개정 조문이 지나치게 김(조문 체계 변경 의심)" };
  if (norm(text) === norm(input.current)) return { ok: false, reason: "현행과 바뀐 내용이 없음" };

  // 항 번호 체계: ①부터 차례대로
  const ms = marks(text);
  if (ms.some((m, i) => m !== CIRCLED[i])) return { ok: false, reason: `항 번호가 차례대로가 아님(${ms.join("")})` };
  const curParas = paragraphs(input.current);
  const newParas = paragraphs(text);
  const deleteOk = /삭제|없애|폐지|제외/.test(input.instruction);
  if (newParas.length < curParas.length && !deleteOk) return { ok: false, reason: "개정 방향에 없는 항을 지움" };
  // 항을 지울 때는 번호를 남기고 '삭제'로(법제 관행) — 번호가 줄었으면 버림
  if (ms.length < marks(input.current).length) return { ok: false, reason: "항을 지우면서 번호를 남기지 않음('② 삭제'처럼 써야 함)" };

  const sources = [input.current, input.original ?? "", input.instruction, ...input.upper.map((u) => `${u.label} ${u.text}`)];
  const qty = unverifiedQuantities([text], sources);
  const known = new Set(sources.flatMap((s) => Array.from(counts(s, true))));
  const cnt = Array.from(counts(text)).filter((c) => !known.has(c));
  if (qty.length || cnt.length) {
    const labels = [...qty.map(quantityLabel), ...cnt.map((c) => `${c.split(":")[1]}${c.split(":")[0]}`)];
    return { ok: false, reason: `현행·개정 방향·상위법에 없는 수치(${labels.join(", ")})` };
  }
  const knownLaws = new Set(sources.flatMap(lawRefs));
  const outside = lawRefs(text).filter((n) => !knownLaws.has(n));
  if (outside.length) return { ok: false, reason: `현행·상위법에 없는 법령 인용(${outside.join(", ")})` };
  if (PENALTY.test(text) && !PENALTY.test([input.current, input.original ?? "", input.instruction].join(" "))) return { ok: false, reason: "현행에 없던 제재(벌칙·과태료 등)를 만듦" };

  const warnings: string[] = [];
  const knownArts = new Set(sources.flatMap(articleRefs));
  const newArts = Array.from(new Set(articleRefs(text).filter((n) => !knownArts.has(n))));
  if (newArts.length) warnings.push(`현행에 없던 조문 인용(${newArts.map((n) => `제${n.replace("의", "조의")}${n.includes("의") ? "" : "조"}`).join(", ")}) — 같은 규정에 실제로 있는지 확인하세요.`);

  // 바뀐 곳(항 단위: '제2항 개정'·'제3항 신설') — 개정이유 주요내용·화면 표시에 씀(결정적으로 계산)
  const changes: string[] = [];
  const lead = (p: string) => `제${CIRCLED.indexOf(p.slice(0, 1)) + 1}항`;
  for (let i = 0; i < newParas.length; i++) {
    const n = newParas[i];
    const c = curParas[i];
    if (i === 0) {
      if (n !== c) changes.push("본문 개정");
      continue;
    }
    if (c === undefined) changes.push(`${lead(n)} 신설`);
    else if (/^.\s*삭제/.test(n) && !/^.\s*삭제/.test(c)) changes.push(`${lead(n)} 삭제`);
    else if (n !== c) changes.push(`${lead(n)} 개정`);
  }
  if (!changes.length) return { ok: false, reason: "현행과 바뀐 내용이 없음" };
  return { ok: true, text, changes, warnings };
}
