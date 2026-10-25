/**
 * 질문 속 개인정보 가리기 — 검색·AI로 넘기기 전에(브라우저에서 한 번, 서버에서 한 번 더) 주민등록번호·전화번호 등을 ○○○ 으로 바꾼다.
 * 법령 근거를 찾는 데는 필요 없는 정보라 지워도 답이 달라지지 않는다. 이름·주소는 문장과 구별하기 어려워 대상에서 뺐다.
 * Python 판(python/law_for_all/privacy.py)과 같은 규칙.
 */
export interface MaskResult {
  text: string;
  /** 가린 종류(중복 없이, 규칙 순서) */
  found: string[];
}

const D = "(?<!\\d)";
const E = "(?!\\d)";
const RULES: [string, RegExp][] = [
  ["주민등록번호", new RegExp(`${D}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\s?-?\\s?[1-8]\\d{6}${E}`, "g")],
  ["카드번호", new RegExp(`${D}\\d{4}[- ]\\d{4}[- ]\\d{4}[- ]\\d{4}${E}`, "g")],
  ["전화번호", new RegExp(`${D}(?:01[016789]|0[2-6]\\d?|070|080)[- .]?\\d{3,4}[- .]?\\d{4}${E}`, "g")],
  ["이메일", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  // 계좌번호: 숫자 묶음 3~4개를 -로 이은 10자리 이상(날짜 2026-10-25 같은 8자리는 제외)
  ["계좌번호", new RegExp(`${D}\\d{2,6}-\\d{2,6}-\\d{2,8}(?:-\\d{1,4})?${E}`, "g")],
  ["여권번호", /(?<![A-Za-z0-9])[MSRODmsrod]\d{8}(?![A-Za-z0-9])/g],
];

export const MASK = "○○○";

export function maskPII(input: string): MaskResult {
  let text = input;
  const found: string[] = [];
  for (const [kind, re] of RULES) {
    text = text.replace(re, (m) => {
      if (kind === "계좌번호" && m.replace(/\D/g, "").length < 10) return m;
      if (!found.includes(kind)) found.push(kind);
      return MASK;
    });
  }
  return { text, found };
}

/** 가린 결과 안내 문구(가린 것이 없으면 빈 문자열) */
export function maskNotice(found: string[]): string {
  return found.length ? `개인정보 보호를 위해 질문 속 ${found.join("·")}를 ${MASK}(으)로 가리고 처리했어요(저장·전송하지 않음).` : "";
}
