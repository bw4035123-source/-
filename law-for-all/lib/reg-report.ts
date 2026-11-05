/**
 * 규정 업무 보고서 바로 만들기 — 자체규정 점검·개정·제정 결과를 결재용 보고서·기안문·붙임(표)으로 조립.
 * 생성형 문장을 새로 만들지 않고, 화면에서 이미 검증된 결과(판정·근거·신구대비·개정이유·절차)만 공문서 서식에 배치한다(순수 함수).
 */
import { diffWords, procedureChecklist, type DraftKind } from "./drafting";

export interface ReportProfile {
  dept?: string;
  author?: string;
  phone?: string;
  title?: string;
  date?: Date;
}
export interface RegDocs {
  title: string;
  report: string;
  draft: string;
  /** 붙임(Word에는 표로, 화면에는 미리보기) */
  attachments: { title: string; html: string }[];
}

const GA = "가나다라마바사아자차카타파하";
const ga = (i: number) => GA[i] ?? `${i + 1}`;
const ymd = (d: Date) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const br = (s: string) => esc(s).replace(/\n/g, "<br>");
const head = (title: string, o: ReportProfile) => [title, "", `${ymd(o.date ?? new Date())}  ${o.dept || "○○과"}${o.author ? ` (담당: ${o.author})` : ""}`, ""];
const sign = (o: ReportProfile) => `${o.dept || "○○과"}  담당 ${o.author || "○○○"}${o.phone ? `  (☎ ${o.phone})` : ""}`;
const EFFECT: Record<number, string> = { 0: "공포(발령)한 날부터 시행", 30: "공포(발령) 후 30일이 경과한 날부터 시행", 90: "공포(발령) 후 3개월이 경과한 날부터 시행", 180: "공포(발령) 후 6개월이 경과한 날부터 시행" };

/** 신·구조문대비표(Word·붙임용): 바뀐 말은 현행 취소선, 개정안 밑줄·굵게 */
export function oldNewTableHtml(rows: { label: string; current: string; amended: string }[]): string {
  const cell = (parts: { text: string; op: string }[], side: "old" | "new") =>
    parts.map((p) => (p.op === "same" ? br(p.text) : side === "new" ? `<u><b>${br(p.text)}</b></u>` : `<s>${br(p.text)}</s>`)).join("");
  const body = rows
    .map((r) => {
      const d = diffWords(r.current, r.amended);
      const h = r.label ? `${esc(r.label)}<br>` : "";
      return `<tr><td valign="top">${h}${cell(d.old, "old")}</td><td valign="top">${h}${cell(d.new, "new")}</td></tr>`;
    })
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="6"><tr><th width="50%">현 행</th><th width="50%">개 정 안</th></tr>${body}</table>`;
}

/** reasonDraft·enact 의 '◇ 개정(제정)이유 / ◇ 주요내용' 글을 두 부분으로 */
export function splitReason(text: string): { why: string[]; main: string[] } {
  const [a, b = ""] = text.split(/◇\s*주요\s*내용/);
  const lines = (s: string) =>
    s
      .replace(/◇\s*(?:개정|제정)\s*이유/, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  return { why: lines(a), main: lines(b).map((l) => l.replace(/^[가-하]\.\s*/, "")) };
}

// ─────────────────────────────── 1) 자체규정 점검 결과 보고
export type Verdict = "상충" | "검토 필요" | "적합" | "판단 보류";
export interface CheckItem {
  label: string; // 제3조(근무시간)
  verdict: Verdict;
  /** 지적 사항(근거 포함 한 줄씩) */
  points: string[];
  current?: string;
  /** 자동 개정안(있을 때만 신·구조문대비표에) */
  amended?: string;
}
export interface CheckInput {
  regName: string;
  orgType: string;
  kind?: DraftKind;
  items: CheckItem[];
  /** 대조한 상위 법령 이름 */
  laws: string[];
  /** AI 검토에 쓴 모델 이름(없으면 규칙 점검만) */
  aiLabel?: string;
}

export function complianceDocs(x: CheckInput, o: ReportProfile = {}): RegDocs {
  const title = o.title || `「${x.regName}」 상위법령 정합성 점검 결과 보고`;
  const cnt = (v: Verdict) => x.items.filter((i) => i.verdict === v).length;
  const need = x.items.filter((i) => i.verdict === "상충" || i.verdict === "검토 필요");
  const fix = x.items.filter((i) => i.amended && i.current && i.amended !== i.current);
  const laws = x.laws.slice(0, 6).map((l) => `「${l}」`).join(", ") + (x.laws.length > 6 ? ` 등 ${x.laws.length}개 법령` : "");
  const steps = procedureChecklist(x.kind ?? (x.orgType.includes("지방자치단체") ? "자치법규" : "행정규칙"), "개정").slice(1);
  const report = [
    ...head(title, o),
    "1. 점검 개요",
    `  가. 점검 대상: 「${x.regName}」(${x.orgType}) 총 ${x.items.length}개 조문`,
    `  나. 점검 기준: 국가법령정보센터 현행 법령 원문${laws ? `(${laws})` : ""}`,
    `  다. 점검 방법: 조문별 상위 조문 대조${x.aiLabel ? `(생성형 AI 검토 + 법정 기준 규칙 점검, 근거·수치 자동 검증)` : "(법정 기준 규칙 점검)"}, 인용 조문 현행 여부 확인`,
    "",
    "2. 점검 결과 요약",
    `  가. 상충 ${cnt("상충")}건, 검토 필요 ${cnt("검토 필요")}건, 적합 ${cnt("적합")}건, 판단 보류 ${cnt("판단 보류")}건`,
    `  나. 정비 필요 조문: ${need.length ? need.map((i) => i.label).join(", ") : "없음"}`,
    "",
    "3. 주요 지적 사항",
    ...(need.length
      ? need.flatMap((i, k) => [`  ${ga(k)}. ${i.label} — ${i.verdict}`, ...(i.points.length ? i.points : ["상위 조문과 문구·기준 확인 필요"]).map((p) => `     ○ ${p}`)])
      : ["  가. 상위법령과 상충하거나 검토가 필요한 조문 없음"]),
    "",
    "4. 개선 계획(안)",
    ...(need.length
      ? [
          `  가. 상충 조문 ${cnt("상충")}개: 상위법령 기준에 맞게 개정${fix.length ? `(자동 개정안 ${fix.length}개 조문, 붙임 신·구조문대비표)` : ""}`,
          `  나. 검토 필요 조문 ${cnt("검토 필요")}개: 소관 부서 검토 후 개정 여부 결정`,
          `  다. 추진 절차: ${steps.join(" → ")}`,
        ]
      : ["  가. 현행 유지, 상위법령 개정 시 재점검"]),
    "",
    "5. 행정사항",
    "  가. 본 점검 결과는 자동 점검에 따른 참고 의견으로, 최종 판단은 소관 부처 유권해석 및 법무 검토를 거쳐 확정",
    "  나. 상위법령 개정 시(국가법령정보 신구법 비교) 해당 조문 재점검",
    "",
    `붙임  1. 조문별 점검 결과 1부.${fix.length ? "\n      2. 신·구조문대비표 1부." : ""}  끝.`,
  ].join("\n");
  const draft = [
    "수신  내부결재",
    "(경유)",
    `제목  ${title}`,
    "",
    `1. 「${x.regName}」의 상위법령 정합성을 점검한 결과를 다음과 같이 보고합니다.`,
    `  가. 점검 대상: ${x.items.length}개 조문`,
    `  나. 점검 결과: 상충 ${cnt("상충")}건, 검토 필요 ${cnt("검토 필요")}건, 적합 ${cnt("적합")}건, 판단 보류 ${cnt("판단 보류")}건`,
    `  다. 조치 계획: ${need.length ? "정비 필요 조문은 개정안을 마련하여 관계 부서 협의 및 규정 개정 절차 추진" : "현행 유지"}`,
    "",
    "붙임  1. 상위법령 정합성 점검 결과 보고 1부.",
    `      2. 조문별 점검 결과 1부.${fix.length ? "\n      3. 신·구조문대비표 1부." : ""}  끝.`,
    "",
    sign(o),
  ].join("\n");
  const table = `<table border="1" cellspacing="0" cellpadding="6"><tr><th width="22%">조문</th><th width="12%">판정</th><th>지적 사항·근거</th></tr>${x.items
    .map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.verdict)}</td><td>${i.points.length ? i.points.map(br).join("<br>") : "—"}</td></tr>`)
    .join("")}</table>`;
  const attachments = [{ title: "붙임 1. 조문별 점검 결과", html: table }];
  if (fix.length) attachments.push({ title: "붙임 2. 신·구조문대비표", html: oldNewTableHtml(fix.map((i) => ({ label: i.label, current: i.current!, amended: i.amended! }))) });
  return { title, report, draft, attachments };
}

// ─────────────────────────────── 2) 개정(안) 보고
export interface AmendInput {
  lawName: string;
  kind: DraftKind;
  label: string;
  current: string;
  amended: string;
  /** reasonDraft 결과(◇ 개정이유 / ◇ 주요내용) */
  reason: string;
  addenda: string;
  checks: { level: string; title: string; detail: string }[];
  effectiveDays: number;
  upperBasis?: string;
}

export function amendDocs(x: AmendInput, o: ReportProfile = {}): RegDocs {
  const name = x.lawName && x.lawName !== "(규정명)" ? x.lawName : "○○ 규정";
  const title = o.title || `「${name}」 일부개정(안) 보고`;
  const r = splitReason(x.reason.replace(/「\(규정명\)」/g, `「${name}」`));
  const warns = x.checks.filter((c) => c.level === "warn");
  const steps = procedureChecklist(x.kind, "개정");
  const full = `${x.label ? `${x.label} ` : ""}${x.amended}`;
  const report = [
    ...head(title, o),
    "1. 개정 개요",
    `  가. 개정 대상: 「${name}」 ${x.label || ""}`.trimEnd(),
    `  나. 개정 사유: ${r.why.join(" ") || "조문 정비"}`,
    ...(x.upperBasis ? [`  다. 관련 근거: ${x.upperBasis}`] : []),
    "",
    "2. 주요 개정 내용",
    ...(r.main.length ? r.main.map((m, i) => `  ${ga(i)}. ${m}`) : ["  가. 붙임 신·구조문대비표 참조"]),
    "",
    "3. 정합성 점검 결과",
    ...(warns.length ? warns.map((c, i) => `  ${ga(i)}. ${c.title}: ${c.detail}`) : ["  가. 자동 점검 결과 특이사항 없음(항 번호 체계·인용 조문·수치 변경 확인)"]),
    "",
    "4. 시행 및 경과조치",
    `  가. 시행: ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "  나. 경과조치: 부칙(붙임) 참조",
    "",
    "5. 추진 절차(안)",
    ...steps.map((s, i) => `  ${ga(i)}. ${s}`),
    "",
    "붙임  1. 신·구조문대비표 1부.",
    "      2. 개정문 및 부칙 1부.  끝.",
  ].join("\n");
  const draft = [
    "수신  내부결재",
    "(경유)",
    `제목  ${title}`,
    "",
    `1. 「${name}」 ${x.label || ""}을(를) 다음과 같이 개정하고자 합니다.`.replace(/\s+을\(를\)/, "을(를)"),
    `  가. 개정 사유: ${r.why.join(" ") || "조문 정비"}`,
    `  나. 주요 내용: ${r.main.join(" / ") || "붙임 참조"}`,
    `  다. 시행: ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "",
    "2. 향후 관계 부서 협의 및 입법예고 등 개정 절차를 추진하겠습니다.",
    "",
    "붙임  1. 일부개정(안) 보고 1부.",
    "      2. 신·구조문대비표 1부.  끝.",
    "",
    sign(o),
  ].join("\n");
  return {
    title,
    report,
    draft,
    attachments: [
      { title: "붙임 1. 신·구조문대비표", html: oldNewTableHtml([{ label: x.label, current: x.current, amended: x.amended }]) },
      { title: "붙임 2. 개정문 및 부칙", html: `<p>${br(`「${name}」 일부를 다음과 같이 개정한다.\n\n${full}`)}</p><p>${br(x.addenda)}</p>` },
    ],
  };
}

// ─────────────────────────────── 3) 제정(안) 보고
export interface EnactInput {
  name: string;
  kind: DraftKind;
  fullText: string;
  /** ◇ 제정이유 / ◇ 주요내용 */
  reason: string;
  basis: string[];
  effectiveDays: number;
  org?: string;
}

export function enactDocs(x: EnactInput, o: ReportProfile = {}): RegDocs {
  const name = x.name.trim() || "○○ 규정";
  const title = o.title || `「${name}」 제정(안) 보고`;
  const r = splitReason(x.reason);
  const heads = Array.from(x.fullText.matchAll(/^제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)/gm)).map((m) => m[0].replace(/\s/g, ""));
  const steps = procedureChecklist(x.kind, "제정");
  const report = [
    ...head(title, o),
    "1. 제정 개요",
    `  가. 제정 사유: ${r.why.join(" ") || "관련 업무 기준 마련"}`,
    `  나. 상위법령 근거: ${x.basis.length ? x.basis.join(", ") : "자체 규정(위임 근거 확인 필요)"}`,
    "",
    "2. 주요 내용",
    ...(r.main.length ? r.main.map((m, i) => `  ${ga(i)}. ${m}`) : ["  가. 붙임 제정안 참조"]),
    "",
    `3. 조문 구성(총 ${heads.length}개 조)`,
    ...(heads.length ? [`  ${heads.join(", ")}`] : ["  붙임 제정안 참조"]),
    "",
    "4. 시행",
    `  가. ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "",
    "5. 추진 절차(안)",
    ...steps.map((s, i) => `  ${ga(i)}. ${s}`),
    "",
    "붙임  제정안 전문 1부.  끝.",
  ].join("\n");
  const draft = [
    "수신  내부결재",
    "(경유)",
    `제목  ${title}`,
    "",
    `1. ${x.org ? `${x.org} ` : ""}「${name}」을(를) 다음과 같이 제정하고자 합니다.`,
    `  가. 제정 사유: ${r.why.join(" ") || "관련 업무 기준 마련"}`,
    `  나. 주요 내용: ${r.main.join(" / ") || "붙임 참조"}`,
    `  다. 시행: ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "",
    "2. 향후 관계 부서 협의 및 입법예고 등 제정 절차를 추진하겠습니다.",
    "",
    "붙임  1. 제정(안) 보고 1부.",
    "      2. 제정안 전문 1부.  끝.",
    "",
    sign(o),
  ].join("\n");
  return { title, report, draft, attachments: [{ title: "붙임. 제정안 전문", html: `<p>${br(x.fullText)}</p>` }] };
}

// ─────────────────────────────── 4) 자체규정 점검 → 한 번에 개정: 일부개정(안) 보고(여러 조문)
/** 바뀐 내용 요약 — 수치(기간·금액·횟수·비율)는 ‘9시간’ → ‘8시간’처럼, 그 밖에는 단서·항 신설·문구 정비로 */
const QTY_RE = /\d+분의\s*\d+|\d+(?:\.\d+)?\s*(?:퍼센트|개월|시간|만원|천원|일|년|분|원|명|%|회|배)/g;
export function changeSummary(current: string, amended: string): string {
  const q = (t: string) => (t.match(QTY_RE) ?? []).map((x) => x.replace(/\s+/g, " "));
  const a = q(current);
  const b = q(amended);
  const removed = a.filter((x) => !b.includes(x));
  const added = b.filter((x) => !a.includes(x));
  const out: string[] = [];
  const n = Math.min(removed.length, added.length, 4);
  for (let i = 0; i < n; i++) out.push(`‘${removed[i]}’ → ‘${added[i]}’`);
  if (added.length > n) out.push(`${added.slice(n, n + 3).map((x) => `‘${x}’`).join("·")} 기준 추가`);
  if (removed.length > n) out.push(`${removed.slice(n, n + 3).map((x) => `‘${x}’`).join("·")} 삭제`);
  if (/다만[,，]/.test(amended) && !/다만[,，]/.test(current)) out.push("단서 신설");
  const paras = (t: string) => (t.match(/^[①-⑳]/gm) ?? []).length;
  if (paras(amended) > paras(current)) out.push("항 신설");
  if (current.replace(/\s/g, "") !== amended.replace(/\s/g, "") && (!out.length || diffWords(current, amended).new.filter((p) => p.op === "ins").length > n + 1)) out.push("문구 정비");
  return out.join(", ") || "문구 정비";
}

export interface BatchAmendItem {
  label: string;
  current: string;
  amended: string;
  verdict: Verdict;
  /** 근거 상위 조문(「법」 제N조) */
  basis: string[];
}
export interface BatchAmendInput {
  regName: string;
  kind: DraftKind;
  items: BatchAmendItem[];
  effectiveDays: number;
}

const ADDENDA = (days: number) =>
  ["부      칙", `이 규정은 ${days ? `공포(발령) 후 ${days === 90 ? "3개월" : days === 180 ? "6개월" : `${days}일`}이 경과한 날부터` : "공포(발령)한 날부터"} 시행한다.`].join("\n");

export function batchAmendDocs(x: BatchAmendInput, o: ReportProfile = {}): RegDocs {
  const title = o.title || `「${x.regName}」 일부개정(안) 보고`;
  const n = x.items.length;
  const conflict = x.items.filter((i) => i.verdict === "상충").length;
  const laws = Array.from(new Set(x.items.flatMap((i) => i.basis.map((b) => b.match(/「[^」]+」/)?.[0] ?? b)))).slice(0, 6);
  const basisAll = Array.from(new Set(x.items.flatMap((i) => i.basis)));
  const steps = procedureChecklist(x.kind, "개정");
  const report = [
    ...head(title, o),
    "1. 개정 개요",
    `  가. 개정 대상: 「${x.regName}」 ${n}개 조문(${x.items.map((i) => i.label.replace(/\(.*\)$/, "")).join(", ")})`,
    `  나. 개정 사유: 상위법령 정합성 점검 결과 상위법령과 상충${conflict ? ` ${conflict}건` : ""}·검토 필요${n - conflict ? ` ${n - conflict}건` : ""} 조문을 ${laws.join(", ") || "상위법령"} 기준에 맞게 정비하려는 것임`,
    "",
    "2. 주요 개정 내용",
    ...x.items.map((i, k) => `  ${ga(k)}. ${i.label}: ${changeSummary(i.current, i.amended)}${i.basis.length ? ` (근거: ${i.basis.slice(0, 2).join(", ")})` : ""}`),
    "",
    "3. 근거 상위법령",
    ...(basisAll.length ? basisAll.slice(0, 10).map((b, k) => `  ${ga(k)}. ${b}`) : ["  가. 점검 근거 상위 조문(붙임 참조)"]),
    "",
    "4. 시행 및 경과조치",
    `  가. 시행: ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "  나. 경과조치: 부칙(붙임) 참조",
    "",
    "5. 추진 절차(안)",
    ...steps.map((s, i) => `  ${ga(i)}. ${s}`),
    "",
    "6. 행정사항",
    "  가. 개정 조문은 자동 점검·생성형 AI 작성안(근거·수치 자동 검증)을 담당자가 확인·수정한 것으로, 관계 부서 협의와 법무 검토를 거쳐 확정",
    "",
    "붙임  1. 신·구조문대비표 1부.",
    "      2. 개정문 및 부칙 1부.  끝.",
  ].join("\n");
  const draft = [
    "수신  내부결재",
    "(경유)",
    `제목  ${title}`,
    "",
    `1. 상위법령 정합성 점검 결과에 따라 「${x.regName}」을(를) 다음과 같이 개정하고자 합니다.`,
    `  가. 개정 사유: 상위법령(${laws.join(", ") || "관계 법령"}) 기준에 맞게 ${n}개 조문 정비`,
    `  나. 주요 내용: ${x.items.map((i) => `${i.label.replace(/\(.*\)$/, "")} ${changeSummary(i.current, i.amended)}`).join(" / ")}`,
    `  다. 시행: ${EFFECT[x.effectiveDays] ?? "공포(발령)한 날부터 시행"}`,
    "",
    "2. 향후 관계 부서 협의 및 입법예고 등 개정 절차를 추진하겠습니다.",
    "",
    "붙임  1. 일부개정(안) 보고 1부.",
    "      2. 신·구조문대비표 1부.  끝.",
    "",
    sign(o),
  ].join("\n");
  const full = `「${x.regName}」 일부를 다음과 같이 개정한다.\n\n${x.items.map((i) => `${i.label} ${i.amended}`).join("\n\n")}\n\n${ADDENDA(x.effectiveDays)}`;
  return {
    title,
    report,
    draft,
    attachments: [
      { title: "붙임 1. 신·구조문대비표", html: oldNewTableHtml(x.items.map((i) => ({ label: i.label, current: i.current, amended: i.amended }))) },
      { title: "붙임 2. 개정문 및 부칙", html: `<p>${br(full)}</p>` },
    ],
  };
}
