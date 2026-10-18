export { ask } from "@/lib/answer/ask";
export { analyze } from "@/lib/answer/analyze";
export { crossCheck, amendedText, complianceReport, SAMPLE_REGULATIONS, TARGET_LAWS, ORG_TYPES, SEVERITY_LABEL, regArticleLabel } from "@/lib/compliance";
export { extractText, ACCEPT } from "@/lib/doc-extract";
export { diffWords } from "@/lib/drafting";
export { MOCK_LAWS, getMockLaw, MOCK_DATASET_DATE } from "@/lib/law-api/mock";
export { TOPICS } from "@/lib/law-api/mock/topics";
export { articleLabel, toCitation } from "@/lib/law-api/util";
export { CITIZEN_SUGGESTIONS, OFFICER_SUGGESTIONS } from "@/lib/suggestions";
const MARKER = /\[\[([^\]\s]+)\]\]/g;
export function splitCitedSentences(text: string): { keys: string[]; text: string }[] {
  const norm = text.replace(/([.?!])\s*((?:\[\[[^\]\s]+\]\]\s*)+)/g, " $2$1 ");
  return norm
    .split(/(?<=[.?!])\s+(?=\S)/)
    .map((raw) => ({
      keys: Array.from(new Set(Array.from(raw.matchAll(MARKER), (m) => m[1]))),
      text: raw.replace(MARKER, "").replace(/\s+([.,?!])/g, "$1").replace(/\s{2,}/g, " ").trim(),
    }))
    .filter((x) => x.text);
}
