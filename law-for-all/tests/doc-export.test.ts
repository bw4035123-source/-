import { describe, expect, it } from "vitest";
import { columnRatios, htmlToBlocks, sectionsToBlocks } from "@/lib/doc-export/model";
import { crc32, makeZip } from "@/lib/doc-export/zip";
import { blocksToDocx } from "@/lib/doc-export/docx";
import { blocksToHwpx } from "@/lib/doc-export/hwpx";

const td = new TextDecoder();
const entryNames = (z: Uint8Array) => {
  const names: string[] = [];
  for (let i = 0; i + 30 < z.length; ) {
    const v = new DataView(z.buffer, z.byteOffset + i);
    if (v.getUint32(0, true) !== 0x04034b50) break;
    const size = v.getUint32(18, true);
    const n = v.getUint16(26, true);
    names.push(td.decode(z.subarray(i + 30, i + 30 + n)));
    i += 30 + n + size;
  }
  return names;
};

describe("한글·Word 내려받기", () => {
  it("표 HTML → 행·칸·굵게·밑줄·취소선·줄바꿈", () => {
    const b = htmlToBlocks('<table><tr><th width="30%">현 행</th><th>개 정 안</th></tr><tr><td>제5조<br><s>7일</s> 이내</td><td>제5조<br><u><b>5일</b></u> 이내 &amp; 끝</td></tr></table>');
    expect(b).toHaveLength(1);
    const t = b[0] as Extract<(typeof b)[number], { kind: "table" }>;
    expect(t.rows[0][0]).toMatchObject({ header: true, widthPct: 30 });
    expect(t.rows[1][0].paras.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["제5조", "7일 이내"]);
    expect(t.rows[1][0].paras[1].runs[0]).toEqual({ text: "7일", s: true });
    expect(t.rows[1][1].paras[1].runs[0]).toEqual({ text: "5일", b: true, u: true });
    expect(t.rows[1][1].paras[1].runs[1].text).toBe(" 이내 & 끝");
    expect(columnRatios(t.rows).map((x) => Math.round(x * 100))).toEqual([30, 70]);
  });
  it("묶음 사이는 새 쪽, 제목은 굵게", () => {
    const b = sectionsToBlocks([{ body: "가\n나" }, { title: "붙임", body: "다" }]);
    expect(b.map((x) => (x.kind === "p" ? x.runs.map((r) => r.text).join("") : "표"))).toEqual(["가", "나", "붙임", "다"]);
    expect(b[2]).toMatchObject({ heading: true, pageBreak: true });
  });
  it("ZIP: CRC32 · HWPX는 mimetype 이 맨 앞", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const blocks = sectionsToBlocks([{ title: "보고", body: "1. 개요\n  가. 내용 <확인> & \"인용\"" }, { html: "<table><tr><td>a</td><td>b</td></tr></table>" }]);
    const h = blocksToHwpx(blocks, "제목");
    expect(entryNames(h).slice(0, 4)).toEqual(["mimetype", "version.xml", "Contents/header.xml", "Contents/section0.xml"]);
    const sec = td.decode(h);
    expect(sec).toContain("&lt;확인&gt; &amp; &quot;인용&quot;");
    expect(sec).toContain('<hp:tbl id=');
    expect(sec).toContain('rowCnt="1" colCnt="2"');
    const d = blocksToDocx(blocks, "제목");
    expect(entryNames(d)).toContain("word/document.xml");
    expect(td.decode(d)).toContain('<w:br w:type="page"/>');
    expect(makeZip([]).length).toBe(22);
  });
});
