/**
 * 한 번에 개정 — 규정·조례·법령 조문을 붙여 넣고 "개정해줘"·"수정해줘"라고만 하면
 * 생성형 AI가 개정안을 쓰고(가드: lib/amend-ai.ts guardAmend), 결과는 정해진 3가지 양식으로 결정적으로 조립한다.
 *   1. [개정 이유 및 핵심 요약] 2. [개정 조문 전문] 3. [신·구조문대비표](| 현행 | 개정안 |, 바뀐 말 **굵게**)
 * 요청 분리·조문 나누기는 Python 판 python/law_for_all/amend_quick.py 와 같음. 표 조립은 화면(브라우저)에서.
 */
import { diffWords } from "./drafting";

export interface QuickArticle {
  label: string; // 제5조(처리기간) — 조 머리가 없으면 "(조문)"
  text: string; // 본문
}

const REQUEST_LINE = /(개정|수정|다듬|고쳐|바꿔|정비|손봐|보완)\s*(?:해\s*)?(?:줘|주세요|주십시오|줄래|달라|하라|해라|해)?\s*[.!?~]*\s*$/;

/** 붙여 넣은 글 → (요청 문장, 조문들). 요청 문장은 '개정해줘'처럼 끝나는 줄(조 머리로 시작하지 않는 줄) */
export function splitQuick(input: string): { request: string; articles: QuickArticle[] } {
  const lines = input.replace(/\r/g, "").split("\n");
  const req: string[] = [];
  const body: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (t && !/^제\s*\d+\s*조/.test(t) && REQUEST_LINE.test(t) && t.length <= 200) req.push(t);
    else body.push(l);
  }
  const text = body.join("\n").trim();
  const articles: QuickArticle[] = [];
  for (const l of text.split("\n")) {
    const m = l.trim().match(/^(제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?)\s*(.*)$/);
    if (m) articles.push({ label: m[1].replace(/^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*/, (_x, n: string, b?: string) => `제${n}조${b ? `의${b}` : ""}`).trim(), text: m[2].trim() });
    else if (articles.length && l.trim()) articles[articles.length - 1].text += `\n${l.trim()}`;
    else if (l.trim()) articles.push({ label: "(조문)", text: l.trim() });
  }
  // 조 머리 없는 여러 줄은 한 조문으로
  const merged: QuickArticle[] = [];
  for (const a of articles) {
    const last = merged[merged.length - 1];
    if (last && last.label === "(조문)" && a.label === "(조문)") last.text += `\n${a.text}`;
    else merged.push({ ...a });
  }
  return { request: req.join(" ") || "개정해줘", articles: merged.filter((a) => a.text) };
}

export const QUICK_SYSTEM = `너는 공공기관 규정·조례·법령 개정을 돕는 법제 전문 AI다.
[절대 규칙]
1. <개정요청>에 구체적인 내용이 있으면 그대로 반영한다. "개정해줘·수정해줘"처럼 구체 내용이 없으면, 내용(의무·기준·수치)은 바꾸지 않고 공공기관 공문서·법제 표준 문체로 다듬는다: 맞춤법·띄어쓰기, 법령 용어 정비(예: "~해야 한다" → "~하여야 한다"), 모호한 표현의 명확화, 항·호 구성 정리. 다만 <상위조문>의 기준에 어긋나는 부분은 상위 기준에 맞게 고친다. 어긋나는 조항은 삭제하지 말고 상위조문이 정한 기준(대상·기간·일수)을 그대로 옮겨 고쳐 쓴다. 단, 상위조문이 이 조문과 같은 대상·사항을 직접 정할 때만 상위 기준으로 고친다. 적용 대상이 다른 상위조문(특정 유형의 민원·근로자에만 적용되는 기준 등)은 근거로 삼지 않고, 현행 기준을 완화(횟수 제한·기한·요건 삭제)하지 않는다. 판단이 서지 않으면 내용은 그대로 두고 문체만 다듬는다.
2. 바꿀 필요가 없는 조문은 결과에서 뺀다. 조 번호·조 제목은 그대로 둔다.
3. 수치(기간·금액·인원·비율)는 <조문>·<개정요청>·<상위조문>에 있는 값만 쓴다. <상위조문>에 없는 법령명을 새로 쓰지 않는다. 벌칙·과태료 같은 제재를 새로 만들지 않는다.
4. 의무(~하여야 한다)를 재량(~할 수 있다)으로, 또는 그 반대로 바꾸지 않는다(요청이나 상위 기준이 그렇게 요구할 때만).
5. 항이 둘 이상이면 ①②③…을 차례대로 붙인다. 조 머리(제N조(제목))는 amended 에 쓰지 않는다.
6. summary 는 무엇이 왜 바뀌는지 1~2문장(공문서체, ~함)으로 쓴다. 서론·인사말·덧붙임 말은 쓰지 않는다.
7. 출력은 {"summary":"","articles":[{"label":"제5조(처리기간)","amended":"개정한 본문 전체"}]} 형식의 JSON 객체 하나만 출력한다.`;

export function buildQuickPrompt(request: string, articles: QuickArticle[], upper: { label: string; text: string }[]): string {
  const arts = articles.map((a) => `${a.label} ${a.text}`).join("\n");
  const up = upper.length ? upper.map((u) => `<<${u.label}>>\n${u.text.slice(0, 1200)}`).join("\n\n") : "(찾은 상위조문 없음)";
  return `<개정요청>\n${request}\n</개정요청>\n\n<조문>\n${arts}\n</조문>\n\n<상위조문>\n${up}\n</상위조문>\n\n위 조문의 개정안을 JSON으로 답하라.`;
}

/** "개정해줘"처럼 구체 내용이 없는 요청인지 */
export function isBareRequest(request: string): boolean {
  return !/\d/.test(request) && request.replace(REQUEST_LINE, "").replace(/[\s.,!?~]/g, "").length <= 6;
}
const QTY = /\d+(?:\.\d+)?\s*(?:퍼센트|개월|시간|만원|일|년|분|원|명|%|회)/g;
/** 구체 요청 없이 수치(기간·금액·횟수)가 바뀌면 담당자 확인 경고 — 새 수치를 모두 담은 상위 조문이 있으면 그 조문을 밝힘 */
export function quantityWarning(request: string, current: string, amended: string, upper: { label: string; text: string }[] = []): string | null {
  if (!isBareRequest(request)) return null;
  const q = (t: string) => new Set((t.match(QTY) ?? []).map((x) => x.replace(/\s/g, "")));
  const a = q(current);
  const b = q(amended);
  const added = Array.from(b).filter((x) => !a.has(x));
  const removed = Array.from(a).filter((x) => !b.has(x));
  if (!added.length && !removed.length) return null;
  const diff = [removed.length ? `삭제 ${removed.join(", ")}` : "", added.length ? `추가 ${added.join(", ")}` : ""].filter(Boolean).join(" / ");
  const src = added.length && !removed.length ? upper.find((u) => added.every((x) => u.text.replace(/\s/g, "").includes(x))) : undefined;
  return src ? `수치 ${diff}: ${src.label} 기준을 옮김 — 우리 규정의 적용 대상과 같은지 확인 필요` : `요청에 없던 수치 변경(${diff}) — 상위 기준이 이 조문에 그대로 적용되는지 확인 필요`;
}

const LIMIT = /한\s?번|한\s?차례|1회|두\s?번|두\s?차례|2회|이내|이상|이하|초과|미만|까지/g;
/** 구체 요청 없이 횟수·한도 표현이 빠지면(기준 완화) 담당자 확인 경고 */
export function limitWarning(request: string, current: string, amended: string): string | null {
  if (!isBareRequest(request)) return null;
  const norm = (x: string) => x.replace(/\s/g, "").replace("한번", "한차례").replace("두번", "두차례");
  const after = new Set((amended.match(LIMIT) ?? []).map(norm));
  const lost = Array.from(new Set((current.match(LIMIT) ?? []).map(norm))).filter((x) => !after.has(x) && !(x === "까지" && after.has("이내")));
  return lost.length ? `제한 표현(${lost.join(", ")})이 빠짐 — 기준을 완화하는 개정인지 확인 필요` : null;
}

// ───────────── 3가지 양식(화면·복사용)
const esc = (s: string) => s.replace(/\|/g, "\\|");
/** 신·구 대비 한 칸: 바뀐 말만 **굵게**, 줄바꿈은 <br> */
export function diffCells(oldText: string, newText: string): { old: string; new: string } {
  const d = diffWords(oldText, newText);
  const cell = (parts: { text: string; op: string }[], mark: string) =>
    parts
      .map((p) => (p.op === mark && p.text.trim() ? p.text.replace(/(\S(?:.*\S)?)/s, "**$1**") : p.text))
      .join("")
      .replace(/\*\*(\s*)\*\*/g, "$1")
      .split("\n")
      .map(esc)
      .join("<br>");
  return { old: cell(d.old, "del"), new: cell(d.new, "ins") };
}

export interface QuickResultArticle {
  label: string;
  current: string;
  amended: string;
}

export function quickMarkdown(summary: string, arts: QuickResultArticle[]): string {
  const full = arts.map((a) => `${a.label === "(조문)" ? "" : `${a.label} `}${a.amended}`).join("\n");
  const rows = arts.map((a) => {
    const c = diffCells(a.current, a.amended);
    const head = a.label === "(조문)" ? "" : `${esc(a.label)} `;
    return `| ${head}${c.old} | ${head}${c.new} |`;
  });
  return [`**1. [개정 이유 및 핵심 요약]**`, summary, "", `**2. [개정 조문 전문]**`, full, "", `**3. [신·구조문대비표]**`, "", "| 현행 | 개정안 |", "|---|---|", ...rows].join("\n");
}
