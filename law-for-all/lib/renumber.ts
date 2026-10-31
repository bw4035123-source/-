/**
 * 조 번호 정리(인용 정정) — 순수 함수(단위 테스트 대상)
 *  규정 전문에서 조문을 신설·삭제해 조 번호가 밀리거나 당겨질 때, 같은 규정 안의 '제N조' 인용 중 고쳐야 할 곳을 모두 찾고
 *  정정한 전문을 만든다. 다른 법령 인용(「○○법」 제N조, 법 제N조, 영 제N조)은 건드리지 않으며,
 *  지금도 없는 조문을 가리키는 인용(기존 오류)도 함께 알린다.
 */

export type RenumberOp = { type: "insert"; at: number } | { type: "delete"; no: number };

export interface RefFix {
  /** 인용이 들어 있는 조문(제N조(제목), 정정 전 번호) */
  where: string;
  from: string;
  to: string;
  context: string;
}

export interface RenumberResult {
  articles: { no: number; title: string }[];
  fixes: RefFix[];
  /** 삭제되는 조문을 가리키는 인용(내용 검토 필요) */
  dangling: RefFix[];
  /** 지금도 없는 조문을 가리키는 인용(기존 오류) */
  broken: RefFix[];
  headingChanges: { from: string; to: string }[];
  text: string;
}

const HEAD = /^(\s*)제(\d+)조(의\d+)?(\s*\(([^)]*)\))?/gm;
// 같은 규정 안 인용: 앞이 「…」·법·영·령·규칙·같은 법 이 아닌 '제N조'(가지조문 제N조의M 포함)
const REF = /제(\d+)조(의(\d+))?/g;
const OTHER_LAW = /(」|법|영|령|규칙|같은\s?법|동법)\s*$/;

function snippet(text: string, i: number, len: number): string {
  const s = Math.max(0, i - 18);
  const e = Math.min(text.length, i + len + 18);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).replace(/\s+/g, " ")}${e < text.length ? "…" : ""}`;
}

export function renumber(text: string, op: RenumberOp): RenumberResult {
  // 조문 머리(줄 맨 앞의 제N조) 위치
  const heads = Array.from(text.matchAll(HEAD), (m) => ({ no: Number(m[2]), branch: m[3] ?? "", title: m[5] ?? "", index: (m.index ?? 0) + m[1].length }));
  const nos = new Set(heads.map((h) => h.no));
  const map = (k: number): number | null => (op.type === "insert" ? (k >= op.at ? k + 1 : k) : k === op.no ? null : k > op.no ? k - 1 : k);
  const whereAt = (i: number) => {
    const h = heads.filter((x) => x.index <= i).pop();
    return h ? `제${h.no}조${h.branch}${h.title ? `(${h.title})` : ""}` : "(조문 앞)";
  };
  const headStarts = new Set(heads.map((h) => h.index));

  const fixes: RefFix[] = [];
  const dangling: RefFix[] = [];
  const broken: RefFix[] = [];
  const edits: { index: number; len: number; to: string }[] = [];

  for (const m of Array.from(text.matchAll(REF))) {
    const i = m.index ?? 0;
    if (headStarts.has(i)) continue;
    if (OTHER_LAW.test(text.slice(Math.max(0, i - 12), i))) continue;
    const k = Number(m[1]);
    const branch = m[2] ?? "";
    const from = m[0];
    const ctx = snippet(text, i, from.length);
    if (!nos.has(k)) {
      broken.push({ where: whereAt(i), from, to: from, context: ctx });
      continue;
    }
    const nk = map(k);
    if (nk === null) {
      // 번호만 남기면 당겨진 다른 조문을 가리키게 되므로 정정 전문에 '정비 필요' 표시
      dangling.push({ where: whereAt(i), from, to: "(삭제되는 조문)", context: ctx });
      edits.push({ index: i, len: from.length, to: `제○조【삭제된 ${from} 인용 — 정비 필요】` });
    }
    else if (nk !== k) {
      const to = `제${nk}조${branch}`;
      fixes.push({ where: whereAt(i), from, to, context: ctx });
      edits.push({ index: i, len: from.length, to });
    }
  }

  // 조문 머리 번호도 정리(삭제 조문은 '삭제' 표시로 남기지 않고 본문째 빼면 번호가 당겨짐)
  const headingChanges: { from: string; to: string }[] = [];
  for (const h of heads) {
    const nk = map(h.no);
    if (nk !== null && nk !== h.no) {
      headingChanges.push({ from: `제${h.no}조${h.branch}`, to: `제${nk}조${h.branch}` });
      edits.push({ index: h.index, len: `제${h.no}조`.length, to: `제${nk}조` });
    } else if (nk === null && h.branch) {
      // 본 조문이 삭제되면 그 가지조문(제N조의M)은 번호를 새로 정해야 함
      dangling.push({ where: `제${h.no}조${h.branch}${h.title ? `(${h.title})` : ""}`, from: `제${h.no}조${h.branch}`, to: "(가지조문 — 번호 다시 정하기)", context: snippet(text, h.index, 8) });
    }
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.index - a.index)) out = out.slice(0, e.index) + e.to + out.slice(e.index + e.len);
  if (op.type === "delete") {
    // 삭제할 조문 본문(다음 조문 머리 전까지)을 정정 전문에서 뺌
    const re = new RegExp(`^\\s*제${op.no}조(?!의)[\\s\\S]*?(?=^\\s*제\\d+조|(?![\\s\\S]))`, "m");
    out = out.replace(re, "");
  } else {
    // 신설 자리 표시(앞 조문 다음 줄)
    const next = heads.find((h) => h.no >= op.at);
    const marker = `제${op.at}조(○○) (신설할 조문)\n`;
    if (next) {
      const nextNew = map(next.no);
      const pos = out.search(new RegExp(`^\\s*제${nextNew}조(?!의)`, "m"));
      out = pos >= 0 ? out.slice(0, pos) + marker + out.slice(pos) : `${out.trimEnd()}\n${marker}`;
    } else out = `${out.trimEnd()}\n${marker}`;
  }

  return { articles: heads.map((h) => ({ no: h.no, title: h.title })), fixes, dangling, broken, headingChanges, text: out };
}
