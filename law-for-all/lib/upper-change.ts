/**
 * 상위법 개정 전후 비교 — 국가법령정보 신구법 비교(DRF target=oldAndNew) 응답을 조문 단위로 정리하고,
 * 바뀐 용어·수치·신설·삭제 조문을 결정적으로 뽑아, 우리 기관 규정에서 정비가 필요한 조문을 찾는다.
 * 생성형 AI 없이 동작(같은 입력 → 같은 결과). 파싱·용어 추출은 Python 판 python/law_for_all/upper_change.py 와 같음.
 */
import { extractQuantities, quantityLabel } from "./answer/numbers";

export type ChangeKind = "개정" | "신설" | "삭제";
export interface Part {
  t: string;
  /** 개정 표시(<P>…</P>)된 부분 */
  m: boolean;
}
export interface ChangeRow {
  /** 제13조 · 제44조의4 */
  article: string;
  title: string;
  kind: ChangeKind;
  old: Part[];
  new: Part[];
}
export interface LawInfo {
  name: string;
  kind: string;
  promulgated: string; // 2026. 4. 7.
  effective: string;
  type: string; // 일부개정·타법개정
  number: string;
}
export interface TermChange {
  from: string;
  to: string;
  /** 개정 전 조문에서 나온 횟수 */
  count: number;
  articles: string[];
}
export interface NumberChange {
  article: string;
  from: string[];
  to: string[];
}
export interface UpperChange {
  law: string;
  before: LawInfo;
  after: LawInfo;
  rows: ChangeRow[];
  terms: TermChange[];
  numbers: NumberChange[];
  added: string[];
  deleted: string[];
  amended: string[];
}

type Json = Record<string, unknown>;
const asList = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : v && typeof v === "object" ? [v as Json] : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${Number(s.slice(0, 4))}. ${Number(s.slice(4, 6))}. ${Number(s.slice(6, 8))}.` : s);
const info = (v: unknown): LawInfo => {
  const o = (v ?? {}) as Json;
  return { name: str(o["법령명"]), kind: str(o["법종구분"]), promulgated: ymd(str(o["공포일자"])), effective: ymd(str(o["시행일자"])), type: str(o["제개정구분명"]), number: str(o["공포번호"]) };
};

/** '<P>…</P>' 표시를 조각으로 */
export function parts(content: string): Part[] {
  const out: Part[] = [];
  const re = /<P>([\s\S]*?)<\/P>/g;
  let at = 0;
  for (const m of content.matchAll(re)) {
    if (m.index! > at) out.push({ t: content.slice(at, m.index), m: false });
    out.push({ t: m[1], m: true });
    at = m.index! + m[0].length;
  }
  if (at < content.length) out.push({ t: content.slice(at), m: false });
  return out.filter((p) => p.t);
}
export const plain = (ps: Part[]) => ps.map((p) => p.t).join("");
const HEAD = /^\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:\(([^)]*)\))?/;
const isMark = (s: string, w: "신설" | "삭제") => new RegExp(`^\\s*<\\s*${w[0]}\\s*${w[1]}\\s*>\\s*$`).test(s);
const SKIP = /^\s*(?:[①-⑳]\s*(?:∼|~)\s*[①-⑳]\s*|\d+\.\s*)?\((?:생\s*략|현행과\s*같음)\)\s*$/;

/** DRF 신구법 비교 응답 → 조문 단위 비교 */
export function parseOldAndNew(data: unknown): UpperChange | null {
  const root = ((data as Json)?.["OldAndNewService"] ?? data) as Json;
  const olds = asList((root?.["구조문목록"] as Json)?.["조문"]);
  const news = asList((root?.["신조문목록"] as Json)?.["조문"]);
  if (!olds.length && !news.length) return null;
  const before = info(root["구조문_기본정보"]);
  const after = info(root["신조문_기본정보"]);
  const rows: ChangeRow[] = [];
  let article = "";
  let title = "";
  for (let i = 0; i < Math.max(olds.length, news.length); i++) {
    const o = str(olds[i]?.["content"]);
    const n = str(news[i]?.["content"]);
    const op = parts(o);
    const np = parts(n);
    const ot = plain(op);
    const nt = plain(np);
    if (SKIP.test(ot) && SKIP.test(nt)) continue;
    const head = nt.match(HEAD) ?? ot.match(HEAD);
    if (head) {
      article = `제${head[1]}조${head[2] ? `의${head[2]}` : ""}`;
      title = head[3] ?? "";
    }
    if (!article) continue;
    const kind: ChangeKind = isMark(ot, "신설") ? "신설" : isMark(nt, "삭제") ? "삭제" : "개정";
    if (kind === "개정" && !op.some((p) => p.m) && !np.some((p) => p.m)) continue; // 바뀐 곳 없는 맥락 줄
    rows.push({ article, title, kind, old: kind === "신설" ? [] : op, new: kind === "삭제" ? [] : np });
  }
  // 조 머리가 신설·삭제된 경우만 조문 신설·삭제(항 신설·삭제는 개정)
  const headKind = (k: ChangeKind) => Array.from(new Set(rows.filter((r) => r.kind === k && HEAD.test(plain(k === "신설" ? r.new : r.old))).map((r) => r.article)));
  const added = headKind("신설");
  const deleted = headKind("삭제");
  const amended = Array.from(new Set(rows.map((r) => r.article))).filter((a) => !added.includes(a) && !deleted.includes(a));
  return { law: after.name || before.name, before, after, rows, terms: termChanges(rows), numbers: numberChanges(rows), added, deleted, amended };
}

// ───────────── 바뀐 용어(예: 근로감독관 → 노동감독관)
const PARTICLE = /(?:으로서|으로써|에게서|에서는|으로|에게|에서|까지|부터|이나|이며|이고|와|과|의|이|가|을|를|은|는|에|로|도|만)$/;
const stem = (w: string) => (w.length > 3 ? w.replace(PARTICLE, "") : w);
const words = (s: string) => Array.from(s.matchAll(/[가-힣]{2,}/g), (m) => stem(m[0])).filter((w) => w.length >= 3);
const commonEnd = (a: string, b: string) => {
  let k = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
};
const commonStart = (a: string, b: string) => {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
};

export function termChanges(rows: ChangeRow[]): TermChange[] {
  const changed = rows.filter((r) => r.kind === "개정");
  const allOld = rows.map((r) => plain(r.old)).join("\n");
  const allNew = rows.map((r) => plain(r.new)).join("\n");
  const found = new Map<string, TermChange>();
  for (const r of changed) {
    const gone = words(r.old.filter((p) => p.m).map((p) => p.t).join(" ")).filter((w) => !allNew.includes(w));
    const came = words(r.new.filter((p) => p.m).map((p) => p.t).join(" ")).filter((w) => !allOld.includes(w));
    for (const g of new Set(gone)) {
      // 같은 자리에 새로 들어온 말 중 앞이나 뒤 2글자 이상이 같은 말(근로감독관 ↔ 노동감독관)
      const best = Array.from(new Set(came))
        .map((c) => ({ c, s: Math.max(commonEnd(g, c), commonStart(g, c)) }))
        // 어미만 바뀐 경우(통보할 → 통보한)는 용어 변경이 아님
        .filter((x) => x.s >= 2 && Math.abs(x.c.length - g.length) <= 3 && commonStart(g, x.c) < Math.min(g.length, x.c.length) - 1)
        .sort((a, b) => b.s - a.s)[0];
      if (!best) continue;
      const key = `${g}→${best.c}`;
      const t = found.get(key) ?? { from: g, to: best.c, count: 0, articles: [] };
      if (!t.articles.includes(r.article)) t.articles.push(r.article);
      found.set(key, t);
    }
  }
  for (const t of found.values()) t.count = allOld.split(t.from).length - 1;
  return Array.from(found.values()).sort((a, b) => b.count - a.count);
}

// ───────────── 바뀐 수치(기간·금액·비율)
export function numberChanges(rows: ChangeRow[]): NumberChange[] {
  const out: NumberChange[] = [];
  for (const r of rows.filter((x) => x.kind === "개정")) {
    const o = extractQuantities(plain(r.old));
    const n = extractQuantities(plain(r.new));
    const from = o.filter((q) => !n.includes(q));
    const to = n.filter((q) => !o.includes(q));
    if (from.length || to.length) out.push({ article: r.article, from: from.map(quantityLabel), to: to.map(quantityLabel) });
  }
  return out;
}

// ───────────── 우리 규정 영향 점검(클라이언트 전용)
export interface OurArticle {
  label: string; // 제7조(근로감독)
  text: string; // 조 머리 포함 전문
}
export interface ImpactHit {
  article: OurArticle;
  reasons: { kind: "용어" | "인용-개정" | "인용-삭제" | "수치"; detail: string }[];
  /** 개정 방향(규칙으로 그대로 반영되는 문형) — 용어 변경이 있을 때만 */
  instruction: string;
}

/** 규정 전문 → 조 단위 */
export function splitArticles(text: string): OurArticle[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: OurArticle[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?)/);
    if (m) out.push({ label: m[1].replace(/^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*/, (_x, n: string, b?: string) => `제${n}조${b ? `의${b}` : ""}`).trim(), text: line.trim() });
    else if (out.length && line.trim()) out[out.length - 1].text += `\n${line.trim()}`;
  }
  return out;
}

/** 마지막 글자 받침 번호(0: 없음, 8: ㄹ) */
const jong = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 ? c % 28 : 0;
};

export function impactOn(regulation: string, ch: UpperChange): ImpactHit[] {
  const law = ch.law.replace(/\s/g, "");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lawRe = new RegExp(`「?\\s*${esc(law).split("").join("\\s*")}\\s*」?\\s*제\\s*(\\d+)\\s*조(?:\\s*의\\s*(\\d+))?`, "g");
  const hits: ImpactHit[] = [];
  for (const a of splitArticles(regulation)) {
    const reasons: ImpactHit["reasons"] = [];
    const edits: string[] = [];
    for (const t of ch.terms)
      if (a.text.includes(t.from)) {
        reasons.push({ kind: "용어", detail: `‘${t.from}’ → ‘${t.to}’(「${ch.law}」 ${t.articles.slice(0, 3).join("·")}${t.articles.length > 3 ? " 등" : ""}에서 바뀜)` });
        edits.push(`‘${t.from}’${jong(t.from) ? "을" : "를"} ‘${t.to}’${jong(t.to) && jong(t.to) !== 8 ? "으로" : "로"} 변경`);
      }
    for (const m of a.text.matchAll(lawRe)) {
      const ref = `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`;
      if (ch.deleted.includes(ref)) reasons.push({ kind: "인용-삭제", detail: `인용한 「${ch.law}」 ${ref}가 삭제됨 — 인용 정비 필요` });
      else if (ch.amended.includes(ref)) {
        const nc = ch.numbers.find((n) => n.article === ref);
        reasons.push({ kind: nc ? "수치" : "인용-개정", detail: `인용한 「${ch.law}」 ${ref}가 개정됨${nc ? ` — 수치 ${nc.from.join("·") || "-"} → ${nc.to.join("·") || "-"}` : ""} — 내용이 따라가는지 확인` });
      }
    }
    // 같은 사유는 한 번만
    const uniq = reasons.filter((r, i) => reasons.findIndex((x) => x.detail === r.detail) === i);
    if (uniq.length) hits.push({ article: a, reasons: uniq, instruction: Array.from(new Set(edits)).join("\n") });
  }
  return hits;
}
