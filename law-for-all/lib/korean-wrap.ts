/**
 * 한국어 줄바꿈 다듬기 규칙(화면 표시용, 순수 함수) — components/layout/korean-wrap.tsx 가 화면 글자에 적용.
 * 줄을 '강제로' 바꾸지 않는다. 의미 단위(어절·구)가 중간에서 갈라지지 않도록 묶기만 하고,
 * 실제로 어디서 줄이 바뀔지는 화면 너비에 맡긴다(반응형).
 *  - 앞말에 기대는 짧은 말: '맹신하지 말고', '변호사 등', '할 수 있어요', '결정 전에' → 줄바꿈 없는 공백(U+00A0)
 *  - 날짜 '2026. 3. 12.', 숫자+단위 '30 일' → 붙임
 *  - 닫는 괄호·따옴표 뒤 조사 '(신구법 비교)을' → 붙임(U+2060)
 *  - 쉼표로 늘어놓은 짧은 항목 '…개정안, 신·구조문 대비표, 상위법 정합성 점검, …' → 항목 안은 붙이고 항목 사이(쉼표 뒤)에서만 줄이 바뀌게
 *  - 가운뎃점으로 이은 긴 말 '괴롭힘·성희롱' → '·' 뒤에서 끊을 수 있게(U+200B), 앞에서는 끊지 않게(U+2060)
 * 글자 자체는 그대로(복사할 때는 넣은 문자를 빼고 원래 글로).
 */
const NB = " ";
const WJ = "⁠"; // 줄바꿈 금지(보이지 않음)
const ZW = "​"; // 줄바꿈 자리(보이지 않음)
// 뒤에 올 수 있는 것: 끝·공백·문장부호·조사 첫 글자
const END = "(?=$|[\\s.,!?:;)\\]」』’”·…~이가을를은는도에의와과로만부까])";

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
// 닫는 괄호·따옴표 바로 뒤 조사
const CLOSE_JOSA = /([)\]」』’”])(?=[을를이가은는에의와과로도만])/g;

// 쉼표 나열의 짧은 항목: 앞뒤가 ', ' 인 항목 중 공백 3개 이하·12글자 이하
const ITEM_MAX_LETTERS = 12;
const ITEM_MAX_SPACES = 3;
const letters = (t: string) => t.replace(/[\s ​⁠·]/g, "").length;

/** 쉼표로 늘어놓은 짧은 항목 안의 띄어쓰기·'·' 뒤 줄바꿈 자리를 없애 항목이 갈라지지 않게 — 줄은 항목 사이(쉼표 뒤)에서 바뀜 */
export function bindListItems(s: string): string {
  if (s.indexOf(", ") < 0) return s;
  const parts = s.split(/(,[  ])/); // [텍스트, 구분, 텍스트, 구분, …]
  if (parts.length < 5) return s; // 항목이 사이에 끼려면 쉼표가 둘 이상
  for (let i = 2; i < parts.length - 1; i += 2) {
    const item = parts[i];
    const spaces = (item.match(/[  ]/g) ?? []).length;
    if (letters(item) <= ITEM_MAX_LETTERS && spaces <= ITEM_MAX_SPACES && !/[.!?]/.test(item)) parts[i] = item.replace(/ /g, NB).replace(/\u200B/g, "").replace(/·(?!\u2060)/g, `·${WJ}`);
  }
  return parts.join("");
}

/** dots=false: 가운뎃점은 그대로(입력칸 이름표처럼 글자가 곧 이름인 곳 — 공백만 줄바꿈 없는 공백으로) */
export function koreanWrap(v: string, dots = true): string {
  let s = v.replace(CLOSE_JOSA, `$1${WJ}`);
  if (dots && s.indexOf("·") >= 0) s = s.replace(DOT, `${WJ}·${ZW}`);
  if (s.indexOf(" ") < 0) return s;
  s = s.replace(DATE, `$1${NB}$2${NB}$3`).replace(AUX_NEG, NB).replace(SU, NB).replace(SU_AUX, NB).replace(BOUND, NB).replace(UNIT, NB);
  return bindListItems(s);
}

/** 복사·내보내기용 — 넣은 문자를 빼고 원래 글로 */
export const unwrapKorean = (s: string) => s.replace(/[​⁠]/g, "").replace(/ /g, " ");
