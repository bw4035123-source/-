/**
 * 수치 대조 — 생성형 AI 답변의 금액·기간·비율이 근거 조문 원문(또는 질문에 사용자가 직접 쓴 값)에 실제로 있는지 확인한다.
 * 조문 번호 검증(가짜 조문 차단)과 별도로, 진짜 조문을 인용하면서 숫자를 잘못 옮기는 오류(예: '14일'→'30일')를 잡는다.
 * 표기만 다른 같은 값은 같은 값으로 본다: '2천만원'='2,000만원'='20,000,000원', '5천5백만원'='5,500만원',
 * '0.03%'='0.03퍼센트', '100분의 50'='50%'. 표 위에 단위만 적은 별표(단위: dB)의 숫자도 인정한다.
 * Python 판 python/law_for_all/numbers.py 와 같은 규칙.
 */

const KO_UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };

const num = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** '1억 6천5백만', '2천만', '40만', '5,000만', '50,000' → 원 단위 정수 */
function koreanAmount(span: string): number {
  let total = 0;
  let section = 0; // 만 아래 자리(천·백·십·숫자)
  for (const m of span.matchAll(/(\d[\d,]*(?:\.\d+)?)?\s*(억|만|천|백|십)?/g)) {
    if (!m[1] && !m[2]) continue;
    const n = m[1] ? num(m[1]) : 0;
    const u = m[2];
    if (u === "억" || u === "만") {
      total += (section + n || (section ? 0 : 1)) * (u === "억" ? 1e8 : 1e4);
      section = 0;
    } else if (u) section += (m[1] ? n : 1) * KO_UNIT[u];
    else section += n;
  }
  return Math.round(total + section);
}

/** 글에 나온 수치를 '단위:값' 형태로(같은 값은 한 번) */
export function extractQuantities(text: string): string[] {
  const out = new Set<string>();
  let t = text
    // 날짜(2026. 6. 30. / 6월 30일 / 2019년)와 조문 번호(제36조·제2항)는 수치가 아님
    .replace(/\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/(?:19|20)\d{2}\s*년/g, " ")
    .replace(/제\s*\d+(?:조의?\d*|항|호|목|편|장|절)?(?:의\d+)?/g, " ");
  // 분수 비율: '100분의 50' → 50%
  t = t.replace(/(\d[\d,]*)\s*분의\s*(\d[\d,]*(?:\.\d+)?)/g, (_m, d: string, n: string) => {
    if (num(d)) out.add(`%:${fmt((num(n) / num(d)) * 100)}`);
    return " ";
  });
  // 금액(끝에 '원'이 있는 것만): '1억 2,000만원', '5천5백만원', '40만 원', '50,000원'
  t = t.replace(/(?<![\d.])\d[\d,]*(?:\.\d+)?(?:\s*(?:억|만|천|백|십)(?:\s*\d[\d,]*(?:\.\d+)?)?)*\s*원/g, (m) => {
    const v = koreanAmount(m.replace(/원$/, ""));
    if (v) out.add(`원:${v}`);
    return " ";
  });
  const unit = (re: RegExp, name: string) => {
    for (const m of t.matchAll(re)) out.add(`${name}:${fmt(num(m[1]))}`);
  };
  unit(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|퍼센트)/g, "%");
  unit(/(\d+)\s*개월/g, "개월");
  unit(/(\d+)\s*년(?!도)/g, "년");
  unit(/(\d+)\s*일(?![반부])/g, "일");
  unit(/(\d+)\s*시간/g, "시간");
  unit(/(\d+(?:\.\d+)?)\s*배/g, "배");
  unit(/(\d+)\s*세(?![대금])/g, "세");
  unit(/(\d+)\s*(?:dB|데시벨)/gi, "dB");
  return Array.from(out);
}

/**
 * 근거에서 확인되지 않은 수치 — answerTexts 의 수치 중 sources(근거 조문 원문·사용자 질문)에 없는 것.
 * 원문에 '14일'이 있으면 답변의 '14일'은 통과, '30일'은 미확인.
 */
export function unverifiedQuantities(answerTexts: string[], sources: string[]): string[] {
  const known = new Set(sources.flatMap(extractQuantities));
  // 별표 표는 '(단위: dB(A))'처럼 단위를 한 번만 적고 숫자만 나열 — 단위가 적힌 원문에 그 숫자가 있으면 인정
  const tables = sources.filter((s) => /dB|데시벨/i.test(s));
  // 100%는 원문이 '통상임금에 해당하는 금액'·'전액'으로 쓴 경우의 풀이로만 인정('2분의 1에 해당하는 금액'은 제외)
  const whole = sources.some((s) => /전액/.test(s) || Array.from(s.matchAll(/해당하는 금액/g)).some((m) => !/분의\s*\d+\s*에\s*$/.test(s.slice(Math.max(0, m.index! - 12), m.index))));
  return extractQuantities(answerTexts.join("\n")).filter((q) => {
    if (known.has(q) || (q === "%:100" && whole)) return false;
    const [u, v] = q.split(":");
    return !(u === "dB" && tables.some((s) => new RegExp(`(?<![\\d.])${v.replace(".", "\\.")}(?![\\d.])`).test(s)));
  });
}

/** 사람이 읽는 표기('일:30' → '30일', '원:400000' → '40만원') */
export function quantityLabel(q: string): string {
  const [u, v] = q.split(":");
  const n = Number(v);
  if (u === "원") return n >= 1e8 && n % 1e8 === 0 ? `${n / 1e8}억원` : n >= 1e4 && n % 1e4 === 0 ? `${(n / 1e4).toLocaleString("ko-KR")}만원` : `${n.toLocaleString("ko-KR")}원`;
  return `${v}${u}`;
}
