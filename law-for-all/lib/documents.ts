/**
 * 공직자 실무 문서 한 번에 작성 — 질의 결과(AskResult)로 검토 보고서·기안문·민원 회신문을 생성.
 * 생성형 문장이 아니라 검증된 답변·근거 조문 원문·판례 목록만 공문서 서식에 배치한다(순수 함수).
 */
import type { AskResult } from "./answer/types";
import type { CaseItem, Citation } from "./law-api/types";
import { formalCitation } from "./law-api/util";

export interface DocOptions {
  dept?: string; // 부서명
  author?: string; // 담당자
  phone?: string; // 연락처
  title?: string; // 사용자가 고친 제목
  cases?: CaseItem[]; // 관련 판례(불러온 경우)
  date?: Date;
}

const GA = "가나다라마바사아자차카타파하";
const strip = (t: string) => t.replace(/\[\[[^\]]+\]\]/g, "").replace(/\s+([.,])/g, "$1").replace(/ {2,}/g, " ").trim();
const oneLine = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
const ymd = (d: Date) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
const fmtDate = (raw?: string) => (raw && /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}. ${Number(raw.slice(4, 6))}. ${Number(raw.slice(6))}.` : raw ?? "");

/** 해요체 → 보고서체(~함/~임) */
const REPORT: [RegExp, string][] = [
  [/있어요\./g, "있음."], [/없어요\./g, "없음."], [/해요\./g, "함."], [/돼요\./g, "됨."], [/(?:이에요|예요)\./g, "임."],
  [/받아요\./g, "받음."], [/빠져요\./g, "제외됨."], [/생겨요\./g, "생김."], [/줘요\./g, "줌."], [/봐요\./g, "봄."], [/와요\./g, "옴."], [/가요\./g, "감."],
  [/요\./g, "."],
];
/** 해요체 → 합니다체(민원 회신문) */
const FORMAL: [RegExp, string][] = [
  [/있어요\./g, "있습니다."], [/없어요\./g, "없습니다."], [/해요\./g, "합니다."], [/돼요\./g, "됩니다."], [/(?:이에요|예요)\./g, "입니다."],
  [/받아요\./g, "받습니다."], [/빠져요\./g, "제외됩니다."], [/생겨요\./g, "생깁니다."], [/줘요\./g, "줍니다."], [/봐요\./g, "봅니다."],
  [/함\./g, "합니다."], [/임\./g, "입니다."], [/됨\./g, "됩니다."],
];
export const toReportStyle = (t: string) => REPORT.reduce((acc, [re, to]) => acc.replace(re, to), t);
export const toFormalStyle = (t: string) => FORMAL.reduce((acc, [re, to]) => acc.replace(re, to), t);

/** 본문에서 실제로 인용된 조문만(없으면 전체) */
export function citedOnly(r: AskResult): Citation[] {
  const keys = new Set(Array.from(JSON.stringify([r.summary, r.officer ?? null, r.citizen ?? null]).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1]));
  const list = r.citations.filter((c) => keys.has(c.key));
  return list.length ? list : r.citations.slice(0, 4);
}

export function defaultTitle(r: AskResult): string {
  return `${r.topic?.label ?? r.query.slice(0, 30)} 관련 법령 검토 결과 보고`;
}

const caseLine = (c: CaseItem) => `${c.court ?? (c.kind === "판례" ? "법원" : "법제처")} ${fmtDate(c.date)} ${c.caseNo ?? ""} ${c.kind === "판례" ? "판결" : "해석"} 「${c.title}」`.replace(/ {2,}/g, " ").trim();

/** 1) 검토 보고서(내부 보고용) */
export function reviewReport(r: AskResult, o: DocOptions = {}): string {
  const d = o.date ?? new Date();
  const cites = citedOnly(r);
  const off = r.officer;
  const lines = [
    o.title ?? defaultTitle(r),
    "",
    `${ymd(d)}  ${o.dept ?? "○○과"}${o.author ? ` (담당: ${o.author})` : ""}`,
    "",
    "1. 검토 개요",
    `  가. 검토 요청: ${r.query}`,
    `  나. 검토 결론: ${toReportStyle(strip(r.summary))}`,
    "",
    "2. 관련 근거",
    ...cites.map((c, i) => `  ${GA[i]}. ${formalCitation(c)}`),
  ];
  if (off?.background) lines.push("", "3. 법적 근거 체계", `  ${strip(off.background)}`);
  if (off?.keyPoints.length) lines.push("", "4. 주요 검토 내용", ...off.keyPoints.map((k, i) => `  ${GA[i]}. ${strip(k)}`));
  if (o.cases?.length) lines.push("", "5. 관련 판례·해석례", ...o.cases.slice(0, 5).map((c, i) => `  ${GA[i]}. ${caseLine(c)}`));
  if (off?.adminNotes.length) lines.push("", "6. 업무 처리 시 유의사항", ...off.adminNotes.map((k, i) => `  ${GA[i]}. ${strip(k)}`));
  lines.push("", "7. 조치 계획(안)", "  가. 위 검토 결과에 따라 처리하고, 처리 결과를 민원인(요청 부서)에 통보", "  나. 유사 사례 발생 시 동일 기준 적용");
  if (off?.checklist.length) lines.push("", "※ 처리 전 확인 사항", ...off.checklist.map((k) => `  □ ${strip(k)}`));
  lines.push("", "붙임  관련 조문 원문 1부.  끝.");
  return lines.join("\n");
}

/** 2) 기안문(내부결재, 행정업무운영 편람 형식) */
export function draftDocument(r: AskResult, o: DocOptions = {}): string {
  const cites = citedOnly(r);
  const title = o.title ?? defaultTitle(r);
  const off = r.officer;
  const points = (off?.keyPoints ?? []).map((k, i) => `      ${i + 1}) ${strip(k)}`);
  return [
    "수신  내부결재",
    "(경유)",
    `제목  ${title}`,
    "",
    "1. 관련",
    ...cites.map((c, i) => `  ${GA[i]}. ${formalCitation(c)}`),
    "",
    `2. ${r.query.length > 40 ? "위 호와 관련된 사항" : `‘${r.query}’`}에 대하여 관계 법령을 검토한 결과를 다음과 같이 보고합니다.`,
    `  가. 검토 결과: ${toReportStyle(strip(r.summary))}`,
    ...(points.length ? ["  나. 주요 내용", ...points] : []),
    `  ${points.length ? "다" : "나"}. 향후 조치: ${(off?.adminNotes ?? []).map(strip).join(" / ") || "검토 결과에 따라 처리"}`,
    "",
    "붙임  1. 법령 검토 보고서 1부.",
    "      2. 관련 조문 원문 1부.  끝.",
    "",
    `${o.dept ?? "○○과"}  담당 ${o.author ?? "○○○"}${o.phone ? `  (☎ ${o.phone})` : ""}`,
  ].join("\n");
}

/** 3) 민원 회신문(민원인 대상, 쉬운 문체) */
export function civilReply(r: AskResult, o: DocOptions = {}): string {
  const cites = citedOnly(r);
  // 해요체·보고서체를 회신문체(~합니다/~입니다)로
  const summary = toFormalStyle(strip(r.summary));
  const steps = r.citizen?.steps ?? [];
  const contacts = r.contacts.filter((c) => c.phone || c.url).slice(0, 3);
  return [
    `제목  ${r.topic?.label ?? "문의하신 사항"}에 대한 민원 회신`,
    "",
    "1. 평소 행정에 관심을 가져 주셔서 감사드립니다.",
    `2. 귀하께서 문의하신 ‘${r.query}’에 대하여 관계 법령을 검토한 결과를 다음과 같이 알려 드립니다.`,
    `  가. 검토 결과: ${summary}`,
    "  나. 관련 법령",
    ...cites.map((c, i) => `    ${i + 1}) ${formalCitation(c)}: ${oneLine(c.text).slice(0, 160)}${oneLine(c.text).length > 160 ? "…" : ""}`),
    ...(steps.length ? ["  다. 안내 사항", ...steps.map((s, i) => `    ${i + 1}) ${s.title}: ${toFormalStyle(strip(s.detail))}`)] : []),
    ...(contacts.length ? [`  ${steps.length ? "라" : "다"}. 도움받을 수 있는 기관`, ...contacts.map((c, i) => `    ${i + 1}) ${c.name}${c.phone ? ` ☎ ${c.phone}` : ""}${c.url ? ` ${c.url}` : ""} — ${c.desc}`)] : []),
    `3. 이 회신은 법령에 대한 일반적인 안내로서 구체적인 사실관계에 따라 달라질 수 있습니다. 추가로 궁금하신 사항은 ${o.dept ?? "○○과"}${o.author ? ` ${o.author}` : ""}${o.phone ? `(☎ ${o.phone})` : ""}에게 문의하여 주시면 친절히 안내해 드리겠습니다. 끝.`,
  ].join("\n");
}

/** 붙임: 관련 조문 원문 */
export function attachmentArticles(r: AskResult): string {
  return ["붙임 2  관련 조문 원문", "", ...citedOnly(r).flatMap((c) => [formalCitation(c), c.text, ""])].join("\n");
}
