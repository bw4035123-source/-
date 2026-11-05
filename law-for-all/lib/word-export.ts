/**
 * 문서 내려받기 — 한글(HWPX)·Word(DOCX) 둘 다. 화면의 { title, body(글), html(표) } 묶음을 같은 내용으로 만듦(외부 라이브러리 없음)
 *   downloadHwp(이름, 묶음) → 이름.hwpx (한글 2014 이상)  ·  downloadWord(이름, 묶음) → 이름.docx (MS Word·한글·LibreOffice)
 * 만드는 코드는 누를 때만 불러옴(lib/doc-export)
 */
import type { DocSection } from "./doc-export/model";

export type DocFormat = "hwpx" | "docx";
const MIME: Record<DocFormat, string> = { hwpx: "application/hwp+zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

export async function downloadDoc(filename: string, sections: DocSection[], format: DocFormat): Promise<void> {
  const { sectionsToBlocks } = await import("./doc-export/model");
  const blocks = sectionsToBlocks(sections);
  const bytes = format === "hwpx" ? (await import("./doc-export/hwpx")).blocksToHwpx(blocks, filename) : (await import("./doc-export/docx")).blocksToDocx(blocks, filename);
  const blob = new Blob([bytes as BlobPart], { type: MIME[format] });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.${format}`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
export const downloadWord = (filename: string, sections: DocSection[]) => downloadDoc(filename, sections, "docx");
export const downloadHwp = (filename: string, sections: DocSection[]) => downloadDoc(filename, sections, "hwpx");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export { esc as escapeHtml };
