import type { AskResult } from "./answer/types";
import { articleLabel } from "./law-api/util";
import { latestAmendment, recentAmendment } from "./law-api/amend";
import { MOCK_DATASET_DATE } from "./law-api/mock/dataset-date";

/**
 * AI 답변 검증 영수증 — 답변이 어떤 조문 원문을 언제·어디서 가져와 근거로 삼았는지, 인용 검증에서 무엇을 걸렀는지 한 장으로.
 * 조문마다 원문의 SHA-256 지문을 붙여, 나중에 같은 원문으로 다시 계산하면 일치하는지 확인할 수 있다.
 */
export interface ReceiptRow {
  no: number;
  key: string;
  label: string;
  source: string;
  url: string;
  cited: boolean;
  fingerprint: string | null;
  /** 원문 개정 표시 중 가장 최근 날짜(예: 2026.6.30) */
  amended: string | null;
  /** 최근 1년 안 개정 여부 */
  recent: boolean;
}

export interface Receipt {
  id: string | null;
  issuedAt: string;
  query: string;
  mode: string;
  engine: string;
  data: string;
  rows: ReceiptRow[];
  checks: { label: string; value: string; ok: boolean }[];
}

/** SHA-256 16진수(보안 컨텍스트가 아니라 계산할 수 없으면 null) */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

const kst = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())} (KST)`;
};

export async function buildReceipt(r: AskResult): Promise<Receipt> {
  const cited = new Set(Array.from(JSON.stringify([r.summary, r.citizen, r.officer]).matchAll(/\[\[([^\]]+)\]\]/g), (m) => m[1]));
  const rows: ReceiptRow[] = await Promise.all(
    r.citations.map(async (c, i) => ({
      no: i + 1,
      key: c.key,
      label: `「${c.lawName}」 ${articleLabel(c.articleNo)}(${c.title})`,
      source: c.source === "live" ? "국가법령정보 실시간 원문" : `국가법령정보센터 원문(${MOCK_DATASET_DATE} 수집)`,
      url: c.url,
      cited: cited.has(c.key),
      fingerprint: (await sha256Hex(c.text))?.slice(0, 16) ?? null,
      amended: latestAmendment(c.text)?.label ?? null,
      recent: !!recentAmendment(c.text, new Date(r.generatedAt)),
    })),
  );
  const full = await sha256Hex(JSON.stringify({ q: r.query, m: r.mode, s: r.summary, p: r.provider, c: rows.map((x) => [x.key, x.fingerprint]), t: r.generatedAt }));
  const g = r.guard;
  return {
    id: full ? full.slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-") : null,
    issuedAt: kst(r.generatedAt),
    query: r.query,
    mode: r.mode === "officer" ? "공직자 모드" : "국민 모드",
    engine: r.provider.kind === "llm" ? `${r.provider.label} · ${r.provider.model}` : r.provider.label,
    data: r.dataSource === "live" ? "국가법령정보 공동활용 Open API(실시간)" : `국가법령정보센터 원문 스냅샷(${MOCK_DATASET_DATE} 수집)`,
    rows,
    checks: [
      { label: "근거 조문을 먼저 찾은 뒤 답변", value: `근거 ${rows.length}건 확보, 답변에 인용 ${rows.filter((x) => x.cited).length}건`, ok: rows.length > 0 },
      { label: "근거 목록 밖 인용 제거", value: g.removedCitations.length ? `${g.removedCitations.length}건 제거(${g.removedCitations.join(", ")})` : "제거할 인용 없음", ok: true },
      { label: "본문 속 조문 언급 대조", value: g.unverifiedMentions.length ? `원문에서 확인 안 됨: ${g.unverifiedMentions.join(", ")}` : "모두 근거 원문에서 확인", ok: g.unverifiedMentions.length === 0 },
      { label: "생성형 AI 실패 시 안전 대체", value: g.fallbackReason ?? (r.provider.kind === "llm" ? "대체 없음(AI 응답 검증 통과)" : "규칙기반 엔진으로 답변(생성형 AI 미사용)"), ok: true },
      {
        label: "근거 조문 개정 확인",
        value: rows.some((x) => x.recent) ? `최근 1년 안 개정 ${rows.filter((x) => x.recent).length}건 — ${rows.filter((x) => x.recent).map((x) => `${x.no}번(${x.amended})`).join(", ")}, 개정 후 원문 기준으로 답변` : "최근 1년 안 개정된 근거 없음",
        ok: true,
      },
      { label: "조문 카드는 AI 문장이 아닌 원문", value: "인용 카드·뷰어에는 공식 원문만 표시", ok: true },
    ],
  };
}

export function receiptText(rc: Receipt): string {
  return [
    "법이음(LAW:ON) AI 답변 검증 영수증",
    `영수증 번호: ${rc.id ?? "(이 환경에서는 지문을 계산할 수 없음)"}`,
    `발급 시각: ${rc.issuedAt}`,
    `질문: ${rc.query} (${rc.mode})`,
    `답변 엔진: ${rc.engine}`,
    `법령 데이터: ${rc.data}`,
    "",
    "[근거 조문]",
    ...rc.rows.map((x) => `${x.no}. ${x.label} — ${x.source}${x.cited ? " · 답변 인용" : ""}${x.amended ? ` · 최종 개정 ${x.amended}${x.recent ? "(최근)" : ""}` : ""}\n   원문 지문(SHA-256 앞 16자리): ${x.fingerprint ?? "-"}\n   ${x.url}`),
    "",
    "[인용 검증]",
    ...rc.checks.map((c) => `${c.ok ? "✔" : "△"} ${c.label}: ${c.value}`),
    "",
    "※ 원문 지문은 조문 원문 전체를 SHA-256으로 계산한 값의 앞 16자리입니다. 같은 원문으로 다시 계산하면 같은 값이 나와, 답변 당시 근거가 바뀌지 않았는지 확인할 수 있습니다.",
    "※ 본 답변은 법률 정보 제공을 위한 AI 보조 결과로 법률 자문이 아닙니다.",
  ].join("\n");
}
