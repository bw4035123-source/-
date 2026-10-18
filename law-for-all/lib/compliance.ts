/**
 * 우리 기관 규정 ↔ 상위법령 교차 검증 엔진(순수 함수, 브라우저·서버 공통).
 *  1) 규정 원문을 조문 단위로 나눈다(제N조(제목) …).
 *  2) 기관 규정이 인용한 상위법령 조문이 실제로 존재하는지 확인한다(실시간 원문이면 전체 조문 기준).
 *  3) 근로기준법·청탁금지법·공직선거법·지방공기업법·공유재산법의 수치·절차 기준과 규정 조항을 대조한다.
 *  4) 위반 신호가 없는 조문은 관련 상위 조문만 연결한다.
 * 판정은 정해진 규칙과 조문 원문으로만 하며, 생성형 문장으로 위반 여부를 단정하지 않는다.
 */
import type { LawDoc } from "./law-api/types";
import { articleLabel } from "./law-api/util";

export type OrgType = "공기업·준정부기관" | "지방공기업" | "지방자치단체" | "기타 공공기관";
export const ORG_TYPES: OrgType[] = ["공기업·준정부기관", "지방공기업", "지방자치단체", "기타 공공기관"];

/** 교차 검증 대상 상위법령 */
export const TARGET_LAWS: { id: string; name: string; aliases: string[] }[] = [
  { id: "labor-standards", name: "근로기준법", aliases: ["근로기준법"] },
  { id: "anti-graft", name: "부정청탁 및 금품등 수수의 금지에 관한 법률", aliases: ["부정청탁 및 금품등 수수의 금지에 관한 법률", "청탁금지법", "부정청탁금지법", "김영란법"] },
  { id: "public-election", name: "공직선거법", aliases: ["공직선거법", "선거법"] },
  { id: "local-public-enterprise", name: "지방공기업법", aliases: ["지방공기업법"] },
  { id: "public-property", name: "공유재산 및 물품 관리법", aliases: ["공유재산 및 물품 관리법", "공유재산법"] },
];

export type Severity = "conflict" | "review" | "ok" | "info";
export const SEVERITY_LABEL: Record<Severity, string> = { conflict: "상충", review: "검토 필요", ok: "적합", info: "참고" };

export interface RegArticle {
  /** "3", "3의2", 조문 구분이 없으면 "전문" */
  no: string;
  title: string;
  text: string;
}

export interface BasisRef {
  lawId: string;
  articleNo: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  basis: BasisRef[];
  /** 규정 문구 → 고친 문구(수치 위반 등 자동 제안이 가능한 경우) */
  fix?: { before: string; after: string };
}

export interface ArticleResult {
  article: RegArticle;
  status: Severity;
  findings: Finding[];
  /** 관련 상위 조문(위반 신호와 별개로 연결) */
  related: BasisRef[];
}

export interface CheckReport {
  orgType: OrgType;
  regName: string;
  results: ArticleResult[];
  counts: Record<Severity, number>;
  /** 기관 규정이 인용한 상위 조문 검증 결과 수 */
  refsChecked: number;
  /** 실시간 원문으로 검증했는지(법령 id별) */
  liveLaws: string[];
}

// ───────────────────────────── 1) 조문 분리
const HEAD = /^\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:[(（]([^)）]*)[)）])?\s*(.*)$/;

export function parseRegulation(text: string): RegArticle[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: RegArticle[] = [];
  let cur: RegArticle | null = null;
  for (const line of lines) {
    if (/^\s*부\s*칙/.test(line)) break; // 부칙(시행일·경과조치)은 검증 대상에서 제외
    if (/^\s*제\s*\d+\s*(장|절|관)(\s|$)/.test(line)) continue; // 장·절 제목
    const m = line.match(HEAD);
    if (m) {
      cur = { no: m[2] ? `${m[1]}의${m[2]}` : m[1], title: (m[3] ?? "").trim(), text: (m[4] ?? "").trim() };
      out.push(cur);
    } else if (cur && line.trim()) {
      cur.text += (cur.text ? "\n" : "") + line.trim();
    }
  }
  if (!out.length && text.trim()) out.push({ no: "전문", title: "", text: text.trim() });
  return out;
}

export const regArticleLabel = (a: RegArticle) => (a.no === "전문" ? "전문" : `${articleLabel(a.no)}${a.title ? `(${a.title})` : ""}`);

// ───────────────────────────── 2) 인용 조문 검증
const squash = (s: string) => s.replace(/\s+/g, "");
const ALIAS = TARGET_LAWS.flatMap((l) => l.aliases.map((a) => ({ id: l.id, alias: squash(a) }))).sort((a, b) => b.alias.length - a.alias.length);

export interface RegReference {
  raw: string;
  lawId: string | null;
  lawName: string;
  articleNo: string;
  decree: boolean;
}

export function findReferences(text: string): RegReference[] {
  const out: RegReference[] = [];
  const re = /(?:「([^」]{2,60})」|(근로기준법|지방공기업법|공직선거법|청탁금지법|부정청탁금지법|공유재산법|김영란법))\s*(시행령|시행규칙)?\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;
  for (const m of Array.from(text.matchAll(re))) {
    const name = (m[1] ?? m[2]).trim();
    const hit = ALIAS.find((a) => squash(name) === a.alias);
    out.push({ raw: m[0], lawId: hit?.id ?? null, lawName: name, articleNo: m[5] ? `${m[4]}의${m[5]}` : m[4], decree: !!m[3] });
  }
  return out;
}

function checkReferences(a: RegArticle, laws: Map<string, LawDoc>): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const r of findReferences(a.text)) {
    const k = `${r.lawName}|${r.decree}|${r.articleNo}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!r.lawId || r.decree) {
      out.push({
        rule: "ref-external",
        severity: "info",
        title: `인용 확인: ${r.raw}`,
        detail: r.decree ? "시행령·시행규칙 조문은 교차 검증 대상 밖이므로 국가법령정보센터 원문에서 현행 여부를 확인하세요." : "교차 검증 대상 5개 법령 밖의 법령입니다. 국가법령정보센터 원문에서 현행 여부를 확인하세요.",
        basis: [],
      });
      continue;
    }
    const law = laws.get(r.lawId);
    const art = law?.articles.find((x) => x.no === r.articleNo);
    if (art) {
      out.push({ rule: "ref-ok", severity: "ok", title: `인용 조문 확인: ${r.raw}`, detail: `현행 「${law!.name}」 ${articleLabel(r.articleNo)}(${art.title})와 일치하는 조문이 있습니다.`, basis: [{ lawId: r.lawId, articleNo: r.articleNo }] });
    } else if (law?.source === "live") {
      out.push({
        rule: "ref-missing",
        severity: "conflict",
        title: `존재하지 않는 조문 인용: ${r.raw}`,
        detail: `현행 「${law.name}」(국가법령정보 실시간 원문)에 ${articleLabel(r.articleNo)}가 없습니다. 조문 삭제·이동 여부를 확인해 인용을 고쳐야 합니다.`,
        basis: [],
      });
    } else {
      out.push({
        rule: "ref-unverified",
        severity: "review",
        title: `인용 조문 원문 확인 필요: ${r.raw}`,
        detail: "내장 원문 범위 밖의 조문입니다. 국가법령정보 실시간 연결 시 자동으로 존재 여부를 확인합니다.",
        basis: [],
      });
    }
  }
  return out;
}

// ───────────────────────────── 3) 기준 대조 규칙
const sentences = (t: string) =>
  t
    .split(/\n|(?<=[.。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
const nums = (s: string, re: RegExp) => Array.from(s.matchAll(re), (m) => ({ value: Number(m[1]), raw: m[0] }));
const PERMIT = /할\s*수\s*있|허용|가능하|인정한다|받을\s*수|수수할\s*수/;
const replaceNum = (raw: string, from: number, to: number) => raw.replace(String(from), String(to));

interface RuleCtx {
  a: RegArticle;
  org: OrgType;
  /** 문서 전체(조문 간 맥락이 필요한 규칙용) */
  doc: string;
}
type Rule = (c: RuleCtx) => Finding[];

const L = "labor-standards";
const G = "anti-graft";
const E = "public-election";
const P = "local-public-enterprise";
const Y = "public-property";

const RULES: Rule[] = [
  // 근로시간 1주 40시간·1일 8시간
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /근로시간|근무시간|소정근로/.test(s) && !/연장|초과근무|시간외/.test(s) && !/^\s*(?:[①-⑳]\s*)?휴게/.test(s))
      .flatMap((s) => [
        ...nums(s, /(?:1주|주)\s*(?:간|당|에)?\s*(\d+)\s*시간/g)
          .filter((n) => n.value > 40)
          .map<Finding>((n) => ({ rule: "work-hours-week", severity: "conflict", title: `1주 근로시간 ${n.value}시간 — 법정 한도 40시간 초과`, detail: "1주 간의 근로시간은 휴게시간을 제외하고 40시간을 초과할 수 없습니다. 법 기준에 미달하는 근로조건은 그 부분이 무효가 되어 법 기준이 적용됩니다.", basis: [{ lawId: L, articleNo: "50" }, { lawId: L, articleNo: "15" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 40) } })),
        ...nums(s, /1일\s*(\d+)\s*시간/g)
          .filter((n) => n.value > 8)
          .map<Finding>((n) => ({ rule: "work-hours-day", severity: "conflict", title: `1일 근로시간 ${n.value}시간 — 법정 한도 8시간 초과`, detail: "1일의 근로시간은 휴게시간을 제외하고 8시간을 초과할 수 없습니다.", basis: [{ lawId: L, articleNo: "50" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 8) } })),
      ]),
  // 연장근로 1주 12시간
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /연장근로|연장근무|시간외\s*근무|시간외근로|초과근무/.test(s))
      .flatMap((s) => [
        ...nums(s, /(?:1주|주)\s*(?:간|당|에)?\s*(\d+)\s*시간/g)
          .filter((n) => n.value > 12)
          .map<Finding>((n) => ({ rule: "overtime-week", severity: "conflict", title: `연장근로 1주 ${n.value}시간 — 법정 한도 12시간 초과`, detail: "당사자 간 합의가 있어도 연장근로는 1주 12시간이 한도입니다(특별한 사정이 있을 때 고용노동부장관 인가 등 예외).", basis: [{ lawId: L, articleNo: "53" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 12) } })),
        ...nums(s, /(?:월|1개월)\s*(?:간|당)?\s*(\d+)\s*시간/g)
          .filter((n) => n.value > 0)
          .map<Finding>((n) => ({ rule: "overtime-month", severity: "review", title: `연장근로 월 ${n.value}시간 — 주 단위 한도로 환산 확인`, detail: "법은 연장근로 한도를 1주 12시간으로 정합니다. 월 단위 한도만 두면 특정 주에 12시간을 넘을 수 있으므로 주 단위 상한을 함께 규정하세요.", basis: [{ lawId: L, articleNo: "53" }] })),
      ]),
  // 휴게시간
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /휴게/.test(s))
      .flatMap((s) => {
        const out: Finding[] = [];
        const m4 = s.match(/4시간[^0-9]{0,15}?(\d+)\s*분/);
        if (m4 && Number(m4[1]) < 30) out.push({ rule: "rest-4h", severity: "conflict", title: `4시간 근로 시 휴게 ${m4[1]}분 — 법정 30분 미달`, detail: "근로시간이 4시간인 경우 30분 이상, 8시간인 경우 1시간 이상의 휴게시간을 근로시간 도중에 주어야 합니다.", basis: [{ lawId: L, articleNo: "54" }], fix: { before: m4[0], after: m4[0].replace(`${m4[1]}`, "30") } });
        const m8 = s.match(/8시간[^0-9]{0,15}?(\d+)\s*분/);
        if (m8 && Number(m8[1]) < 60) out.push({ rule: "rest-8h", severity: "conflict", title: `8시간 근로 시 휴게 ${m8[1]}분 — 법정 1시간 미달`, detail: "근로시간이 8시간인 경우 1시간 이상의 휴게시간을 주어야 합니다.", basis: [{ lawId: L, articleNo: "54" }], fix: { before: m8[0], after: m8[0].replace(`${m8[1]}분`, "1시간") } });
        return out;
      }),
  // 연차 유급휴가 15일
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /연차|연가|유급휴가/.test(s) && /1년|80|출근/.test(s) && !/1개월\s*개근/.test(s))
      .flatMap((s) =>
        nums(s, /(\d+)\s*일(?:의|간)?\s*(?:유급휴가|연차|연가|휴가)?/g)
          .filter((n) => n.value > 0 && n.value < 15)
          .slice(0, 1)
          .map<Finding>((n) => ({ rule: "annual-leave", severity: "conflict", title: `연차휴가 ${n.value}일 — 법정 15일 미달`, detail: "1년간 80퍼센트 이상 출근한 근로자에게는 15일의 유급휴가를 주어야 합니다. 법보다 적게 정한 부분은 무효가 되고 법 기준이 적용됩니다.", basis: [{ lawId: L, articleNo: "60" }, { lawId: L, articleNo: "15" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 15) } })),
      ),
  // 연장·야간·휴일 가산
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /연장|야간|휴일/.test(s) && /가산|할증|수당|통상임금/.test(s))
      .flatMap((s) => {
        const out: Finding[] = [];
        for (const n of nums(s, /100분의\s*(\d+)/g)) if (n.value < 50) out.push({ rule: "premium", severity: "conflict", title: `가산율 100분의 ${n.value} — 법정 100분의 50 미달`, detail: "연장근로·야간근로와 8시간 이내 휴일근로는 통상임금의 100분의 50 이상(8시간 초과 휴일근로는 100분의 100)을 가산해야 합니다.", basis: [{ lawId: L, articleNo: "56" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 50) } });
        for (const n of nums(s, /(\d+)\s*(?:%|퍼센트)/g)) if (n.value < 50) out.push({ rule: "premium", severity: "conflict", title: `가산율 ${n.value}% — 법정 50% 미달`, detail: "연장·야간·휴일근로 가산은 통상임금의 50% 이상이어야 합니다.", basis: [{ lawId: L, articleNo: "56" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 50) } });
        const x = s.match(/(\d+(?:\.\d+)?)\s*배/);
        if (x && Number(x[1]) < 1.5) out.push({ rule: "premium", severity: "conflict", title: `통상임금의 ${x[1]}배 — 법정 1.5배 미달`, detail: "가산 후 지급액은 통상임금의 1.5배 이상이어야 합니다.", basis: [{ lawId: L, articleNo: "56" }], fix: { before: x[0], after: x[0].replace(x[1], "1.5") } });
        return out;
      }),
  // 해고 예고 30일
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /해고/.test(s) && /예고|통지|통보/.test(s))
      .flatMap((s) => nums(s, /(\d+)\s*일\s*전/g).filter((n) => n.value < 30).map<Finding>((n) => ({ rule: "dismissal-notice", severity: "conflict", title: `해고 예고 ${n.value}일 전 — 법정 30일 미달`, detail: "해고하려면 적어도 30일 전에 예고하고, 예고하지 않으면 30일분 이상의 통상임금을 지급해야 합니다.", basis: [{ lawId: L, articleNo: "26" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 30) } }))),
  // 출산전후휴가 90일
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /출산전후휴가|출산휴가|산전후\s*휴가/.test(s))
      .flatMap((s) => {
        const n = nums(s, /(\d+)\s*일/g).sort((x, y) => y.value - x.value)[0];
        return n && n.value < 90 ? [{ rule: "maternity", severity: "conflict" as const, title: `출산전후휴가 ${n.value}일 — 법정 90일 미달`, detail: "출산 전과 후를 통하여 90일(미숙아 출산 100일, 다태아 120일)의 출산전후휴가를 주어야 합니다.", basis: [{ lawId: L, articleNo: "74" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 90) } }] : [];
      }),
  // 금품 청산 14일
  ({ a }) =>
    sentences(a.text)
      .filter((s) => /퇴직|사망/.test(s) && /지급|청산|정산/.test(s) && !/합의/.test(s))
      .flatMap((s) => nums(s, /(\d+)\s*일\s*이내/g).filter((n) => n.value > 14).map<Finding>((n) => ({ rule: "settlement", severity: "conflict", title: `퇴직 금품 ${n.value}일 이내 지급 — 법정 14일 초과`, detail: "근로자가 사망·퇴직하면 지급 사유가 발생한 때부터 14일 이내에 임금·보상금 등 모든 금품을 지급해야 합니다(당사자 합의로 연장 가능).", basis: [{ lawId: L, articleNo: "36" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 14) } }))),
  // 사규가 법령에 우선한다는 조항
  ({ a }) =>
    /((?:이|본)\s*[가-힣]{0,6}(?:규정|규칙|강령|지침)|사규)[^.\n]{0,20}(법령|법률)[^.\n]{0,10}(우선|에\s*앞서)|법령과\s*달리\s*정할\s*수\s*있/.test(a.text)
      ? [{ rule: "precedence", severity: "conflict", title: "자체규정이 법령보다 우선한다는 조항", detail: "취업규칙(사규)은 법령이나 단체협약과 어긋날 수 없고, 고용노동부장관은 법령에 어긋나는 취업규칙의 변경을 명할 수 있습니다. 법령 우선 원칙으로 고치세요.", basis: [{ lawId: L, articleNo: "96" }] }]
      : [],
  // 취업규칙 변경 절차(의견청취·불이익 변경 동의)
  ({ a, doc }) =>
    /취업규칙|사규|인사규정|복무규정|보수규정/.test(doc) && (/개정|변경/.test(a.title) || /(규정|규칙|사규)의?\s*(개정|변경)/.test(a.text)) && !/과반수|노동조합|근로자\s*대표|동의|의견/.test(a.text)
      ? [{ rule: "change-procedure", severity: "review", title: "규정 개정 절차에 근로자 의견청취·동의 절차 누락", detail: "취업규칙을 작성·변경할 때는 근로자 과반수로 조직된 노동조합(없으면 근로자 과반수)의 의견을 들어야 하고, 근로자에게 불리하게 변경할 때는 그 동의를 받아야 합니다.", basis: [{ lawId: L, articleNo: "94" }] }]
      : [],
  // 청탁금지법 — 금품 수수 허용 범위
  ({ a }) => {
    const out: Finding[] = [];
    for (const s of sentences(a.text).filter((x) => /금품|선물|사례|접대|향응|경조사비|축의금|조의금|상품권|음식물/.test(x) && PERMIT.test(x))) {
      const yearly = /연간|매\s*회계연도|1년/.test(s);
      for (const n of nums(s, /(\d+)\s*만\s*원/g)) {
        if (yearly && n.value > 300) out.push({ rule: "graft-yearly", severity: "conflict", title: `연간 ${n.value}만원까지 허용 — 법정 300만원 초과`, detail: "공직자등은 직무 관련 여부와 관계없이 동일인으로부터 매 회계연도 300만원을 초과하는 금품등을 받을 수 없습니다.", basis: [{ lawId: G, articleNo: "8" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 300) } });
        else if (!yearly && n.value > 100) out.push({ rule: "graft-once", severity: "conflict", title: `1회 ${n.value}만원까지 허용 — 법정 100만원 초과`, detail: "공직자등은 직무 관련 여부와 관계없이 동일인으로부터 1회 100만원을 초과하는 금품등을 받을 수 없습니다.", basis: [{ lawId: G, articleNo: "8" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 100) } });
      }
      if (/직무\s*관련|직무와\s*관련|민원인|협력업체|거래처|이해관계/.test(s) && !/대통령령|시행령|가액\s*범위|청탁금지법|부정청탁 및 금품등/.test(s))
        out.push({ rule: "graft-duty", severity: "review", title: "직무관련자로부터의 금품 수수 허용 조항", detail: "직무와 관련해서는 금액과 관계없이 금품등을 받을 수 없고, 원활한 직무수행·사교·의례·부조 목적의 음식물·경조사비·선물만 대통령령(시행령 별표)의 가액 범위 안에서 예외입니다. 예외 요건과 가액 범위를 시행령에 맞춰 명시하세요.", basis: [{ lawId: G, articleNo: "8" }] });
    }
    return out;
  },
  // 외부강의 신고 10일
  ({ a }) => {
    if (!/외부강의|외부\s*강연|강의ㆍ강연|기고/.test(a.text)) return [];
    const out: Finding[] = [];
    for (const s of sentences(a.text).filter((x) => /신고|보고/.test(x)))
      for (const n of nums(s, /(\d+)\s*일\s*이내/g)) if (n.value > 10) out.push({ rule: "lecture-deadline", severity: "conflict", title: `외부강의 신고 ${n.value}일 이내 — 법정 10일 초과`, detail: "사례금을 받는 외부강의등은 마친 날부터 10일 이내에 소속기관장에게 서면으로 신고해야 합니다.", basis: [{ lawId: G, articleNo: "10" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 10) } });
    if (/사례금|대가/.test(a.text) && !/신고|보고/.test(a.text)) out.push({ rule: "lecture-report", severity: "review", title: "사례금 받는 외부강의의 신고 의무 누락", detail: "사례금을 받는 외부강의등은 요청 명세 등을 마친 날부터 10일 이내에 서면으로 신고해야 합니다(국가·지방자치단체 요청은 제외).", basis: [{ lawId: G, articleNo: "10" }] });
    return out;
  },
  // 부정청탁 신고 절차
  ({ a }) =>
    /부정청탁/.test(a.text) && /신고/.test(a.text) && !/서면|전자문서/.test(a.text)
      ? [{ rule: "graft-report-form", severity: "review", title: "부정청탁 신고 방식(서면) 미기재", detail: "부정청탁을 받으면 거절 의사를 명확히 표시하고, 동일한 부정청탁을 다시 받은 경우 소속기관장에게 서면(전자문서 포함)으로 신고해야 합니다.", basis: [{ lawId: G, articleNo: "7" }] }]
      : [],
  // 공직선거법 — 선거운동·정치활동 허용
  ({ a, org }) =>
    sentences(a.text).some((s) => /선거운동|정치활동|정치\s*활동|특정\s*(정당|후보)|지지/.test(s) && PERMIT.test(s) && !/금지|아니\s*된다|할\s*수\s*없/.test(s))
      ? [{
          rule: "election",
          severity: "conflict",
          title: "선거운동·정치활동을 허용하는 조항",
          detail:
            (org === "지방자치단체" ? "공무원은 선거운동을 할 수 없고" : "지방공사·지방공단과 정부 지분 50% 이상 공공기관의 상근 임원은 선거운동을 할 수 없으며") +
            ", 누구든지 조직 내 직무상 행위를 이용해 구성원에게 선거운동을 할 수 없습니다. 정치적 중립을 지켜야 하는 자는 선거결과에 영향을 미치는 행위를 해서는 안 됩니다. 허용 범위를 직위별로 다시 정하세요.",
          basis: [{ lawId: E, articleNo: "60" }, { lawId: E, articleNo: "85" }, { lawId: E, articleNo: "9" }],
        }]
      : [],
  // 공직선거법 — 홍보·행사·출장 규정의 선거기간 제한 반영
  ({ a }) =>
    /기공식|업적|홍보물|정책\s*홍보|행사\s*개최/.test(a.text) && !/선거/.test(a.text)
      ? [{ rule: "election-period", severity: "review", title: "홍보·행사 규정에 선거기간 제한 미반영", detail: "공무원·공공기관 상근 임원 등은 소속직원·선거구민에게 정당·후보자 업적 홍보를 할 수 없고, 선거기간 중 즉시 착공하지 않을 사업의 기공식, 정상적 업무 외 출장이 금지됩니다. 지방자치단체의 장은 선거일전 60일부터 각종 행사 개최가 제한됩니다.", basis: [{ lawId: E, articleNo: "86" }] }]
      : [],
  // 지방공기업법 — 임원 임기 3년·1년 단위 연임
  ({ a, org, doc }) => {
    if (org !== "지방공기업" && !/지방공사|지방공단|도시공사|시설관리공단|지방공기업/.test(doc)) return [];
    const out: Finding[] = [];
    for (const s of sentences(a.text).filter((x) => /임기/.test(x) && /사장|이사장|이사|감사|임원/.test(x))) {
      for (const n of nums(s, /(\d+)\s*년(?!\s*단위)/g)) if (n.value !== 3) out.push({ rule: "lpe-term", severity: "conflict", title: `임원 임기 ${n.value}년 — 법정 3년과 다름`, detail: "공사(공단)의 사장(이사장), 이사 및 감사의 임기는 3년입니다(공단은 제76조로 준용).", basis: [{ lawId: P, articleNo: "59" }, { lawId: P, articleNo: "76" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 3) } });
    }
    for (const s of sentences(a.text).filter((x) => /연임/.test(x)))
      for (const n of nums(s, /(\d+)\s*년\s*단위/g)) if (n.value !== 1) out.push({ rule: "lpe-renew", severity: "conflict", title: `연임 단위 ${n.value}년 — 법정 1년 단위와 다름`, detail: "사장, 이사 및 감사는 1년 단위로 연임될 수 있습니다.", basis: [{ lawId: P, articleNo: "59" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 1) } });
    if (/(사장|이사장|감사|상임이사|비상임이사)/.test(a.text) && /임명|선임|임면/.test(a.text) && !/임원추천위원회|추천/.test(a.text))
      out.push({ rule: "lpe-recommend", severity: "review", title: "임원 임명 절차에 임원추천위원회 추천 누락", detail: "사장·감사와 이사는 임원추천위원회가 추천한 사람 중에서 임명해야 하고, 임원추천위원회는 후보자를 공개모집해야 합니다(인사청문회를 실시하는 경우 등 예외).", basis: [{ lawId: P, articleNo: "58" }] });
    return out;
  },
  // 공유재산법 — 사용허가기간·갱신
  ({ a }) => {
    if (!/사용허가|사용ㆍ수익허가|사용·수익허가|사용수익허가/.test(a.text)) return [];
    const out: Finding[] = [];
    for (const s of sentences(a.text).filter((x) => /기간/.test(x) && !/기부/.test(x)))
      for (const n of nums(s, /(\d+)\s*년/g)) if (n.value > 5) out.push({ rule: "prop-permit-term", severity: "conflict", title: `사용허가기간 ${n.value}년 — 법정 5년 초과`, detail: "행정재산의 사용허가기간은 허가받은 날부터 5년 이내입니다(기부채납 무상사용은 총 20년 한도의 별도 기준).", basis: [{ lawId: Y, articleNo: "21" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 5) } });
    if (/자동\s*(으로)?\s*(연장|갱신)/.test(a.text)) out.push({ rule: "prop-auto-renew", severity: "conflict", title: "사용허가 자동 연장·갱신 조항", detail: "사용허가 갱신은 기간이 끝나기 1개월 전 신청을 받아 하며, 수의 방법으로 사용·수익할 수 있는 경우가 아니면 한 차례(1회 5년 범위)만 갱신할 수 있습니다. 자동 연장은 법률 절차와 맞지 않습니다.", basis: [{ lawId: Y, articleNo: "21" }] });
    if (/일반입찰|입찰/.test(a.text) === false && /수의/.test(a.text) && !/대통령령|시행령|법\s*제/.test(a.text)) out.push({ rule: "prop-bid", severity: "review", title: "수의 사용허가 사유 미한정", detail: "사용허가는 일반입찰이 원칙이고, 대통령령으로 정하는 경우에만 제한·지명경쟁 또는 수의 방법으로 허가할 수 있습니다.", basis: [{ lawId: Y, articleNo: "20" }] });
    if (/전대|다른\s*자에게\s*사용/.test(a.text) && PERMIT.test(a.text) && !/아니\s*된다|할\s*수\s*없|금지/.test(a.text)) out.push({ rule: "prop-sublet", severity: "conflict", title: "사용허가 재산의 전대 허용", detail: "사용허가를 받은 자는 그 행정재산을 다른 자에게 사용·수익하게 할 수 없습니다(기부자 등은 승인을 받은 경우만 예외).", basis: [{ lawId: Y, articleNo: "20" }] });
    return out;
  },
  // 공유재산법 — 대부기간
  ({ a }) => {
    if (!/대부/.test(a.text)) return [];
    const out: Finding[] = [];
    for (const s of sentences(a.text).filter((x) => /대부/.test(x) && /기간/.test(x))) {
      const land = /토지|정착물|건물/.test(s);
      for (const n of nums(s, /(\d+)\s*년/g)) {
        if (land && n.value > 5) out.push({ rule: "prop-lease-land", severity: "conflict", title: `토지·정착물 대부기간 ${n.value}년 — 법정 5년 초과`, detail: "일반재산 중 토지와 그 정착물의 대부기간은 5년을 초과할 수 없습니다(지역경제 활성화 등 대통령령 예외).", basis: [{ lawId: Y, articleNo: "31" }], fix: { before: n.raw, after: replaceNum(n.raw, n.value, 5) } });
        else if (!land && n.value > 1) out.push({ rule: "prop-lease-other", severity: "review", title: `대부기간 ${n.value}년 — 재산 종류 확인 필요`, detail: "토지와 그 정착물은 5년, 그 밖의 재산은 1년을 초과할 수 없습니다. 대상 재산 종류를 명시하세요.", basis: [{ lawId: Y, articleNo: "31" }] });
      }
    }
    if (/전대|다른\s*자에게\s*사용/.test(a.text) && PERMIT.test(a.text) && !/아니\s*된다|할\s*수\s*없|금지/.test(a.text)) out.push({ rule: "prop-lease-sublet", severity: "conflict", title: "대부 재산의 전대 허용", detail: "대부를 받은 자는 그 일반재산을 다른 자에게 사용하게 할 수 없습니다.", basis: [{ lawId: Y, articleNo: "29" }] });
    return out;
  },
  // 기관 규정으로 형벌·과태료를 정한 경우
  ({ a }) =>
    /(징역|벌금|과태료)[^.\n]{0,15}(에\s*처|를\s*부과|부과한다)/.test(a.text)
      ? [{ rule: "penalty", severity: "review", title: "기관 규정에서 형벌·과태료를 정한 조항", detail: "징역·벌금·과태료는 법률(또는 법률의 위임을 받은 조례)로만 정할 수 있습니다. 기관 규정에서는 징계 등 내부 제재로 정하고, 형벌·과태료는 근거 법률 조항을 안내하는 방식으로 고치세요.", basis: [] }]
      : [],
];

// ───────────────────────────── 4) 관련 조문 연결
function relatedArticles(a: RegArticle, laws: Map<string, LawDoc>, exclude: Set<string>): BasisRef[] {
  const text = squash(`${a.title} ${a.text}`);
  const scored: { ref: BasisRef; score: number }[] = [];
  for (const law of Array.from(laws.values())) {
    for (const art of law.articles) {
      const key = `${law.id}:${art.no}`;
      if (exclude.has(key)) continue;
      const terms = [art.title, ...(art.keywords ?? [])].map(squash).filter((t) => t.length >= 2);
      const score = terms.reduce((n, t) => n + (text.includes(t) ? (t === squash(art.title) ? 2 : 1) : 0), 0);
      if (score >= 2) scored.push({ ref: { lawId: law.id, articleNo: art.no }, score });
    }
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, 3).map((x) => x.ref);
}

const RANK: Record<Severity, number> = { conflict: 3, review: 2, ok: 1, info: 0 };

/** 교차 검증 실행 */
export function crossCheck(params: { text: string; orgType: OrgType; regName?: string; laws: LawDoc[] }): CheckReport {
  const lawMap = new Map(params.laws.map((l) => [l.id, l]));
  const articles = parseRegulation(params.text);
  let refsChecked = 0;
  const results: ArticleResult[] = articles.map((a) => {
    const refs = checkReferences(a, lawMap);
    refsChecked += refs.filter((f) => f.rule.startsWith("ref-") && f.rule !== "ref-external").length;
    const ruled = RULES.flatMap((r) => r({ a, org: params.orgType, doc: `${params.regName ?? ""}\n${params.text}` }));
    // 같은 규칙·같은 제목 중복 제거
    const seen = new Set<string>();
    const findings = [...ruled, ...refs].filter((f) => (seen.has(f.rule + f.title) ? false : (seen.add(f.rule + f.title), true)));
    const exclude = new Set(findings.flatMap((f) => f.basis.map((b) => `${b.lawId}:${b.articleNo}`)));
    const related = relatedArticles(a, lawMap, exclude);
    const worst = findings.reduce<Severity>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), findings.length || related.length ? "ok" : "info");
    findings.sort((x, y) => RANK[y.severity] - RANK[x.severity]);
    return { article: a, status: worst, findings, related };
  });
  const counts: Record<Severity, number> = { conflict: 0, review: 0, ok: 0, info: 0 };
  for (const r of results) counts[r.status]++;
  return { orgType: params.orgType, regName: params.regName?.trim() || "내부규정", results, counts, refsChecked, liveLaws: params.laws.filter((l) => l.source === "live").map((l) => l.id) };
}

/** 개정안: 수치 위반 자동 수정 제안을 모두 반영한 조문 */
export function amendedText(r: ArticleResult): string | null {
  const fixes = r.findings.map((f) => f.fix).filter((x): x is NonNullable<Finding["fix"]> => !!x);
  if (!fixes.length) return null;
  return fixes.reduce((t, f) => t.replace(f.before, f.after), r.article.text);
}

/** 검토 보고서(보고서체) */
export function complianceReport(rep: CheckReport, lawName: (id: string) => string, date = new Date()): string {
  const ymd = `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
  const GA = "가나다라마바사아자차카타파하";
  const flagged = rep.results.filter((r) => r.status === "conflict" || r.status === "review");
  const ref = (b: BasisRef) => `「${lawName(b.lawId)}」 ${articleLabel(b.articleNo)}`;
  const lines = [
    `「${rep.regName}」 상위법령 교차 검증 결과 보고`,
    "",
    `${ymd}  (기관 유형: ${rep.orgType})`,
    "",
    "1. 검증 개요",
    `  가. 대상: 「${rep.regName}」 ${rep.results.length}개 조문`,
    `  나. 대조 법령: ${TARGET_LAWS.map((l) => `「${l.name}」`).join(", ")}`,
    `  다. 결과: 상충 ${rep.counts.conflict}건, 검토 필요 ${rep.counts.review}건, 적합 ${rep.counts.ok}건, 참고 ${rep.counts.info}건 (인용 조문 검증 ${rep.refsChecked}건)`,
    "",
    "2. 조문별 검토 내용",
  ];
  if (!flagged.length) lines.push("  가. 상충 또는 검토가 필요한 조문이 발견되지 않음");
  flagged.forEach((r, i) => {
    lines.push(`  ${GA[i % GA.length]}. ${regArticleLabel(r.article)} — ${SEVERITY_LABEL[r.status]}`);
    r.findings
      .filter((f) => f.severity === "conflict" || f.severity === "review")
      .forEach((f, j) => {
        lines.push(`    ${j + 1}) ${f.title}`);
        lines.push(`       - 근거: ${f.basis.length ? f.basis.map(ref).join(", ") : "법률유보 원칙(일반 원칙)"}`);
        lines.push(`       - 내용: ${f.detail}`);
      });
    const am = amendedText(r);
    if (am) lines.push(`    ※ 개정안: ${am.replace(/\n/g, " ")}`);
  });
  lines.push("", "3. 조치 계획(안)", "  가. 상충 조문은 상위법령 기준에 맞게 개정 추진(규정 제·개정 절차 이행)", "  나. 검토 필요 조문은 소관 부서 확인 후 개정 여부 결정", "  다. 근로조건 관련 개정 시 근로자 과반수 의견청취(불이익 변경 시 동의) 절차 이행");
  lines.push("", "※ 이 결과는 규칙 기반 대조이며, 최종 판단은 국가법령정보센터 현행 원문과 소관 부처 해석을 확인하여 결정함.  끝.");
  return lines.join("\n");
}

/** 시연용 예시 규정(의도적으로 상위법과 어긋난 조항 포함) */
export const SAMPLE_REGULATIONS: { label: string; orgType: OrgType; name: string; text: string }[] = [
  {
    label: "○○도시공사 취업규칙",
    orgType: "지방공기업",
    name: "○○도시공사 취업규칙",
    text: `제1조(목적) 이 규칙은 ○○도시공사 직원의 근로조건과 복무에 관한 사항을 정함을 목적으로 한다.
제2조(다른 법령과의 관계) 이 규칙은 근로조건에 관하여 법령에 우선하여 적용한다.
제10조(근로시간) ① 직원의 1일 근로시간은 휴게시간을 제외하고 8시간으로 하며, 1주 44시간으로 한다.
② 휴게시간은 근로시간 4시간마다 20분을 부여한다.
제11조(연장근로) 사장은 업무상 필요한 경우 직원과 합의하여 1주 15시간 이내에서 연장근로를 시킬 수 있다.
제12조(시간외근무수당) 연장근로와 야간근로에 대하여는 통상임금의 100분의 30을 가산하여 지급한다.
제15조(연차휴가) 1년간 80퍼센트 이상 출근한 직원에게는 12일의 유급휴가를 준다.
제20조(퇴직금품 지급) 직원이 퇴직한 경우 공사는 30일 이내에 임금과 그 밖의 금품을 지급한다.
제25조(해고의 예고) 공사는 직원을 해고하려면 적어도 15일 전에 예고하여야 한다.
제30조(규칙의 개정) 이 규칙의 개정은 이사회의 의결을 거쳐 사장이 정한다.
제31조(관계 법령) 이 규칙에서 정하지 아니한 사항은 「근로기준법」 제93조 및 「근로기준법」 제150조에 따른다.`,
  },
  {
    label: "○○공사 임직원 행동강령",
    orgType: "공기업·준정부기관",
    name: "○○공사 임직원 행동강령",
    text: `제1조(목적) 이 강령은 「부정청탁 및 금품등 수수의 금지에 관한 법률」 제8조에 따라 임직원이 지켜야 할 행동기준을 정함을 목적으로 한다.
제5조(부정청탁의 신고) 임직원은 부정청탁을 받은 경우 감사실에 신고하여야 한다.
제8조(금품등의 수수) ① 임직원은 직무관련자로부터 1회 10만원 이하의 선물은 받을 수 있다.
② 임직원은 동일인으로부터 연간 500만원 이내의 경조사비를 받을 수 있다.
제10조(외부강의) 임직원이 사례금을 받는 외부강의를 한 경우에는 마친 날부터 30일 이내에 기관장에게 신고하여야 한다.
제12조(정치적 중립) 임직원은 근무시간 외에는 특정 후보자를 위한 선거운동에 참여할 수 있다.
제13조(홍보) 공사는 사업 성과를 알리기 위하여 연중 홍보물을 발행하고 기공식 등 행사 개최를 할 수 있다.
제20조(제재) 이 강령을 위반한 자는 100만원 이하의 과태료를 부과한다.`,
  },
  {
    label: "○○시설관리공단 공유재산 관리규정",
    orgType: "지방공기업",
    name: "○○시설관리공단 공유재산 관리 위탁 규정",
    text: `제1조(목적) 이 규정은 ○○시로부터 관리를 위탁받은 공유재산의 사용허가와 대부에 관한 사항을 정한다.
제5조(사용허가) ① 이사장은 행정재산의 목적 또는 용도에 장애가 되지 아니하는 범위에서 수의의 방법으로 사용허가를 할 수 있다.
② 사용허가를 받은 자는 이사장의 승인 없이도 다른 자에게 전대할 수 있다.
제6조(사용허가기간) 사용허가기간은 10년으로 하며, 기간이 끝나면 자동으로 연장된다.
제10조(대부기간) 토지와 건물의 대부기간은 7년 이내로 한다.
제15조(임원) 이사장의 임기는 2년으로 하며, 2년 단위로 연임할 수 있다.
제16조(임원의 임명) 상임이사는 이사장이 임명한다.
제20조(근거) 이 규정은 「공유재산 및 물품 관리법」 제21조 및 「공유재산 및 물품 관리법」 제31조를 따른다.`,
  },
];
