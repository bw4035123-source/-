/**
 * 규정 제정 지원 — 순수 함수(브라우저 전용 화면에서 사용, 단위 테스트 대상)
 *  - 제정 목적·상위법 위임 조항·담을 내용 → 조문 체계와 표준 조문 초안(목적·정의·적용 범위·다른 법령과의 관계·실체 조문·세부 사항 위임·부칙)
 *  - 상위법 조문에서 이 규범으로 위임한 사항을 찾아 조문으로 배정하고, 빠진 위임 사항·위임 없이 의무를 부과하는 표현을 점검
 *  - 제정이유·입법예고문·절차 체크리스트 초안
 * 생성형 AI 없이 법제 표준 문형으로 조립하며, ○○ 표시는 담당자가 채울 자리다.
 */
import { procedureChecklist, type Check, type DraftKind } from "./drafting";

export interface Basis {
  /** 「법령명」 제N조(제목) */
  label: string;
  text: string;
}

export interface EnactInput {
  kind: DraftKind;
  name: string;
  purpose: string;
  /** 담을 내용(한 줄에 하나) — 비우면 위임 사항으로 조문을 만든다 */
  items: string[];
  /** 정의할 용어 */
  terms: string[];
  basis: Basis[];
  /** 기관명(예: ○○공단) */
  org?: string;
  dept?: string;
  effectiveDays?: number;
}

export interface EnactArticle {
  label: string;
  text: string;
}

export interface Delegation {
  basis: string;
  matter: string;
  covered: boolean;
}

export interface EnactDraft {
  unit: string;
  articles: EnactArticle[];
  addenda: string;
  fullText: string;
  delegated: Delegation[];
  limits: string[];
  reason: string;
  notice: string;
  steps: string[];
  checks: Check[];
}

/** 받침이 있으면 a, 없으면 b(한글이 아니면 a(b)) */
function josa(word: string, a: string, b: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return `${a}(${b})`;
  return c % 28 ? a : b;
}
const eun = (w: string) => w + josa(w, "은", "는");
const iga = (w: string) => w + josa(w, "이", "가");

/** 규범을 스스로 부르는 말(이 규정·이 조례·이 지침…) */
export function unitOf(kind: DraftKind, name: string): string {
  if (kind === "법령") return /시행령$/.test(name) ? "영" : /시행규칙$/.test(name) ? "규칙" : "법";
  if (kind === "자치법규") return /규칙$/.test(name.trim()) ? "규칙" : "조례";
  const m = name.trim().match(/(지침|예규|훈령|요령|기준|세칙|규칙|규정)$/);
  return m ? m[1] : "규정";
}

/** 이 규범 종류로 위임할 때 상위 조문에 쓰이는 말 */
const TARGET: Record<DraftKind, RegExp> = {
  법령: /(대통령령|총리령|[가-힣]+부령)/,
  자치법규: /(조례|규칙)/,
  행정규칙: /(정관|내부\s?규정|훈령|예규|지침|규정)/,
};

/** 상위 조문에서 이 규범 종류로 위임한 사항 — "○○에 필요한 사항은 조례로 정한다", "조례로 정하는 ○○" */
export function delegatedMatters(text: string, kind: DraftKind): string[] {
  const out: string[] = [];
  const target = TARGET[kind].source;
  const clean = (s: string) =>
    s
      .replace(/^[\s①-⑳\d.]+/, "")
      .replace(/^(그\s?밖에|그\s?밖의|이\s?법에서\s?정한\s?것\s?외에|제\d+항(?:부터\s?제\d+항까지)?에\s?따른)\s*/, "")
      .replace(/(에\s?관하여|에\s?관한|에\s?대하여|등|에)\s*$/, "")
      .trim();
  for (const m of Array.from(text.matchAll(new RegExp(`([^.\\n]{2,70}?)\\s*(?:에\\s?관하여\\s?)?필요한\\s?사항은\\s?${target}(?:으로|로)\\s?정한다`, "g")))) out.push(clean(m[1]));
  for (const m of Array.from(text.matchAll(new RegExp(`${target}(?:으로|로)\\s?정하는\\s?(?:바에\\s?따라\\s?)?([가-힣ㆍ·\\s]{2,24}?)(?=[을를이가은는의에,.)]|\\s(?:등|및))`, "g")))) {
    const w = clean(m[2]);
    if (w && !/^바에/.test(w)) out.push(w);
  }
  return Array.from(new Set(out.filter((x) => x.length >= 2))).map((x) => (x.length > 40 ? `${x.slice(0, 40)}…` : x));
}

const STOP = new Set(["사항", "필요한", "관한", "관하여", "그", "밖에", "등", "및", "또는", "경우", "방법", "절차", "기준", "운영", "시행"]);
const words = (s: string) => s.split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));

/** 기관의 장 표현 */
function headOf(input: EnactInput): string {
  const org = input.org?.trim();
  if (input.kind === "자치법규") return org ? `${org}장` : "○○시장";
  return org ? `${org}의 장` : "기관의 장";
}

/** 담을 내용 한 줄 → 표준 조문 본문(키워드별 법제 문형, ○○는 채울 자리) */
function articleBody(item: string, head: string, basis: Basis[]): string {
  const H = eun(head);
  const Hi = iga(head);
  if (/위원회|심의/.test(item))
    return `① ○○에 관한 사항을 심의하기 위하여 ○○위원회(이하 “위원회”라 한다)를 둔다.\n② 위원회는 위원장 1명을 포함하여 ○명 이내의 위원으로 구성한다.\n③ 위원회의 구성과 운영에 필요한 사항은 ${Hi} 정한다.`;
  if (/신청|접수|신고/.test(item)) {
    const act = /신고/.test(item) ? "신고" : "신청";
    return `① ○○을(를) 하려는 사람은 ○○ 서식에 따라 ${head}에게 ${act}하여야 한다.\n② ${H} 제1항에 따른 ${act}${josa(act, "을", "를")} 받은 날부터 ○일 이내에 처리 결과를 ${act}인에게 알려야 한다.`;
  }
  if (/반환|환수|회수/.test(item)) return `① ○○을(를) 받은 사람은 그 사실을 안 날부터 ○일 이내에 ${head}에게 신고하고 반환하여야 한다.\n② ${H} 반환받은 ○○을(를) 기록·관리하여야 한다.`;
  if (/상한|한도|금액|요율|기준액/.test(item))
    return `① ○○의 상한은 ○○으로 한다.${basis.length ? `\n② 제1항의 기준은 ${basis[0].label.replace(/\(.*\)$/, "")}에서 정한 기준을 넘을 수 없다.` : ""}`;
  if (/승인|허가|결정|선정/.test(item)) return `① ${H} ○○의 요건을 갖춘 경우 ○○을(를) 승인할 수 있다.\n② ${H} 승인하지 아니하는 경우 그 사유를 신청인에게 알려야 한다.`;
  if (/취소|중지|제한|정지|징계|제재/.test(item))
    return `① ${H} 다음 각 호의 어느 하나에 해당하는 경우 ○○을(를) 취소하거나 중지할 수 있다.\n  1. 거짓이나 그 밖의 부정한 방법으로 ○○을(를) 받은 경우\n  2. ○○\n② ${H} 제1항에 따라 취소하려는 경우 미리 당사자에게 의견을 제출할 기회를 주어야 한다.`;
  if (/지원|보조|수당|비용|경비|보수/.test(item)) return `① ${H} 예산의 범위에서 ○○에 드는 비용의 전부 또는 일부를 지원할 수 있다.\n② 제1항에 따른 지원의 대상·기준 및 절차는 ${Hi} 정한다.`;
  if (/기간|시간|근무|일정/.test(item)) return `① ○○의 기간(시간)은 ○○ 이내로 한다.\n② ${H} 업무상 필요한 경우 제1항의 기간(시간)을 조정할 수 있다.`;
  if (/보안|비밀|정보|개인정보/.test(item)) return `① ○○에 종사하는 사람은 직무상 알게 된 정보를 누설하거나 다른 목적으로 사용해서는 아니 된다.\n② ${H} 정보 보호를 위하여 필요한 조치를 하여야 한다.`;
  if (/점검|평가|보고|감독|관리/.test(item)) return `① ${H} ○○의 운영 실태를 연 ○회 이상 점검하여야 한다.\n② ${H} 점검 결과 필요한 경우 시정을 요구할 수 있다.`;
  if (/교육|홍보/.test(item)) return `${H} ○○에 관한 교육을 연 ○회 이상 실시하여야 한다.`;
  return `① ${H} ${item}에 관한 기준을 정하여 운영하여야 한다.\n② 제1항에 따른 세부 사항은 ${Hi} 따로 정한다.`;
}

/** 제정 목적 문장 → '○○에 관한' 앞에 들어갈 명사구 */
function purposeCore(purpose: string): string {
  return purpose
    .trim()
    .replace(/[.。]$/, "")
    .replace(/(을|를)?\s*(정하기|정하려고|정하고자|규정하기)\s*(위함|위하여|위해|함)?$/, "")
    .replace(/\s*(하기\s?위함|하기\s?위하여|하려는\s?것임|하고자\s?함|위함|함)$/, "")
    .replace(/\s*(기준|사항|방법|절차)$/, "")
    .trim();
}

const lawNameOf = (label: string) => label.match(/「([^」]+)」/)?.[1] ?? "";

export function enactDraft(input: EnactInput): EnactDraft {
  const unit = unitOf(input.kind, input.name);
  const self = `이 ${unit}`;
  const head = headOf(input);
  const basis = input.basis.filter((b) => b.label.trim());
  const refs = basis.map((b) => b.label.replace(/\(.*\)$/, "").trim());
  const lawNames = Array.from(new Set(basis.map((b) => lawNameOf(b.label)).filter(Boolean)));
  const core = purposeCore(input.purpose) || "○○";

  // 위임 사항: 상위 조문에서 이 규범 종류로 위임한 것
  const delegatedRaw = basis.flatMap((b) => delegatedMatters(b.text, input.kind).map((matter) => ({ basis: b.label.replace(/\(.*\)$/, ""), matter })));
  const items = input.items.map((x) => x.trim()).filter(Boolean);
  // 담을 내용을 비우면 위임 사항을 그대로 조문으로
  const bodyItems = items.length ? items : delegatedRaw.map((d) => d.matter.replace(/…$/, ""));

  const arts: { title: string; text: string }[] = [];
  arts.push({ title: "목적", text: `${eun(self)} ${refs.length ? `${refs.join("·")}에 따라 ` : ""}${core}에 관한 사항을 정함을 목적으로 한다.` });
  const terms = input.terms.map((t) => t.trim()).filter(Boolean);
  if (terms.length)
    arts.push({ title: "정의", text: `${self}에서 사용하는 용어의 뜻은 다음과 같다.\n${terms.map((t, i) => `  ${i + 1}. “${t}”${josa(t, "이란", "란")} ○○을(를) 말한다.`).join("\n")}` });
  arts.push({ title: "적용 범위", text: `${eun(self)} ${input.org?.trim() ? `${input.org.trim()} 소속` : "○○ 소속"} ○○에 대하여 적용한다.` });
  if (lawNames.length) arts.push({ title: "다른 법령과의 관계", text: `${self}에서 정하지 아니한 사항은 ${lawNames.map((n) => `「${n}」`).join(" 및 ")} 등 관계 법령에서 정하는 바에 따른다.` });
  for (const it of bodyItems) arts.push({ title: it.length > 20 ? `${it.slice(0, 20)}…` : it, text: articleBody(it, head, basis) });
  arts.push({
    title: "세부 사항",
    text: input.kind === "자치법규" && unit === "조례" ? `${self}의 시행에 필요한 사항은 규칙으로 정한다.` : `${self}의 시행에 필요한 세부 사항은 ${iga(head)} 따로 정한다.`,
  });
  const articles = arts.map((a, i) => ({ label: `제${i + 1}조(${a.title})`, text: a.text }));

  const days = input.effectiveDays ?? 0;
  const addenda = `부      칙\n${eun(self)} ${days > 0 ? `공포 후 ${days}일이 경과한 날부터` : input.kind === "행정규칙" ? "발령한 날부터" : "공포한 날부터"} 시행한다.`;
  const fullText = [input.name.trim() || `(${unit} 이름)`, "", ...articles.map((a) => `${a.label} ${a.text}`), "", addenda].join("\n");

  // 위임 사항이 조문으로 정해졌는지(제목·본문 낱말 대조)
  const bodyText = arts.map((a) => `${a.title} ${a.text}`).join(" ");
  const delegated = delegatedRaw.map((d) => ({ ...d, covered: words(d.matter).some((w) => bodyText.includes(w)) }));
  // 상위 조문의 기한·금액 기준(초안 수치를 맞출 때 참고)
  const limits = Array.from(new Set(basis.flatMap((b) => Array.from(b.text.matchAll(/(\d[\d,.]*)\s*(일|개월|년|만원|원|퍼센트|%)\s*(이내|이하|미만|이상|까지|를 넘지|을 넘지|초과하지)/g), (m) => `${b.label.replace(/\(.*\)$/, "")}: ${m[0]}`))));

  const checks: Check[] = [];
  if (!input.purpose.trim()) checks.push({ level: "info", title: "제정 목적", detail: "제정 목적을 적으면 제1조(목적)와 제정이유가 그 내용으로 채워집니다." });
  const missing = delegated.filter((d) => !d.covered);
  if (missing.length) checks.push({ level: "warn", title: "위임 사항 누락 가능", detail: `상위 조문이 이 ${unit}에 맡긴 사항 중 조문으로 정하지 않은 것: ${missing.map((d) => `‘${d.matter}’(${d.basis})`).join(", ")}` });
  if (basis.length && !delegatedRaw.length)
    checks.push({ level: "info", title: "위임 근거", detail: `근거 조문에서 ${input.kind === "자치법규" ? "조례·규칙" : input.kind === "법령" ? "하위 법령" : "내부 규정"}으로 위임한 문구를 찾지 못했습니다. 위임 규범이 아니라 관련 근거라면 목적 조문의 '따라' 표현을 확인하세요.` });
  if (!basis.length && input.kind === "자치법규") checks.push({ level: "info", title: "위임 근거", detail: "법령의 위임 조례인지, 자치사무에 관한 조례인지 확인하고 근거 조문을 넣으세요." });
  const burden = /(과태료|벌금|벌칙|징역|부과|금지|의무)/;
  const all = `${input.purpose} ${items.join(" ")}`;
  if (burden.test(all)) {
    if (input.kind === "자치법규" && !delegatedRaw.length)
      checks.push({ level: "warn", title: "법률 위임 필요", detail: "주민의 권리 제한·의무 부과·벌칙은 법률의 위임이 있어야 조례로 정할 수 있습니다(「지방자치법」 제28조). 위임 근거 조문을 확인하세요." });
    if (input.kind === "행정규칙") checks.push({ level: "warn", title: "대외적 구속력 검토", detail: "행정규칙(내부 규정)으로는 법령의 위임 없이 국민의 권리를 제한하거나 의무를 부과할 수 없습니다. 내부 직원 대상인지, 위임 근거가 있는지 확인하세요." });
  }
  const blanks = (fullText.match(/○○|○일|○명|○회/g) ?? []).length;
  if (blanks) checks.push({ level: "info", title: "채울 자리", detail: `초안의 ○○ 표시 ${blanks}곳에 기관 실정에 맞는 내용(대상·기한·서식 등)을 채우세요.` });
  if (!checks.some((c) => c.level === "warn")) checks.push({ level: "ok", title: "자동 점검 이상 없음", detail: "자동으로 찾을 수 있는 문제는 없습니다. 법제 심사 기준과 관계 부서 의견에 따라 최종 검토하세요." });

  const reason = [
    "◇ 제정이유",
    `  ${core !== "○○" ? `${core}에 관한 기준을 마련하고, ` : ""}${refs.length ? `${refs.join("·")}에서 정한 사항과 ` : ""}그 시행에 필요한 사항을 정하려는 것임.`,
    "",
    "◇ 주요내용",
    ...articles
      .slice(1, -1)
      .filter((a) => !/(정의|적용 범위|다른 법령과의 관계)\)$/.test(a.label))
      .map((a, i) => `  ${"가나다라마바사아자차카타파하"[i] ?? "-"}. ${a.label.replace(/^제\d+조\((.*)\)$/, "$1")}에 관한 사항을 정함(${a.label.replace(/\(.*\)$/, "")}).`),
  ].join("\n");

  const what = input.kind === "자치법규" ? `${unit} 제정안` : input.kind === "행정규칙" ? `${unit} 제정안` : "제정법률안";
  const notice = [
    `${input.dept?.trim() || "○○○"} 공고 제${new Date().getFullYear()}-○○호`,
    "",
    `「${input.name.trim() || "○○"}」 ${what} 입법예고`,
    "",
    `「${input.name.trim() || "○○"}」을(를) 제정함에 있어 그 취지와 주요 내용을 미리 알려 의견을 듣고자 「행정절차법」${input.kind === "자치법규" ? " 및 관련 조례" : ""}에 따라 다음과 같이 공고합니다.`,
    "",
    "1. 제정이유 및 주요내용",
    reason.replace(/^/gm, "  "),
    "",
    "2. 의견제출",
    "  이 제정안에 대하여 의견이 있는 기관·단체 또는 개인은 예고기간 내에 의견서를 제출하여 주시기 바랍니다.",
    "  가. 예고사항에 대한 의견(찬반 여부와 그 사유)",
    "  나. 성명(단체의 경우 단체명과 대표자명), 주소 및 전화번호",
    "  다. 제출처: (담당 부서·주소·전자우편)",
  ].join("\n");

  return { unit, articles, addenda, fullText, delegated, limits, reason, notice, steps: procedureChecklist(input.kind, "제정"), checks };
}
