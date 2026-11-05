/** Word(DOCX, Office Open XML) 만들기 — 문단·굵게·밑줄·취소선·표·쪽 나눔. 글꼴은 맑은 고딕 */
import { columnRatios, type Block, type Para, type Run } from "./model";
import { makeZip } from "./zip";

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = '<w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/>';

function run(r: Run, heading?: boolean): string {
  const pr = `${FONT}${r.b || heading ? "<w:b/>" : ""}${r.s ? "<w:strike/>" : ""}${r.u ? '<w:u w:val="single"/>' : ""}<w:sz w:val="${heading ? 26 : 21}"/>`;
  return `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
}
function para(p: Para, inCell = false): string {
  const ppr = `<w:pPr><w:spacing w:before="${p.heading ? 240 : 0}" w:after="0" w:line="${inCell ? 276 : 300}" w:lineRule="auto"/>${p.heading ? "<w:keepNext/>" : ""}</w:pPr>`;
  const br = p.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : "";
  return `<w:p>${ppr}${br}${p.runs.map((r) => run(r, p.heading)).join("")}</w:p>`;
}
const TEXT_WIDTH = 9638; // A4(11906) − 좌우 여백 1134×2 (twip)

function table(rows: Block & { kind: "table" }): string {
  const ratios = columnRatios(rows.rows);
  const w = ratios.map((r) => Math.round(TEXT_WIDTH * r));
  const border = (n: string) => `<w:${n} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`;
  const grid = `<w:tblGrid>${w.map((v) => `<w:gridCol w:w="${v}"/>`).join("")}</w:tblGrid>`;
  const body = rows.rows
    .map(
      (r) =>
        `<w:tr>${r
          .map(
            (c, i) =>
              `<w:tc><w:tcPr><w:tcW w:w="${w[i] ?? w[w.length - 1]}" w:type="dxa"/>${c.header ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ""}</w:tcPr>${c.paras.map((p) => para(c.header ? { ...p, runs: p.runs.map((y) => ({ ...y, b: true })) } : p, true)).join("")}</w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${body}</w:tbl><w:p/>`;
}

export function blocksToDocx(blocks: Block[], title: string): Uint8Array {
  const body = blocks.map((b) => (b.kind === "table" ? table(b) : para(b))).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="851" w:footer="851" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return makeZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>법이음(LAW:ON)</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
    { name: "word/document.xml", data: doc },
  ]);
}
