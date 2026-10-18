/**
 * 기관 규정 문서 → 텍스트 추출(브라우저에서 처리, 서버로 파일을 보내지 않음).
 *  - 한글: HWP(5.0, OLE 복합문서), HWPX(OWPML zip)
 *  - PDF(텍스트 레이어), Word DOCX
 * 스캔 이미지 PDF·배포용(암호화) 한글 문서는 텍스트를 꺼낼 수 없으므로 안내 메시지를 낸다.
 */
import { inflateSync, unzipSync, strFromU8 } from "fflate";

export type DocFormat = "HWP" | "HWPX" | "PDF" | "DOCX";
export interface Extracted {
  text: string;
  format: DocFormat;
  pages?: number;
  warnings: string[];
}

export class ExtractError extends Error {}

export const ACCEPT = ".hwp,.hwpx,.pdf,.docx";
export const MAX_BYTES = 30 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // PK..
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export async function extractText(file: File): Promise<Extracted> {
  if (file.size > MAX_BYTES) throw new ExtractError("파일이 너무 커요(최대 30MB). 필요한 부분만 저장해 올려 주세요.");
  const buf = new Uint8Array(await file.arrayBuffer());
  return extractFromBytes(buf, file.name);
}

export async function extractFromBytes(buf: Uint8Array, name = ""): Promise<Extracted> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  let out: Extracted;
  if (startsWith(buf, PDF_SIG)) out = await extractPdf(buf);
  else if (startsWith(buf, ZIP_SIG)) out = extractZipDoc(buf);
  else if (startsWith(buf, OLE_SIG)) {
    if (ext === "doc") throw new ExtractError("예전 Word(.doc) 형식은 읽을 수 없어요. Word에서 .docx 로 저장해 올려 주세요.");
    out = extractHwp5(buf);
  } else if (["hwp", "hwpx", "pdf", "docx"].includes(ext)) throw new ExtractError(`${ext.toUpperCase()} 파일 형식이 아니거나 손상된 파일이에요.`);
  else throw new ExtractError("한글(HWP·HWPX), PDF, Word(DOCX) 파일만 올릴 수 있어요. 다른 문서는 내용을 복사해 붙여 넣어 주세요.");
  out.text = tidy(out.text);
  if (!out.text.trim()) {
    throw new ExtractError(
      out.format === "PDF" ? "PDF에서 글자를 찾지 못했어요. 스캔한 이미지 PDF는 글자 정보가 없어요 — 원본 한글/Word 파일을 올리거나 내용을 붙여 넣어 주세요." : "문서에서 글자를 찾지 못했어요.",
    );
  }
  if (!/제\s*\d+\s*조/.test(out.text)) out.warnings.push("조문(제N조) 표시를 찾지 못해 문서 전체를 하나의 조문으로 검사해요.");
  return out;
}

// ───────────────────────────── XML 공통(브라우저·Node 공통 정규식 처리)
const ENT: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };
const decodeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENT[m]).replace(/&#(x?)([0-9a-f]+);/gi, (_, h, n) => String.fromCodePoint(parseInt(n, h ? 16 : 10)));

/** <ns:p> 문단 단위로 <ns:t> 텍스트를 모은다(표 안 문단도 한 줄씩) */
function xmlParagraphs(xml: string, ns: "hp" | "w"): string[] {
  const out: string[] = [];
  const chunks = xml.split(new RegExp(`<${ns}:p[\\s>]`));
  for (const chunk of chunks.slice(1)) {
    const body = chunk
      .replace(new RegExp(`<${ns}:tab\\b[^>]*/?>`, "g"), "\t")
      .replace(new RegExp(`<${ns}:(?:lineBreak|br|cr)\\b[^>]*/?>`, "g"), "\n");
    const texts = Array.from(body.matchAll(new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>`, "g")), (m) => m[1].replace(/<[^>]+>/g, (t) => (t.startsWith("<" + ns + ":tab") ? "\t" : "")));
    const line = decodeXml(texts.join(""));
    out.push(line);
  }
  return out;
}

// ───────────────────────────── HWPX · DOCX (zip)
function extractZipDoc(buf: Uint8Array): Extracted {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => /^Contents\/section\d+\.xml$/i.test(f.name) || f.name === "word/document.xml" || f.name === "mimetype" });
  } catch {
    throw new ExtractError("압축 형식 문서를 열지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.");
  }
  const sections = Object.keys(files)
    .filter((k) => /^Contents\/section\d+\.xml$/i.test(k))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sections.length) return { text: sections.flatMap((k) => xmlParagraphs(strFromU8(files[k]), "hp")).join("\n"), format: "HWPX", warnings: [] };
  if (files["word/document.xml"]) return { text: xmlParagraphs(strFromU8(files["word/document.xml"]), "w").join("\n"), format: "DOCX", warnings: [] };
  throw new ExtractError("지원하지 않는 압축 문서예요(HWPX·DOCX만 지원).");
}

// ───────────────────────────── HWP 5.0 (OLE 복합문서 + 레코드)
/** 아주 작은 CFB(OLE2) 리더 — HWP 스트림(FileHeader, BodyText/SectionN)만 읽는다 */
function readCfb(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const secShift = dv.getUint16(30, true);
  const miniShift = dv.getUint16(32, true);
  const SEC = 1 << secShift;
  const MINI = 1 << miniShift;
  const nFat = u32(44);
  const dirStart = u32(48);
  const miniCutoff = u32(56);
  const miniFatStart = u32(60);
  const nMiniFat = u32(64);
  let difStart = u32(68);
  const nDif = u32(72);
  const off = (s: number) => (s + 1) * SEC;

  // FAT 섹터 목록(헤더 109개 + DIFAT 체인)
  const fatSecs: number[] = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(u32(76 + i * 4));
  for (let d = 0; d < nDif && fatSecs.length < nFat; d++) {
    const base = off(difStart);
    for (let i = 0; i < SEC / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(u32(base + i * 4));
    difStart = u32(base + SEC - 4);
  }
  const fat: number[] = [];
  for (const s of fatSecs) for (let i = 0; i < SEC / 4; i++) fat.push(u32(off(s) + i * 4));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let s = start, guard = 0; s >= 0 && s < 0xfffffffa && guard < table.length + 1; s = table[s], guard++) out.push(s);
    return out;
  };
  const readChain = (start: number, size?: number) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * SEC);
    secs.forEach((s, i) => out.set(buf.subarray(off(s), off(s) + SEC), i * SEC));
    return size === undefined ? out : out.subarray(0, size);
  };

  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 64, true);
    let name = "";
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 66], left: ddv.getInt32(o + 68, true), right: ddv.getInt32(o + 72, true), child: ddv.getInt32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries[0];
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array();
  const miniFat: number[] = [];
  if (nMiniFat) {
    const mf = readChain(miniFatStart);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(new DataView(mf.buffer, mf.byteOffset).getUint32(i * 4, true));
  }
  const readEntry = (e: Entry) => {
    if (e.size >= miniCutoff) return readChain(e.start, e.size);
    const secs = chain(e.start, miniFat);
    const out = new Uint8Array(secs.length * MINI);
    secs.forEach((s, i) => out.set(miniStream.subarray(s * MINI, s * MINI + MINI), i * MINI));
    return out.subarray(0, e.size);
  };

  // 레드-블랙 트리를 돌며 경로 이름 → 스트림
  const files = new Map<string, Uint8Array>();
  const walk = (idx: number, prefix: string, depth = 0) => {
    if (idx < 0 || idx >= entries.length || depth > 64) return;
    const e = entries[idx];
    walk(e.left, prefix, depth + 1);
    walk(e.right, prefix, depth + 1);
    const path = prefix + e.name;
    if (e.type === 2) files.set(path, readEntry(e));
    else if (e.type === 1) walk(e.child, path + "/", depth + 1);
  };
  if (root) walk(root.child, "");
  return files;
}

/** HWP 문단 텍스트 레코드(UTF-16LE + 제어문자) → 문자열 */
function paraText(data: Uint8Array): string {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let s = "";
  for (let i = 0; i + 1 < data.length; ) {
    const c = dv.getUint16(i, true);
    if (c < 32) {
      // char 제어(1글자): 0, 10, 13, 24~31 / 인라인·확장 제어(8글자): 그 밖의 1~23
      if (c === 9) s += "\t";
      else if (c === 10) s += "\n";
      const single = c === 0 || c === 10 || c === 13 || (c >= 24 && c <= 31);
      i += single ? 2 : 16;
      continue;
    }
    s += String.fromCharCode(c);
    i += 2;
  }
  return s;
}

const HWPTAG_PARA_TEXT = 0x10 + 51;

export function extractHwp5(buf: Uint8Array): Extracted {
  let files: Map<string, Uint8Array>;
  try {
    files = readCfb(buf);
  } catch {
    throw new ExtractError("한글(HWP) 문서를 열지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.");
  }
  const header = files.get("FileHeader");
  if (!header || strFromU8(header.subarray(0, 17)) !== "HWP Document File") throw new ExtractError("한글(HWP 5.0) 문서가 아니에요. 한글 97 이전 형식은 HWPX 또는 PDF로 저장해 올려 주세요.");
  const props = new DataView(header.buffer, header.byteOffset).getUint32(36, true);
  if (props & 0x2) throw new ExtractError("암호가 걸린 한글 문서예요. 암호를 해제하고 다시 올려 주세요.");
  if (props & 0x4) throw new ExtractError("배포용(열람 제한) 한글 문서는 내용을 꺼낼 수 없어요. 한글에서 ‘다른 이름으로 저장’ → HWPX 또는 PDF로 저장해 올려 주세요.");
  const compressed = (props & 0x1) !== 0;
  const sections = Array.from(files.keys())
    .filter((k) => /^BodyText\/Section\d+$/.test(k))
    .sort((a, b) => Number(a.match(/\d+$/)![0]) - Number(b.match(/\d+$/)![0]));
  if (!sections.length) throw new ExtractError("한글 문서 본문을 찾지 못했어요.");
  const paras: string[] = [];
  for (const k of sections) {
    let data = files.get(k)!;
    if (compressed) data = inflateSync(data);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let o = 0; o + 4 <= data.length; ) {
      const h = dv.getUint32(o, true);
      const tag = h & 0x3ff;
      let size = h >>> 20;
      o += 4;
      if (size === 0xfff) {
        size = dv.getUint32(o, true);
        o += 4;
      }
      if (tag === HWPTAG_PARA_TEXT) paras.push(paraText(data.subarray(o, o + size)));
      o += size;
    }
  }
  return { text: paras.join("\n"), format: "HWP", warnings: [] };
}

// ───────────────────────────── PDF
async function extractPdf(buf: Uint8Array): Promise<Extracted> {
  const pdfjs = await import("pdfjs-dist");
  // 워커는 public/pdf.worker.min.js(빌드 시 pdfjs-dist 와 같은 버전으로 복사)
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    throw new ExtractError(/password/i.test(msg) ? "암호가 걸린 PDF예요. 암호를 해제하고 다시 올려 주세요." : "PDF를 열지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.");
  }
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof it.str !== "string") continue;
      line += it.str;
      if (it.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text: reflow(lines), format: "PDF", pages, warnings: pages > 0 ? [] : ["빈 PDF예요."] };
}

/**
 * PDF 줄바꿈 복원: 페이지 폭 때문에 잘린 줄을 앞 줄에 이어 붙이고,
 * 조문·항·호·목·부칙이 시작되는 줄과 쪽번호만 새 줄로 둔다.
 */
export function reflow(lines: string[]): string {
  const NEW = /^(제\s*\d+\s*(조|장|절)|[①-⑳]|\d{1,2}\.\s|[가-하]\.\s|부\s*칙|<|\[|【|※|-\s)/;
  const PAGE_NO = /^[-–]?\s*\d{1,4}\s*[-–]?$|^\d+\s*\/\s*\d+$/;
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l || PAGE_NO.test(l)) continue;
    if (!out.length || NEW.test(l)) out.push(l);
    else out[out.length - 1] += " " + l;
  }
  return out.join("\n");
}

function tidy(t: string): string {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/[ 　]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
