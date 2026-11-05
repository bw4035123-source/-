/**
 * 상위법 개정 알림 — 우리 규정이 따르는 법령을 '지켜볼 법령'으로 등록해 두면, 화면을 열 때
 * 국가법령정보 최근 공포일을 확인해 '우리 규정 기준일(최종 정비일) 이후 개정'을 알려 준다.
 * 목록은 이 브라우저(localStorage)에만 둔다 — 서버·회원가입 없음, 개인정보 없음(법령 이름과 날짜뿐).
 */
export interface WatchItem {
  /** 법령명(검색에 쓴 이름 — 약칭이면 정식 이름으로 바꿔 저장) */
  name: string;
  /** 우리 규정 기준일(YYYYMMDD) — 이 날 이후에 공포된 개정이면 알림. '확인함'을 누르면 그 개정 공포일로 옮김 */
  baseline: string;
  /** 어디서 등록했는지(규정명 등) */
  source?: string;
  addedAt: string;
}
export interface WatchLaw {
  query: string;
  name: string;
  mst: string;
  promulgated: string;
  effective: string;
  revision: string;
}

export const WATCH_KEY = "law-for-all:law-watch:v1";
export const WATCH_EVENT = "law-watch-change";

export function loadWatch(): WatchItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && /^\d{8}$/.test(x.baseline)) : [];
  } catch {
    return [];
  }
}
export function saveWatch(items: WatchItem[]): void {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(WATCH_EVENT));
  } catch {
    /* 저장 불가 환경(시크릿 창 등) — 이번 화면에서만 */
  }
}

const norm = (s: string) => s.replace(/\s/g, "");

/** 목록에 더하기 — 이미 있으면 기준일은 더 이른 쪽(놓친 개정이 없게) */
export function mergeWatch(items: WatchItem[], names: string[], baseline: string, source?: string, today = new Date()): WatchItem[] {
  const out = items.map((x) => ({ ...x }));
  for (const n of names.map((x) => x.trim()).filter(Boolean)) {
    const cur = out.find((x) => norm(x.name) === norm(n));
    if (cur) cur.baseline = cur.baseline < baseline ? cur.baseline : baseline;
    else out.push({ name: n, baseline, source, addedAt: ymd(today) });
  }
  return out;
}

/** 규정 글에서 「법령명」 인용 찾기(법·령·규칙·규정으로 끝나는 것만) */
export function citedLaws(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/「([^」]{2,60})」/g)) {
    const n = m[1].trim();
    if (/(법|법률|령|규칙|규정)$/.test(n) && !out.some((x) => norm(x) === norm(n))) out.push(n);
  }
  return out;
}

/** 기준일 이후에 공포된 개정(알림 대상) */
export function pendingUpdates(items: WatchItem[], laws: WatchLaw[]): { item: WatchItem; law: WatchLaw }[] {
  const out: { item: WatchItem; law: WatchLaw }[] = [];
  for (const item of items) {
    const law = laws.find((l) => norm(l.query) === norm(item.name) || norm(l.name) === norm(item.name));
    if (law && law.promulgated > item.baseline) out.push({ item, law });
  }
  return out.sort((a, b) => b.law.promulgated.localeCompare(a.law.promulgated));
}

export const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
/** 20260407 → 2026. 4. 7. */
export const fmtYmd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}. ${Number(s.slice(4, 6))}. ${Number(s.slice(6))}.` : s);
/** <input type=date> 값 ↔ YYYYMMDD */
export const fromDateInput = (v: string) => v.replace(/-/g, "");
export const toDateInput = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : "");
