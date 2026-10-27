import type { CaseDetail } from "./law-api/types";
import { formatLawDate } from "./utils";

/** 판례 인용 표기: 대법원 2026. 1. 29. 선고 2023두54914 판결 */
export function caseCitation(d: Pick<CaseDetail, "kind" | "court" | "date" | "caseNo" | "judgmentType" | "title">): string {
  if (d.kind === "법령해석례") return `${d.court ?? "법제처"} 법령해석례 ${d.caseNo ?? ""}(${formatLawDate(d.date)}) 「${d.title}」`.trim();
  return [d.court, formatLawDate(d.date), "선고", d.caseNo, d.judgmentType ?? "판결"].filter(Boolean).join(" ");
}

/** 검토보고서·민원 회신 붙임용 요지(보고서체): 사건 표기 + 핵심 항목(판시사항·판결요지·참조조문 / 질의요지·회답) */
export function caseBrief(d: CaseDetail, max = 400): string {
  const pick = d.kind === "법령해석례" ? ["질의요지", "회답"] : ["판시사항", "판결요지", "참조조문"];
  const cut = (t: string) => {
    const one = t.replace(/\s+/g, " ").trim();
    return one.length > max ? `${one.slice(0, max)}…` : one;
  };
  const lines = [`○ ${d.kind === "법령해석례" ? "관련 법령해석례" : "관련 판례"}: ${caseCitation(d)}${d.kind === "판례" ? ` 「${d.title}」` : ""}`];
  for (const label of pick) {
    const s = d.sections.find((x) => x.label === label);
    if (s?.text.trim()) lines.push(`  - ${label}: ${cut(s.text)}`);
  }
  lines.push(`  - 출처: 국가법령정보센터(${d.url})`);
  return lines.join("\n");
}

