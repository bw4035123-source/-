/**
 * 한국어 줄바꿈 다듬기 규칙(화면 표시용, 순수 함수) — components/layout/korean-wrap.tsx 가 화면 글자에 적용.
 * keep-all 은 띄어쓰기에서만 줄을 바꾸므로, 앞말에 기대는 짧은 말(의존명사·보조용언)이 다음 줄 첫머리로 떨어져
 * '맹신하지 / 말고', '변호사 / 등', '할 / 수 있어요'처럼 어색하게 끊긴다. 그 띄어쓰기만 줄바꿈 없는 공백(U+00A0)으로 바꿔 붙인다.
 * 글자 자체는 그대로(복사할 때는 일반 공백으로 되돌림).
 */
const NB = " ";
// 뒤에 올 수 있는 것: 끝·공백·문장부호·조사 첫 글자
const END = "(?=$|[\\s.,!?:;)\\]」』’”·…~이가을를은는도에의와과로만부까])";

// '·' 앞(U+2060 줄바꿈 금지)·뒤(U+200B 줄바꿈 자리) — 가운뎃점으로 이은 긴 말을 '·' 뒤에서 끊을 수 있게
const DOT = /(?<=[^\s⁠])·(?=[^\s​·])/g;
// 2026. 3. 12.
const DATE = /(\d{4}\.) (\d{1,2}\.) (\d{1,2}\.)/g;
// 보조용언: 맹신하지 말고 · 하지 않는 · 받지 못한 · 하지 마세요
const AUX_NEG = /(?<=[가-힣]지) (?=(?:말|않|못하|못한|못해|못했|마세요|마십시오|마라))/g;
// 할 수 있다 / 할 수 없다 / 볼 수도
const SU = /(?<=[가-힣]) (?=수(?:도)?[\s ](?:있|없))/g;
const SU_AUX = /(?<=(?:^|[\s ])수(?:도)?) (?=(?:있|없))/g;
// 의존명사·짧은 뒷말: 변호사 등 · 하는 것 · 할 때 · 결정 전에 · 공포 후 · 검토 중
const BOUND = new RegExp(`(?<=[가-힣A-Za-z0-9)」』]) (?=(?:등|것|때|뿐|줄|채|만큼|대로|전|후|중|따위|및)${END})`, "g");
// 숫자 + 단위: 30 일 · 3 개월 (붙여 쓰지 않은 경우)
const UNIT = /(?<=\d) (?=(?:개월|개|건|명|일|년|월|시간|분|초|조|항|호|원|만원|억원|%|퍼센트|배|회|차|세)(?:$|[\s.,)이가을를은는도에의와과로만부까]))/g;

/** dots=false: 가운뎃점은 그대로(입력칸 이름표처럼 글자가 곧 이름인 곳 — 공백만 줄바꿈 없는 공백으로) */
export function koreanWrap(v: string, dots = true): string {
  let s = v;
  // 닫는 괄호·따옴표 바로 뒤 조사는 떼지 않음: '조문(신구법 비교)을' → ')' 와 '을' 사이 줄바꿈 금지(U+2060)
  s = s.replace(/([)\]」』’”])(?=[을를이가은는에의와과로도만])/g, "$1\u2060");
  if (dots && s.indexOf("·") >= 0) s = s.replace(DOT, "⁠·​");
  if (s.indexOf(" ") < 0) return s;
  return s.replace(DATE, `$1${NB}$2${NB}$3`).replace(AUX_NEG, NB).replace(SU, NB).replace(SU_AUX, NB).replace(BOUND, NB).replace(UNIT, NB);
}

/** 복사·내보내기용 — 넣은 문자를 빼고 원래 글로 */
export const unwrapKorean = (s: string) => s.replace(/[​⁠]/g, "").replace(/ /g, " ").replace(/,\n/g, ", ");

/**
 * 안내·설명 글의 쉼표 뒤 줄바꿈 — ', ' 를 ',\n' 으로(요소에는 white-space: pre-line). 화면 표시만, 복사하면 원래 글.
 * 괄호·낫표·따옴표 안의 쉼표, 숫자 사이(1, 2), 짧은 나열(‘한글, Word’ 같은 몇 글자짜리)은 그대로 둔다 — 낱말 하나가 한 줄이 되지 않게.
 */
const OPEN = "([「『‘“<〈《";
const CLOSE = ")]」』’”>〉》";
const MIN_BEFORE = 8; // 쉼표 앞 구절 최소 글자 수(공백 제외)
const MIN_AFTER = 6; // 쉼표 뒤 남은 글자 수
const letters = (t: string) => t.replace(/[\s ​⁠]/g, "").length;

/** before: 같은 문단에서 이 글 앞에 있는 글(굵은 글씨 등 다른 요소로 나뉜 앞부분) — 쉼표 앞 구절 길이에 함께 셈 */
export function commaBreak(v: string, before = ""): string {
  if (v.indexOf(",") < 0) return v;
  let out = "";
  let depth = 0;
  let seg = before.slice(before.lastIndexOf("\n") + 1);
  // 짧은 말을 쉼표로 늘어놓은 나열(‘초안, 위임 사항 대조, 입법예고문’)은 그 문장 끝까지 줄을 바꾸지 않음
  let inList = false;
  // 쉼표 뒤 구절 — 다음 쉼표(괄호 밖)나 문장 끝까지
  const nextClause = (from: number) => {
    let d = 0;
    for (let j = from; j < v.length; j++) {
      const c = v[j];
      if (OPEN.includes(c)) d++;
      else if (CLOSE.includes(c)) d = Math.max(0, d - 1);
      else if (d === 0 && (c === "," || c === "\n" || (c === "." && /\s|$/.test(v[j + 1] ?? "")))) return v.slice(from, j);
    }
    return v.slice(from);
  };
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    const next = v[i + 1];
    if (ch === "," && depth === 0 && (next === " " || next === "\u00A0") && !/\d/.test(v[i - 1] ?? "")) {
      const after = nextClause(i + 2);
      if (letters(after) < MIN_BEFORE) inList = true;
      if (!inList && letters(seg) >= MIN_BEFORE && letters(after) >= MIN_AFTER) {
        out += ",\n";
        seg = "";
        i++; // 쉼표 뒤 공백을 줄바꿈으로 바꿈
        continue;
      }
    }
    out += ch;
    if (ch === "\n" || (ch === "." && /\s/.test(next ?? ""))) inList = false;
    seg = ch === "\n" ? "" : seg + ch; // 이미 바꾼 줄(다시 다듬을 때)에서 구절 길이를 새로 셈
  }
  return out;
}
