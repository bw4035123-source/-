/**
 * 규정 제·개정 지원 — 순수 함수(브라우저·서버 공용, 단위 테스트 대상)
 *  - 개정 방향 문장 해석 → 개정안 자동 반영(치환·삭제·신설)
 *  - 신·구조문 대비(단어 단위 차이)
 *  - 정합성 점검(숫자 변경, 상위법 기한·금액 비교, 조문 인용, 규제 신설·강화 표현)
 *  - 개정이유·부칙·입법예고문·절차 체크리스트 초안
 * 생성형 AI 없이 동작하며, 모든 결과는 담당자가 검토·수정하는 초안이다.
 */

export type DraftKind = "법령" | "자치법규" | "행정규칙";

export interface Edit {
  type: "replace" | "delete" | "append";
  from?: string;
  to?: string;
  text?: string;
}

const OPEN = "[‘'\"“「]";
const CLOSE = "[’'\"”」]";
const VERB = "(?:변경|바꾸|바꿈|수정|단축|연장|상향|하향|조정|개정|완화|강화|확대|축소|정정|대체|통일|고침)";

/**
 * 개정 방향 문장 해석(우선순위: 따옴표 표현 → "A에서 B로" → 한 단어 "A을 B로 …변경")
 *  예) "처리기간을 7일에서 5일로 단축" → 7일 → 5일
 *      "‘민원인’을 ‘신청인’으로 변경" → 민원인 → 신청인
 *      "‘다만, 기타민원은’ 삭제" / "신설: ③ …"
 */
export function parseInstruction(instruction: string): Edit[] {
  const edits: Edit[] = [];
  // 신설 문장은 먼저 떼어 냄(신설 내용 속 '…을 제외한다' 등을 지시로 오해하지 않도록)
  const appends = Array.from(instruction.matchAll(/(?:신설|추가|새로\s*두)\s*[:：]\s*(.+)/g), (m) => m[1].trim());
  const text = instruction.replace(/\r/g, "").replace(/(?:신설|추가|새로\s*두)\s*[:：]\s*.+/g, "");
  const add = (e: Edit) => {
    if (e.type !== "append" && (!e.from || edits.some((x) => x.from === e.from))) return;
    if (e.type === "replace" && e.from === e.to) return;
    edits.push(e);
  };
  // 1) 따옴표로 묶은 표현(공백 포함 가능)
  for (const m of Array.from(text.matchAll(new RegExp(`${OPEN}([^’'"”」]{1,60})${CLOSE}\\s*(?:을|를|에서|은|는)\\s*${OPEN}([^’'"”」]{1,60})${CLOSE}\\s*(?:으로|로)`, "g"))))
    add({ type: "replace", from: m[1].trim(), to: m[2].trim() });
  // 2) A에서 B로 (예: 7일에서 5일로)
  for (const m of Array.from(text.matchAll(/([^\s'"‘’“”「」]{1,20}?)\s*에서\s+([^\s'"‘’“”「」]{1,20}?)(?:으로|로)(?=\s|$|[,.])/g)))
    add({ type: "replace", from: m[1].trim(), to: m[2].trim() });
  // 3) 한 단어 A을/를 B(으)로 + 변경 동사
  for (const m of Array.from(text.matchAll(new RegExp(`([^\\s'"‘’“”「」]{1,20}?)(?:을|를)\\s+([^\\s'"‘’“”「」]{1,20}?)(?:으로|로)\\s*${VERB}`, "g"))))
    if (!m[1].includes("에서") && !m[2].includes("에서")) add({ type: "replace", from: m[1].trim(), to: m[2].trim() });
  // 4) 삭제
  for (const m of Array.from(text.matchAll(new RegExp(`${OPEN}([^’'"”」]{1,80})${CLOSE}\\s*(?:을|를)?\\s*(?:삭제|제외)`, "g")))) add({ type: "delete", from: m[1].trim() });
  for (const m of Array.from(text.matchAll(/(?:^|\s)([^\s'"‘’“”「」]{1,20}?)(?:을|를)\s*(?:삭제|제외)/g))) add({ type: "delete", from: m[1].trim() });
  // 5) 신설
  for (const t of appends) add({ type: "append", text: t });
  return edits;
}

export interface ApplyResult {
  text: string;
  applied: Edit[];
  notFound: Edit[];
}

/** 개정 방향을 현행 조문에 반영(찾지 못한 표현은 notFound 로 돌려줌) */
export function applyEdits(current: string, edits: Edit[]): ApplyResult {
  let text = current;
  const applied: Edit[] = [];
  const notFound: Edit[] = [];
  for (const e of edits) {
    if (e.type === "append" && e.text) {
      text = `${text.trimEnd()}\n${nextParagraphMark(text)} ${e.text}`;
      applied.push(e);
    } else if (e.from && text.includes(e.from)) {
      text = text.split(e.from).join(e.type === "delete" ? "" : e.to ?? "");
      // 삭제로 생긴 겹친 공백만 정리(줄 앞 들여쓰기 — 호·목 — 는 유지)
      text = text.replace(/(\S) {2,}/g, "$1 ").replace(/(\S) ([,.])/g, "$1$2");
      applied.push(e);
    } else {
      notFound.push(e);
    }
  }
  return { text, applied, notFound };
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function nextParagraphMark(text: string): string {
  let last = -1;
  for (const ch of text) {
    const i = CIRCLED.indexOf(ch);
    if (i > last) last = i;
  }
  return last >= 0 && last < CIRCLED.length - 1 ? CIRCLED[last + 1] : "②";
}

// ───────────── 신·구조문 대비(단어 단위 LCS)
export interface DiffPart {
  text: string;
  op: "same" | "del" | "ins";
}

const tokenize = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

export function diffWords(oldText: string, newText: string): { old: DiffPart[]; new: DiffPart[] } {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  // 매우 긴 조문은 줄 단위로 비교해 연산량 제한
  if (n * m > 400000) return diffLines(oldText, newText);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const oldParts: DiffPart[] = [];
  const newParts: DiffPart[] = [];
  const push = (arr: DiffPart[], text: string, op: DiffPart["op"]) => {
    const last = arr[arr.length - 1];
    if (last && last.op === op) last.text += text;
    else arr.push({ text, op });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(oldParts, a[i], "same");
      push(newParts, b[j], "same");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push(oldParts, a[i++], "del");
    else push(newParts, b[j++], "ins");
  }
  while (i < n) push(oldParts, a[i++], "del");
  while (j < m) push(newParts, b[j++], "ins");
  return { old: oldParts, new: newParts };
}

function diffLines(oldText: string, newText: string) {
  const o = oldText.split("\n");
  const nw = newText.split("\n");
  return {
    old: o.map((l) => ({ text: l + "\n", op: (nw.includes(l) ? "same" : "del") as DiffPart["op"] })),
    new: nw.map((l) => ({ text: l + "\n", op: (o.includes(l) ? "same" : "ins") as DiffPart["op"] })),
  };
}

// ───────────── 정합성 점검
export interface Check {
  level: "ok" | "warn" | "info";
  title: string;
  detail: string;
}

const NUM_RE = /(\d[\d,.]*)\s*(퍼센트|%|일|개월|년|시간|만원|천만원|억원|원|회|명|배)/g;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

export function numericTerms(text: string): { value: number; unit: string; raw: string }[] {
  return Array.from(text.matchAll(NUM_RE), (m) => ({ value: toNum(m[1]), unit: m[2] === "%" ? "퍼센트" : m[2], raw: m[0] }));
}

export interface UpperArticle {
  label: string; // 「법」 제N조
  text: string;
}

export function consistencyChecks(params: { current: string; amended: string; lawArticleNos?: string[]; upper?: UpperArticle[] }): Check[] {
  const { current, amended, lawArticleNos, upper = [] } = params;
  const checks: Check[] = [];
  if (current.trim() === amended.trim()) {
    checks.push({ level: "info", title: "변경 없음", detail: "개정안이 현행과 같습니다. 개정 방향을 입력하거나 개정안을 직접 수정하세요." });
    return checks;
  }

  // 1) 숫자(기간·금액·비율) 변경
  const before = numericTerms(current).map((t) => t.raw);
  const after = numericTerms(amended).map((t) => t.raw);
  const removed = before.filter((x) => !after.includes(x));
  const added = after.filter((x) => !before.includes(x));
  if (removed.length || added.length)
    checks.push({ level: "info", title: "기간·금액·비율 변경", detail: `현행 [${removed.join(", ") || "-"}] → 개정 [${added.join(", ") || "-"}]` });

  // 2) 상위법·관련 조문의 같은 단위 수치와 비교(기한·상한 초과 가능성)
  for (const u of upper) {
    const limits = Array.from(u.text.matchAll(/(\d[\d,.]*)\s*(일|개월|년|만원|원|퍼센트)\s*(이내|이하|미만|까지|를 넘지|을 넘지|초과하지)/g), (m) => ({ value: toNum(m[1]), unit: m[2], raw: m[0] }));
    for (const t of numericTerms(amended).filter((x) => added.includes(x.raw))) {
      const lim = limits.find((l) => l.unit === t.unit);
      if (lim && t.value > lim.value)
        checks.push({ level: "warn", title: "상위법 기준 초과 가능", detail: `개정안의 '${t.raw}'이(가) ${u.label}의 '${lim.raw}'보다 큽니다. 위임 범위를 벗어나지 않는지 확인하세요.` });
    }
  }

  // 3) 조문 인용 확인
  if (lawArticleNos?.length) {
    const nos = new Set(lawArticleNos);
    const bad = Array.from(amended.matchAll(/(?<!「[^」]*)제(\d+)조(?:의(\d+))?/g))
      .map((m) => (m[2] ? `${m[1]}의${m[2]}` : m[1]))
      .filter((no) => !nos.has(no));
    const uniq = Array.from(new Set(bad));
    if (uniq.length) checks.push({ level: "warn", title: "인용 조문 확인", detail: `같은 법령에서 찾을 수 없는 조문 인용: ${uniq.map((n) => `제${n.replace("의", "조의")}${n.includes("의") ? "" : "조"}`).join(", ")}` });
  }

  // 4) 규제 신설·강화 표현
  const REG = ["하여야 한다", "해야 한다", "아니 된다", "금지", "허가", "승인", "과태료", "벌금", "징역", "취소할 수 있다", "정지", "제한"];
  const newReg = REG.filter((w) => amended.split(w).length > current.split(w).length);
  if (newReg.length)
    checks.push({ level: "warn", title: "규제 신설·강화 여부 검토", detail: `새로 늘어난 의무·제재 표현: ${newReg.map((w) => `‘${w}’`).join(", ")} — 규제영향분석·규제심사 대상인지 확인하세요.` });

  // 5) 문장 형식
  const lastLine = amended.trim().split("\n").pop() ?? "";
  if (!/^\s*(\d+\.|[가-하]\.)/.test(lastLine) && !/다\.\s*$/.test(lastLine)) checks.push({ level: "info", title: "문장 끝맺음", detail: "조문의 마지막 문장이 '~다.'로 끝나는지 확인하세요." });

  if (!checks.some((c) => c.level === "warn")) checks.push({ level: "ok", title: "자동 점검 이상 없음", detail: "자동으로 찾을 수 있는 문제는 없습니다. 법제 심사 기준에 따라 최종 검토하세요." });
  return checks;
}

// ───────────── 문서 초안
export interface DraftMeta {
  kind: DraftKind;
  lawName: string;
  articleLabel: string; // 제N조(제목)
  instruction: string;
  dept?: string;
  effectiveDays?: number;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

export function reasonDraft(meta: DraftMeta, applied: Edit[]): string {
  const items = applied.map((e) =>
    e.type === "replace" ? `‘${e.from}’을(를) ‘${e.to}’(으)로 변경` : e.type === "delete" ? `‘${e.from}’ 삭제` : `조항 신설(${(e.text ?? "").slice(0, 30)}${(e.text ?? "").length > 30 ? "…" : ""})`,
  );
  const why = meta.instruction
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && !/^(신설|추가)\s*[:：]/.test(x))
    .join(", ");
  return [
    "◇ 개정이유",
    `  ${why ? `${why} 등` : "(개정 필요성을 적어 주세요)"} 「${meta.lawName}」 ${meta.articleLabel}의 내용을 정비하려는 것임.`,
    "",
    "◇ 주요내용",
    ...(items.length ? items.map((t, i) => `  ${"가나다라마바사"[i] ?? "-"}. ${meta.articleLabel} 중 ${t}함.`) : ["  가. (주요 개정 내용을 적어 주세요)"]),
  ].join("\n");
}

export function addendaDraft(meta: DraftMeta): string {
  const days = meta.effectiveDays ?? 0;
  return [
    "부      칙",
    `제1조(시행일) 이 ${meta.kind === "행정규칙" ? "규정" : meta.kind === "자치법규" ? "조례(규칙)" : "법"}은 ${days > 0 ? `공포 후 ${days}일이 경과한 날부터` : "공포한 날부터"} 시행한다.`,
    `제2조(적용례 또는 경과조치) 이 ${meta.kind === "행정규칙" ? "규정" : "법"} 시행 당시 종전의 규정에 따라 진행 중인 사항은 종전의 규정에 따른다.`,
  ].join("\n");
}

export function noticeDraft(meta: DraftMeta, reason: string): string {
  const what = meta.kind === "자치법규" ? "조례(규칙) 일부개정조례안" : meta.kind === "행정규칙" ? "규정 일부개정안" : "일부개정법률안";
  return [
    `${meta.dept ?? "○○○"} 공고 제${new Date().getFullYear()}-○○호`,
    "",
    `「${meta.lawName}」 ${what} 입법예고`,
    "",
    `「${meta.lawName}」을(를) 개정함에 있어 그 취지와 주요 내용을 미리 알려 의견을 듣고자 ${meta.kind === "자치법규" ? "「행정절차법」 및 관련 조례" : "「행정절차법」"}에 따라 다음과 같이 공고합니다.`,
    "",
    `${today()}`,
    `${meta.dept ?? "○○○"}장`,
    "",
    "1. 개정이유 및 주요내용",
    reason.replace(/^/gm, "  "),
    "",
    "2. 의견제출",
    "  이 개정안에 대하여 의견이 있는 기관·단체 또는 개인은 예고기간 내에 다음 사항을 기재한 의견서를 제출하여 주시기 바랍니다.",
    "  가. 예고사항에 대한 의견(찬반 여부와 그 사유)",
    "  나. 성명(단체의 경우 단체명과 대표자명), 주소 및 전화번호",
    "  다. 제출처: (담당 부서·주소·전자우편)",
    "",
    "3. 그 밖의 사항",
    "  개정안 전문은 담당 부서에 요청하거나 누리집에서 확인할 수 있습니다.",
  ].join("\n");
}

export function procedureChecklist(kind: DraftKind): string[] {
  const common = ["개정 필요성·현황 자료 정리", "상위법 위임 근거 및 범위 확인", "관계 부서·기관 협의", "신·구조문 대비표 작성"];
  if (kind === "법령") return [...common, "규제영향분석서 작성(규제 신설·강화 시)", "입법예고(40일 이상)", "규제개혁위원회 심사", "법제처 심사", "차관·국무회의 심의", "공포"];
  if (kind === "자치법규") return [...common, "입법예고(20일 이상)", "규제 심사(해당 시)", "조례·규칙심의회 심의", "지방의회 의결(조례)", "공포 및 보고"];
  return [...common, "자체 법률 검토", "행정규칙 심사·등록(법제처 법령정보시스템)", "발령 및 게시"];
}
