import type { ExtractedFact } from "./types";

/**
 * 상황 서술에서 사실관계 단서를 추출(규칙기반, LLM 불필요).
 * 판사 관점의 요건 점검과 화면의 '사실관계 정리' 카드에 사용.
 */
const PARTIES: [RegExp, string][] = [
  [/집주인|임대인|건물주/, "임대인(집주인)"],
  [/세입자|임차인|전세\s*들|월세\s*들/, "임차인(세입자)"],
  [/회사|사장|사업주|대표|사용자/, "사용자(회사)"],
  [/근로자|직원|알바|아르바이트/, "근로자"],
  [/윗집|위층|아랫집|아래층|옆집|이웃/, "이웃 세대"],
  [/관리사무소|관리실|관리소/, "관리주체(관리사무소)"],
  [/구청|시청|주민센터|행정기관|공무원|기관/, "행정기관"],
  [/경찰/, "경찰"],
  [/중개사|부동산/, "공인중개사"],
];

const ACTS: [RegExp, string][] = [
  [/안\s*돌려|못\s*받|안\s*줘|반환하지|돌려주지|지급하지/, "금전 미지급·미반환"],
  [/소음|시끄|쿵쿵|발소리/, "소음 피해"],
  [/해고|잘렸|짤렸|나가라/, "해고"],
  [/퇴사|퇴직|그만뒀|그만두/, "퇴사"],
  [/사기|속였|속아|기망|잠적|연락\s*두절/, "기망·연락 두절 정황"],
  [/경매|공매/, "경매·공매 진행"],
  [/음주|술.*운전|운전.*술/, "음주운전"],
  [/거부|반려|불허|비공개/, "거부·비공개 처분"],
  [/육아휴직|출산/, "육아휴직·출산"],
  [/계약/, "계약 체결·종료"],
  [/이사/, "이사(전출입)"],
];

export function extractFacts(text: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const add = (kind: ExtractedFact["kind"], value: string) => {
    if (!out.some((f) => f.kind === kind && f.value === value)) out.push({ kind, value });
  };
  for (const [re, label] of PARTIES) if (re.test(text)) add("당사자", label);
  for (const m of Array.from(text.matchAll(/(\d[\d,.]*\s*(?:억|천만|백만|만)(?:\s*\d[\d,]*\s*(?:천만|백만|만))?\s*원?|\d{1,3}(?:,\d{3})+\s*원)/g))) add("금액", m[1].replace(/\s+/g, "").replace(/원?$/, "원"));
  for (const m of Array.from(text.matchAll(/(\d+\s*(?:년|개월|달|주|일|시간)\s*(?:째|전|후|동안|이상|이내|넘게)?)/g))) add("기간·시점", m[1].replace(/\s+/g, " ").trim());
  for (const m of Array.from(text.matchAll(/(어제|오늘|지난주|지난달|작년|올해|이번 달|새벽|밤마다|매일|주말마다)/g))) add("기간·시점", m[1]);
  for (const m of Array.from(text.matchAll(/(0\.\d+\s*%)/g))) add("행위·사건", `혈중알코올농도 ${m[1].replace(/\s/g, "")}`);
  for (const [re, label] of ACTS) if (re.test(text)) add("행위·사건", label);
  for (const m of Array.from(text.matchAll(/(아파트|빌라|오피스텔|다세대|원룸|회사|사무실)/g))) add("장소", m[1]);
  return out.slice(0, 16);
}
