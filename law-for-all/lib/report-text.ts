import type { AskResult } from "./answer/types";
import { formalCitation } from "./law-api/util";

const GANADA = "가나다라마바사아자차카타파하";
const strip = (t: string) => t.replace(/\[\[[^\]]+\]\]/g, "").replace(/\s+([.,])/g, "$1").trim();
const oneLine = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");

/** 공문서 기안문 '관련 근거' 블록(가. 나. …) */
export function draftBasisBlock(r: AskResult, onlyCited = true): string {
  const cited = new Set(Array.from((r.summary + JSON.stringify(r.officer ?? r.citizen ?? {})).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1]));
  const list = r.citations.filter((c) => !onlyCited || cited.has(c.key) || cited.size === 0);
  return ["관련 근거", ...list.map((c, i) => `  ${GANADA[i] ?? "-"}. ${formalCitation(c)}\n     "${oneLine(c.text)}"`)].join("\n");
}

/** 행정 요약 보고서 텍스트(한글·워드 붙여넣기용) */
export function officerReportText(r: AskResult): string {
  const o = r.officer;
  const lines = [`[법령 검토 요약] ${r.topic?.label ?? r.query}`, "", "1. 검토 결론", `  ${strip(r.summary)}`];
  if (o) {
    if (o.background) lines.push("", "2. 법적 근거 체계", `  ${strip(o.background)}`);
    if (o.keyPoints.length) lines.push("", "3. 주요 쟁점", ...o.keyPoints.map((k, i) => `  ${GANADA[i]}. ${strip(k)}`));
    if (o.adminNotes.length) lines.push("", "4. 업무 처리 유의사항", ...o.adminNotes.map((k, i) => `  ${GANADA[i]}. ${strip(k)}`));
    if (o.checklist.length) lines.push("", "5. 확인 사항", ...o.checklist.map((k) => `  □ ${strip(k)}`));
  }
  lines.push("", draftBasisBlock(r), "", `※ 본 검토는 '모두의 법' AI 보조 결과(${r.provider.label})이며, 최종 판단 전 법령 원문을 확인하시기 바랍니다.`);
  return lines.join("\n");
}

export const REPORT_STORAGE_KEY = "law-for-all:last-report";

const ROLE_NAME = { lawyer: "변호사", prosecutor: "검사", judge: "판사" } as const;
const STATUS_TEXT = { met: "확인됨", unclear: "확인 필요", unmet: "불충족 가능" } as const;

/** 상황 분석 결과 텍스트(공유·붙여넣기용) */
export function analysisText(r: import("./answer/types").AnalyzeResult): string {
  const keyNo = (t: string) => t.replace(/\[\[([^\]]+)\]\]/g, (_, k: string) => {
    const i = r.citations.findIndex((c) => c.key === k);
    return i >= 0 ? `[${i + 1}]` : "";
  });
  const lines = ["[AI 법률 상황 분석]", `상황: ${r.situation}`, "", `쟁점: ${r.issues.map((i) => i.label).join(", ") || "-"}`, "", "■ 추천 관련 법령"];
  r.recommendations.forEach((rec, i) => {
    const c = r.citations.find((x) => x.key === rec.key);
    if (c) lines.push(`  ${i + 1}. ${formalCitation(c)} — ${rec.reason}`);
  });
  for (const a of r.analyses) {
    lines.push("", `■ 쟁점: ${a.issue.label}`);
    const p = a.perspectives;
    lines.push(`  [${ROLE_NAME.lawyer}] ${keyNo(p.lawyer.stance)}`, ...p.lawyer.arguments.map((x) => `    - ${keyNo(x)}`));
    lines.push(`  [${ROLE_NAME.prosecutor}] ${keyNo(p.prosecutor.stance)}`, ...[...p.prosecutor.violations, ...p.prosecutor.sanctions].map((x) => `    - ${keyNo(x)}`));
    lines.push(`  [${ROLE_NAME.judge}] ${keyNo(p.judge.stance)}`, ...p.judge.requirements.map((q) => `    □ ${q.label}: ${STATUS_TEXT[q.status]}`), `    → ${keyNo(p.judge.outlook)}`);
  }
  lines.push("", "※ AI 역할 시뮬레이션 결과이며 법률 자문·판결이 아닙니다.");
  return lines.join("\n");
}
