/**
 * 내려받기 문서 모델 — 화면이 만든 { title, body(글), html(표) } 묶음을 문단·표 블록으로 바꿔
 * 한글(HWPX)·Word(DOCX)가 같은 내용으로 만들어지게 함.
 * html 은 우리 화면이 만드는 작은 범위만 읽음: table/tr/td/th, p, br, b/strong, u, s/del, small, h2/h3, 엔티티
 */
export interface Run {
  text: string;
  b?: boolean;
  u?: boolean;
  s?: boolean;
}
export interface Para {
  runs: Run[];
  heading?: boolean;
  pageBreak?: boolean;
}
export interface Cell {
  paras: Para[];
  header?: boolean;
  /** 표 HTML의 width="NN%" */
  widthPct?: number;
}
export type Block = ({ kind: "p" } & Para) | { kind: "table"; rows: Cell[][]; widths?: number[] };
export interface DocSection {
  title?: string;
  body?: string;
  html?: string;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));

/** 글(본문) → 줄마다 문단(앞 공백 유지) */
export function textToParas(text: string): Para[] {
  return text.replace(/\r/g, "").split("\n").map((l) => ({ runs: l ? [{ text: l.replace(/\t/g, "    ") }] : [] }));
}

/** 작은 HTML → 블록 */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const st = { b: 0, u: 0, s: 0 };
  let para: Para = { runs: [] };
  let paras: Para[] | null = null; // 지금 채우는 칸(없으면 본문)
  let table: { rows: Cell[][] } | null = null;
  let row: Cell[] | null = null;
  let cell: Cell | null = null;
  let heading = false;
  const flush = (force = false) => {
    if (!para.runs.length && !force) return;
    const p = heading ? { ...para, heading: true } : para;
    if (paras) paras.push(p);
    else blocks.push({ kind: "p", ...p });
    para = { runs: [] };
  };
  const addText = (t: string) => {
    if (!t) return;
    const text = decode(t.replace(/\s*\n\s*/g, " "));
    if (!text) return;
    para.runs.push({ text, ...(st.b ? { b: true } : {}), ...(st.u ? { u: true } : {}), ...(st.s ? { s: true } : {}) });
  };
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)[^>]*>|([^<]+)/g)) {
    if (m[2] !== undefined) {
      if (!table || cell) addText(m[2]);
      continue;
    }
    const tag = m[1].toLowerCase();
    const close = m[0][1] === "/";
    if (tag === "br") flush(true);
    else if (tag === "b" || tag === "strong") st.b += close ? -1 : 1;
    else if (tag === "u" || tag === "ins") st.u += close ? -1 : 1;
    else if (tag === "s" || tag === "del" || tag === "strike") st.s += close ? -1 : 1;
    else if (tag === "p" || tag === "div") flush();
    else if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      flush();
      heading = !close;
    } else if (tag === "table") {
      if (!close) {
        flush();
        table = { rows: [] };
      } else if (table) {
        blocks.push({ kind: "table", rows: table.rows });
        table = null;
      }
    } else if (tag === "tr" && table) {
      if (!close) row = [];
      else if (row) table.rows.push(row), (row = null);
    } else if ((tag === "td" || tag === "th") && row) {
      if (!close) {
        const w = /width\s*=\s*"?(\d+(?:\.\d+)?)%/.exec(m[0]);
        cell = { paras: [], header: tag === "th", ...(w ? { widthPct: Number(w[1]) } : {}) };
        paras = cell.paras;
      } else if (cell) {
        flush();
        if (!cell.paras.length) cell.paras.push({ runs: [] });
        row.push(cell);
        cell = null;
        paras = null;
      }
    }
    st.b = Math.max(0, st.b);
    st.u = Math.max(0, st.u);
    st.s = Math.max(0, st.s);
  }
  flush();
  return blocks;
}

/** 묶음 → 블록(묶음 사이는 새 쪽) */
export function sectionsToBlocks(sections: DocSection[]): Block[] {
  const out: Block[] = [];
  sections.forEach((s, i) => {
    const start = out.length;
    if (s.title) out.push({ kind: "p", runs: [{ text: s.title, b: true }], heading: true });
    if (s.body) out.push(...textToParas(s.body).map((p) => ({ kind: "p" as const, ...p })));
    if (s.html) out.push(...htmlToBlocks(s.html));
    if (i > 0 && out[start]) {
      if (out[start].kind === "p") (out[start] as Para).pageBreak = true;
      else out.splice(start, 0, { kind: "p", runs: [], pageBreak: true });
    }
  });
  return out;
}

/** 표 열 너비(비율, 합 1) — 첫 행에 width="NN%"가 있으면 그대로, 나머지 열은 남은 너비를 글자 수로 나눔 */
export function columnRatios(rows: Cell[][]): number[] {
  const n = Math.max(...rows.map((r) => r.length), 1);
  const given = Array.from({ length: n }, (_, c) => rows[0]?.[c]?.widthPct);
  const textLen = (c: number) => Math.max(6, ...rows.map((r) => Math.min(50, (r[c]?.paras ?? []).map((p) => p.runs.map((x) => x.text).join("")).join("").length)));
  const fixed = given.reduce<number>((a, g) => a + (g ?? 0), 0) / 100;
  const free = given.map((g, c) => (g === undefined ? textLen(c) : 0));
  const freeSum = free.reduce((a, b) => a + b, 0) || 1;
  const rest = Math.max(0, 1 - fixed);
  const r = given.map((g, c) => (g !== undefined ? g / 100 : (rest * free[c]) / freeSum));
  const sum = r.reduce((a, b) => a + b, 0) || 1;
  return r.map((x) => x / sum);
}
