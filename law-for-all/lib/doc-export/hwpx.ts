/**
 * 한글(HWPX, OWPML) 만들기 — 문단·굵게·밑줄·취소선·표·쪽 나눔. 빈 문서 틀은 hwpx-template.ts(python-hwpx Skeleton, Apache-2.0)
 * 글자 모양: 0 보통(함초롬바탕 10pt) · 7 굵게 · 8 굵게+밑줄 · 9 취소선 · 10 제목(굵게 13pt) / 표 테두리: 3 실선 · 4 실선+회색 바탕
 */
import { columnRatios, type Block, type Para, type Run } from "./model";
import { makeZip } from "./zip";
import { HWPX_CONTAINER, HWPX_HEADER, HWPX_HPF, HWPX_MANIFEST, HWPX_RDF, HWPX_SECTIONPREFIX, HWPX_SETTINGS, HWPX_VERSION } from "./hwpx-template";

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// XML 1.0 에 쓸 수 없는 제어 문자 제거
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\t/g, "    ");
const TEXT_WIDTH = 42520; // 틀의 쪽 너비 59528 − 좌우 여백 8504×2 (HWPUNIT)

let pid = 0;
const nextId = () => String(++pid);
const charOf = (r: Run, heading?: boolean) => (heading ? 10 : r.s ? 9 : r.b && r.u ? 8 : r.b ? 7 : r.u ? 8 : 0);

function para(p: Para): string {
  const runs = p.runs.filter((r) => r.text).map((r) => `<hp:run charPrIDRef="${charOf(r, p.heading)}"><hp:t>${x(clean(r.text))}</hp:t></hp:run>`);
  return `<hp:p id="${nextId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="${p.pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs.join("") || '<hp:run charPrIDRef="0"><hp:t/></hp:run>'}</hp:p>`;
}

function table(t: Block & { kind: "table" }): string {
  const rows = t.rows.filter((r) => r.length);
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const ratios = columnRatios(rows);
  const widths = ratios.map((r) => Math.floor(TEXT_WIDTH * r));
  const H = 282;
  const tr = rows
    .map(
      (r, ri) =>
        `<hp:tr>${Array.from({ length: cols }, (_, ci) => {
          const c = r[ci] ?? { paras: [{ runs: [] }] };
          const ps = c.paras.map((p) => para(c.header ? { ...p, runs: p.runs.map((y) => ({ ...y, b: true })) } : p)).join("");
          return `<hp:tc name="" header="${c.header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${c.header ? 4 : 3}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.header ? "CENTER" : "TOP"}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${ps}</hp:subList><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[ci]}" height="${H}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`;
        }).join("")}</hp:tr>`,
    )
    .join("");
  const total = widths.reduce((a, b) => a + b, 0);
  const tbl = `<hp:tbl id="${1000000 + pid}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="3" noAdjust="0"><hp:sz width="${total}" widthRelTo="ABSOLUTE" height="${H * rows.length}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${tr}</hp:tbl>`;
  return `<hp:p id="${nextId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${tbl}</hp:run></hp:p>`;
}

export function blocksToHwpx(blocks: Block[], title: string): Uint8Array {
  pid = 0;
  const body = blocks.map((b) => (b.kind === "table" ? (b.rows.length ? table(b) : "") : para(b))).join("");
  const section = `${HWPX_SECTIONPREFIX}${body}</hs:sec>`;
  const preview = blocks
    .flatMap((b) => (b.kind === "p" ? [b.runs.map((r) => r.text).join("")] : b.rows.map((r) => r.map((c) => c.paras.map((p) => p.runs.map((y) => y.text).join("")).join(" ")).join(" | "))))
    .join("\r\n")
    .slice(0, 1000);
  return makeZip([
    { name: "mimetype", data: "application/hwp+zip" },
    { name: "version.xml", data: HWPX_VERSION },
    { name: "Contents/header.xml", data: HWPX_HEADER },
    { name: "Contents/section0.xml", data: section },
    { name: "Preview/PrvText.txt", data: preview },
    { name: "settings.xml", data: HWPX_SETTINGS },
    { name: "META-INF/container.rdf", data: HWPX_RDF },
    { name: "Contents/content.hpf", data: HWPX_HPF.replace("<opf:title/>", `<opf:title>${x(title)}</opf:title>`) },
    { name: "META-INF/container.xml", data: HWPX_CONTAINER },
    { name: "META-INF/manifest.xml", data: HWPX_MANIFEST },
  ]);
}
