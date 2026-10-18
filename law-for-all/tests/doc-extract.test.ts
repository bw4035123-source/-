import { describe, expect, it } from "vitest";
import { deflateSync, strToU8, zipSync } from "fflate";
import * as CFB from "cfb";
import { ExtractError, extractFromBytes, reflow } from "@/lib/doc-extract";
import { parseRegulation } from "@/lib/compliance";

const enc = (s: string) => strToU8(s);

describe("내규 문서 텍스트 추출", () => {
  it("HWPX: 섹션 순서대로 문단·탭·표 안 문단까지", async () => {
    const sec = (paras: string[]) => `<?xml version="1.0"?><hs:sec xmlns:hs="x" xmlns:hp="y">${paras.map((p) => `<hp:p id="1"><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`).join("")}</hs:sec>`;
    const zip = zipSync({
      mimetype: enc("application/hwp+zip"),
      "Contents/section1.xml": enc(sec(["제2조(근로시간) 1주 44시간으로 한다."])),
      "Contents/section0.xml": enc(sec(["○○공사 취업규칙", "제1조(목적) 이 규칙은 &lt;근로조건&gt;을 정한다."]).replace("<hp:t>○○공사", "<hp:t>○○<hp:tab/>공사")),
    });
    const r = await extractFromBytes(zip, "규칙.hwpx");
    expect(r.format).toBe("HWPX");
    expect(r.text).toBe("○○\t공사 취업규칙\n제1조(목적) 이 규칙은 <근로조건>을 정한다.\n제2조(근로시간) 1주 44시간으로 한다.");
  });

  it("DOCX: w:p / w:t", async () => {
    const xml = `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>제1조(목적)</w:t></w:r><w:r><w:t xml:space="preserve"> 목적이다.</w:t></w:r></w:p><w:p><w:r><w:t>제2조(휴가) 12일</w:t></w:r></w:p></w:body></w:document>`;
    const r = await extractFromBytes(zipSync({ "word/document.xml": enc(xml) }), "a.docx");
    expect(r.format).toBe("DOCX");
    expect(parseRegulation(r.text).map((a) => a.no)).toEqual(["1", "2"]);
  });

  it("HWP 5.0: OLE 복합문서 + 압축 레코드에서 문단 텍스트(제어문자 처리)", async () => {
    const hwp = makeHwp(["제1조(목적) 목적이다.", "제2조(연차) 12일을 준다."], { compressed: true });
    const r = await extractFromBytes(hwp, "a.hwp");
    expect(r.format).toBe("HWP");
    expect(r.text).toBe("제1조(목적) 목적이다.\n제2조(연차) 12일을 준다.");
  });

  it("HWP 5.0: 외부 라이브러리로 만든 OLE 파일(작은 스트림=미니스트림, 큰 본문, 여러 구역)", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `제${i + 1}조(조문${i + 1}) 내용 ${i + 1}을 정한다.`);
    for (const compressed of [true, false]) {
      const cfb = CFB.utils.cfb_new();
      const header = new Uint8Array(256);
      header.set(enc("HWP Document File"));
      new DataView(header.buffer).setUint32(36, compressed ? 1 : 0, true);
      CFB.utils.cfb_add(cfb, "/FileHeader", header);
      const sec = (ps: string[]) => (compressed ? deflateSync(records(ps)) : records(ps));
      CFB.utils.cfb_add(cfb, "/BodyText/Section0", sec(["짧은 첫 구역"]));
      CFB.utils.cfb_add(cfb, "/BodyText/Section1", sec([...long, "가".repeat(3000)])); // 마지막 문단은 확장 크기(0xFFF 이상) 레코드
      CFB.utils.cfb_add(cfb, "/DocInfo", new Uint8Array(100));
      const bytes = CFB.write(cfb, { type: "array" }) as number[];
      const r = await extractFromBytes(new Uint8Array(bytes), "a.hwp");
      expect(r.text.split("\n")[0]).toBe("짧은 첫 구역");
      expect(parseRegulation(r.text)).toHaveLength(300);
      expect(r.text.endsWith("가".repeat(3000))).toBe(true);
    }
  });

  it("배포용·암호 한글 문서는 안내", async () => {
    await expect(extractFromBytes(makeHwp(["x"], { compressed: true, flags: 0x4 }), "a.hwp")).rejects.toThrow(/배포용/);
    await expect(extractFromBytes(makeHwp(["x"], { compressed: true, flags: 0x2 }), "a.hwp")).rejects.toThrow(/암호/);
  });

  it("TXT 등 지원하지 않는 형식은 안내(붙여 넣기 권유)", async () => {
    await expect(extractFromBytes(enc("제1조(목적) 가"), "a.txt")).rejects.toThrow(/붙여 넣어/);
    await expect(extractFromBytes(enc("제1조(목적) 가"), "a.md")).rejects.toBeInstanceOf(ExtractError);
  });

  it("확장자만 바꾼 파일·빈 문서·조문 없는 문서", async () => {
    const docx = (t: string) => zipSync({ "word/document.xml": enc(`<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:body></w:document>`) });
    await expect(extractFromBytes(enc("hello"), "a.pdf")).rejects.toBeInstanceOf(ExtractError);
    await expect(extractFromBytes(docx("   "), "a.docx")).rejects.toThrow(/글자/);
    expect((await extractFromBytes(docx("근로시간은 1주 40시간"), "a.docx")).warnings[0]).toMatch(/조문/);
  });

  it("PDF 워커 파일(public/pdf.worker.min.js)이 설치된 pdfjs-dist 와 같은 버전", async () => {
    const fs = await import("node:fs");
    const a = fs.readFileSync("public/pdf.worker.min.js");
    const b = fs.readFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
    expect(a.equals(b), "npm run sync:pdf-worker 로 다시 복사하세요").toBe(true);
  });

  it("PDF 줄바꿈 복원: 잘린 줄은 잇고 조문·항·쪽번호는 구분", () => {
    expect(reflow(["제10조(근로시간) ① 직원의 1일 근로시간은 휴게시간을", "제외하고 8시간으로 한다.", "② 휴게시간은 30분으로 한다.", "- 3 -", "제11조(연장근로) 1주 12시간"])).toBe(
      "제10조(근로시간) ① 직원의 1일 근로시간은 휴게시간을 제외하고 8시간으로 한다.\n② 휴게시간은 30분으로 한다.\n제11조(연장근로) 1주 12시간",
    );
  });
});

function records(paras: string[]): Uint8Array {
  const out: number[] = [];
  for (const p of paras) {
    const units = [...Array.from(p, (c) => c.charCodeAt(0)), 13];
    const bytes = new Uint8Array(units.length * 2);
    units.forEach((u, i) => new DataView(bytes.buffer).setUint16(i * 2, u, true));
    const big = bytes.length >= 0xfff;
    const hb = new Uint8Array(big ? 8 : 4);
    new DataView(hb.buffer).setUint32(0, ((0x10 + 51) | ((big ? 0xfff : bytes.length) << 20)) >>> 0, true);
    if (big) new DataView(hb.buffer).setUint32(4, bytes.length, true);
    out.push(...hb, ...bytes);
  }
  return new Uint8Array(out);
}

/** 테스트용 최소 HWP 5.0 파일(CFB v3, 512바이트 섹터) */
function makeHwp(paras: string[], o: { compressed: boolean; flags?: number }): Uint8Array {
  const header = new Uint8Array(256);
  header.set(enc("HWP Document File"));
  new DataView(header.buffer).setUint32(36, (o.compressed ? 1 : 0) | (o.flags ?? 0), true);
  const recs: number[] = [];
  for (const p of paras) {
    const units = [...Array.from(p, (c) => c.charCodeAt(0)), 13];
    // 인라인 제어(탭 9, 8글자) 하나를 앞에 넣어 제어문자 건너뛰기 확인
    const body = [9, 0, 0, 0, 0, 0, 0, 9, ...units];
    const bytes = new Uint8Array(body.length * 2);
    body.forEach((u, i) => new DataView(bytes.buffer).setUint16(i * 2, u, true));
    const h = (0x10 + 51) | (0 << 10) | (bytes.length << 20);
    const hb = new Uint8Array(4);
    new DataView(hb.buffer).setUint32(0, h >>> 0, true);
    recs.push(...hb, ...bytes);
  }
  let section = new Uint8Array(recs);
  if (o.compressed) section = deflateSync(section);
  // 각 스트림을 4096바이트 이상으로 맞춰 일반 FAT 체인에 저장(미니스트림 회피)
  const pad = (b: Uint8Array) => {
    const n = Math.max(4096, Math.ceil(b.length / 512) * 512);
    const x = new Uint8Array(n);
    x.set(b);
    return { data: x, size: Math.max(b.length, 4096) };
  };
  const fh = pad(header);
  const sec = pad(section);
  const SEC = 512;
  const fhSecs = fh.data.length / SEC;
  const secSecs = sec.data.length / SEC;
  // 섹터 배치: [0]=FAT, [1]=디렉터리, 이후 FileHeader, Section0
  const fhStart = 2;
  const sStart = fhStart + fhSecs;
  const total = sStart + secSecs;
  const file = new Uint8Array(SEC * (total + 1));
  const dv = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  dv.setUint16(24, 0x3e, true);
  dv.setUint16(26, 3, true);
  dv.setUint16(28, 0xfffe, true);
  dv.setUint16(30, 9, true);
  dv.setUint16(32, 6, true);
  dv.setUint32(44, 1, true); // FAT 섹터 수
  dv.setUint32(48, 1, true); // 디렉터리 시작
  dv.setUint32(56, 4096, true);
  dv.setUint32(60, 0xfffffffe, true);
  dv.setUint32(64, 0, true);
  dv.setUint32(68, 0xfffffffe, true);
  dv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i === 0 ? 0 : 0xffffffff, true);
  const fatOff = SEC * 1;
  const setFat = (i: number, v: number) => dv.setUint32(fatOff + i * 4, v, true);
  for (let i = 0; i < SEC / 4; i++) setFat(i, 0xffffffff);
  setFat(0, 0xfffffffd);
  setFat(1, 0xfffffffe);
  for (let i = 0; i < fhSecs; i++) setFat(fhStart + i, i === fhSecs - 1 ? 0xfffffffe : fhStart + i + 1);
  for (let i = 0; i < secSecs; i++) setFat(sStart + i, i === secSecs - 1 ? 0xfffffffe : sStart + i + 1);
  file.set(fh.data, SEC * (fhStart + 1));
  file.set(sec.data, SEC * (sStart + 1));
  // 디렉터리: 0 Root, 1 FileHeader, 2 BodyText(storage), 3 Section0
  const dirOff = SEC * 2;
  const entry = (i: number, name: string, type: number, left: number, right: number, child: number, start: number, size: number) => {
    const o2 = dirOff + i * 128;
    for (let k = 0; k < name.length; k++) dv.setUint16(o2 + k * 2, name.charCodeAt(k), true);
    dv.setUint16(o2 + 64, (name.length + 1) * 2, true);
    file[o2 + 66] = type;
    dv.setInt32(o2 + 68, left, true);
    dv.setInt32(o2 + 72, right, true);
    dv.setInt32(o2 + 76, child, true);
    dv.setUint32(o2 + 116, start, true);
    dv.setUint32(o2 + 120, size, true);
  };
  entry(0, "Root Entry", 5, -1, -1, 1, 0xfffffffe, 0);
  entry(1, "FileHeader", 2, -1, 2, -1, fhStart, fh.size);
  entry(2, "BodyText", 1, -1, -1, 3, 0, 0);
  entry(3, "Section0", 2, -1, -1, -1, sStart, sec.size);
  return file;
}
