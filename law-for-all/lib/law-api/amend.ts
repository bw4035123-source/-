/**
 * 조문 개정 표시 — 국가법령정보센터 원문에 붙은 <개정 2021.12.7>·<신설 …> 표시에서 가장 최근 날짜를 읽는다.
 * 최근 1년 안에 바뀐 조문은 화면에 '최근 개정'으로 알려, 예전 내용으로 판단하지 않게 한다.
 */
const TAG = /<(?:전문개정|본조신설|개정|신설)[^>]*>/g;
const DATE = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/g;

export interface Amendment {
  /** 2026-06-30 */
  iso: string;
  /** 2026.6.30 */
  label: string;
}

export function latestAmendment(text: string): Amendment | null {
  let best: [number, number, number] | null = null;
  for (const tag of text.match(TAG) ?? []) {
    for (const m of Array.from(tag.matchAll(DATE))) {
      const d: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!best || d[0] * 10000 + d[1] * 100 + d[2] > best[0] * 10000 + best[1] * 100 + best[2]) best = d;
    }
  }
  if (!best) return null;
  const [y, mo, da] = best;
  return { iso: `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, label: `${y}.${mo}.${da}` };
}

/** 기준일(now)로부터 days일 안에 개정된 조문이면 그 개정 정보 */
export function recentAmendment(text: string, now: Date = new Date(), days = 365): Amendment | null {
  const a = latestAmendment(text);
  if (!a) return null;
  const age = (now.getTime() - new Date(`${a.iso}T00:00:00+09:00`).getTime()) / 86_400_000;
  return age >= -366 && age <= days ? a : null;
}
