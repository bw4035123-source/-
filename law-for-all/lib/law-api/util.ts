import type { Citation, LawArticle, LawDoc } from "./types";

export const articleKey = (lawId: string, no: string) => `${lawId}:${no}`;

export function parseArticleKey(key: string): { lawId: string; articleNo: string } | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  return { lawId: key.slice(0, i), articleNo: key.slice(i + 1) };
}

/** 화면 앵커 id: "3의2" → "jo-3-2" */
export const articleAnchor = (no: string) => `jo-${no.replace(/의/g, "-")}`;

/** "3의2" → "제3조의2" */
export const articleLabel = (no: string) => {
  const [main, branch] = no.split("의");
  return `제${main}조${branch ? `의${branch}` : ""}`;
};

/** 국가법령정보센터 조문 바로가기 */
export function lawGoKrUrl(lawName: string, no?: string): string {
  const base = "https://www.law.go.kr/법령/" + encodeURIComponent(lawName);
  return no ? `${base}/${encodeURIComponent(articleLabel(no))}` : base;
}

export function toCitation(law: LawDoc, article: LawArticle): Citation {
  return {
    key: articleKey(law.id, article.no),
    lawId: law.id,
    lawName: law.name,
    lawKind: law.kind,
    articleNo: article.no,
    title: article.title,
    text: article.text,
    url: lawGoKrUrl(law.name, article.no),
    source: law.source,
  };
}

/** 공문서·기안문 인용 형식: 「법령명」 제N조(제목) */
export function formalCitation(c: Pick<Citation, "lawName" | "articleNo" | "title">): string {
  return `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`;
}

/** 기안문 붙여넣기용 인용문 블록 */
export function draftQuote(c: Citation): string {
  const body = c.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  return `${formalCitation(c)}에 따르면, "${body}"라고 규정하고 있음.`;
}
