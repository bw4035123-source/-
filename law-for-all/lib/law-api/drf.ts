import type { CaseDetail, CaseItem, LawArticle, LawDoc, LawKind } from "./types";

/**
 * 국가법령정보 공동활용 Open API(DRF) 저수준 클라이언트.
 *  - lawSearch.do : 법령·판례·해석례 목록 검색
 *  - lawService.do: 법령 본문(조문) 조회
 * 요청 호스트는 law.go.kr 로 고정(인증키가 다른 곳으로 전송되지 않도록).
 * 응답 구조가 버전에 따라 조금씩 달라도 동작하도록 키 이름 기반으로 탐색한다.
 */
export const DRF_BASE = "https://www.law.go.kr/DRF";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6시간
const RETRIES = 3;

export class LawApiError extends Error {}

type Json = unknown;
const cache = new Map<string, { at: number; data: Json }>();

export async function drfGet(path: "lawSearch.do" | "lawService.do", params: Record<string, string>, oc: string, timeoutMs = 20000): Promise<Json> {
  const qs = new URLSearchParams({ OC: oc, type: "JSON", ...params });
  const url = `${DRF_BASE}/${path}?${qs.toString()}`;
  const cacheKey = `${path}?${new URLSearchParams(params).toString()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // 국가법령정보센터는 간헐적으로 연결을 끊는 경우가 있어 짧게 재시도(총 4회)
  let raw: string | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES && raw === null; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "law-on/1.0" }, cache: "no-store" });
      raw = await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  if (raw === null) {
    if (hit) return hit.data; // 네트워크 장애 시 오래된 캐시라도 반환
    const proxyHint =
      (process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY ? " (프록시 환경이면 NODE_USE_ENV_PROXY=1 로 실행하세요)" : "";
    throw new LawApiError(`국가법령정보센터 연결 실패: ${(lastErr as Error)?.message ?? lastErr}${proxyHint}`);
  }
  let data: Json;
  try {
    data = JSON.parse(raw);
  } catch {
    // 인증키 오류·미등록 IP 등은 JSON 대신 HTML 안내 페이지가 온다
    const hint = raw.replace(/<[^>]+>|\s+/g, " ").trim().slice(0, 120);
    throw new LawApiError(`국가법령정보센터가 JSON이 아닌 응답을 보냈습니다. OC 인증키와 등록 IP/도메인을 확인하세요. (${hint})`);
  }
  raiseIfRejected(data);
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** 인증키 오류·미등록 IP는 HTTP 200 + {"result": "...", "msg": "..."} JSON으로 온다 → 명확한 오류로 변환 */
function raiseIfRejected(data: Json): void {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data as object);
    if (keys.includes("result") && keys.every((k) => k === "result" || k === "msg")) {
      const d = data as { result?: string; msg?: string };
      throw new LawApiError(`국가법령정보센터 인증 실패: ${d.result ?? ""} ${d.msg ?? ""}`.trim());
    }
  }
}

// ───────────── 응답 구조 탐색 유틸(순수 함수, 테스트 대상)
export function findAll(obj: Json, key: string): Json[] {
  const out: Json[] = [];
  const walk = (o: Json) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, Json>)) {
        if (k === key) Array.isArray(v) ? out.push(...v) : out.push(v);
        else walk(v);
      }
    }
  };
  walk(obj);
  return out;
}

export function txt(v: Json): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join("\n");
  if (typeof v === "object") return txt((v as Record<string, Json>).content ?? "");
  return String(v).trim();
}

const asList = (v: Json): Json[] => (Array.isArray(v) ? v : v ? [v] : []);
const rec = (v: Json) => (v && typeof v === "object" ? (v as Record<string, Json>) : {});

export interface DrfLawListItem {
  name: string;
  mst: string;
  lawId: string;
  kind: string;
  ministry: string;
  effective: string;
  status: string;
}

export function parseLawList(data: Json): DrfLawListItem[] {
  return findAll(data, "law")
    .map(rec)
    .map((it) => ({
      name: txt(it["법령명한글"]),
      mst: txt(it["법령일련번호"]),
      lawId: txt(it["법령ID"]),
      kind: txt(it["법령구분명"]),
      ministry: txt(it["소관부처명"]),
      effective: txt(it["시행일자"]),
      status: txt(it["현행연혁코드"]),
    }))
    .filter((x) => x.name && x.mst);
}

const KIND_MAP: Record<string, LawKind> = { 법률: "법률", 대통령령: "대통령령", 총리령: "총리령", 부령: "부령" };
export const toLawKind = (s: string): LawKind => KIND_MAP[s] ?? (s.includes("부령") ? "부령" : "법률");

/** 조문단위 → LawArticle[] (항·호·목 들여쓰기 보존) */
export function parseArticles(data: Json): LawArticle[] {
  const arts: LawArticle[] = [];
  for (const u of findAll(data, "조문단위").map(rec)) {
    const kind = txt(u["조문여부"]);
    if (kind && kind !== "조문") continue; // '전문'(장·절 제목) 제외
    const lines: string[] = [];
    const head = txt(u["조문내용"]);
    if (head) lines.push(head);
    for (const hang of asList(u["항"]).map(rec)) {
      const h = txt(hang["항내용"]);
      if (h) lines.push(h);
      for (const ho of asList(hang["호"]).map(rec)) {
        const t = txt(ho["호내용"]);
        if (t) lines.push("  " + t);
        for (const mok of asList(ho["목"]).map(rec)) {
          const m = txt(mok["목내용"]);
          if (m) lines.push("    " + m);
        }
      }
    }
    const jo = txt(u["조문번호"]);
    const branch = txt(u["조문가지번호"]);
    if (!jo) continue;
    // 조문내용 첫 줄의 "제3조(대항력 등)" 머리말은 화면에서 따로 표시하므로 제거
    if (lines[0]) lines[0] = lines[0].replace(/^제\d+조(의\d+)?\s*(\([^)]*\))?\s*/, "");
    arts.push({
      no: branch && branch !== "0" ? `${jo}의${branch}` : jo,
      title: txt(u["조문제목"]),
      text: lines.filter(Boolean).join("\n"),
    });
  }
  return arts;
}

export function parseLawDoc(data: Json, fallback: { id: string; name: string; mst: string }): LawDoc {
  const basic = rec(findAll(data, "기본정보")[0]);
  const reason = findAll(data, "제개정이유내용").map(txt).join("\n").trim();
  return {
    id: fallback.id,
    name: txt(basic["법령명_한글"]) || fallback.name,
    kind: toLawKind(txt(rec(basic["법종구분"]).content ?? basic["법종구분"])),
    ministry: txt(rec(basic["소관부처"]).content ?? basic["소관부처"]) || "",
    effectiveDate: txt(basic["시행일자"]) || undefined,
    revisionReason: reason || undefined,
    articles: parseArticles(data),
    source: "live",
    mst: fallback.mst,
    fetchedAt: new Date().toISOString(),
  };
}

const caseUrl = (kind: CaseItem["kind"], caseNo: string) =>
  // 공개 주소 형식(인증키를 브라우저로 노출하지 않음)
  caseNo ? `https://www.law.go.kr/${kind === "판례" ? "판례" : "법령해석례"}/(${encodeURIComponent(caseNo)})` : "https://www.law.go.kr/";

export function parseCaseList(data: Json, kind: CaseItem["kind"]): CaseItem[] {
  const key = kind === "판례" ? "prec" : "expc";
  return findAll(data, key)
    .map(rec)
    .map((it) => {
      const caseNo = txt(it["사건번호"] ?? it["안건번호"]);
      return {
        kind,
        id: txt(it["판례일련번호"] ?? it["법령해석례일련번호"]),
        title: txt(it["사건명"] ?? it["안건명"]),
        caseNo: caseNo || undefined,
        court: txt(it["법원명"] ?? it["회신기관명"]) || undefined,
        date: txt(it["선고일자"] ?? it["회신일자"]) || undefined,
        url: caseUrl(kind, caseNo),
      };
    })
    .filter((c) => c.title);
}

/** 판례 본문의 HTML 줄바꿈·태그를 일반 텍스트로(화면에는 텍스트로만 출력 — HTML 주입 방지) */
export function cleanCaseText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PREC_SECTIONS: [string, string][] = [
  ["판시사항", "판시사항"],
  ["판결요지", "판결요지"],
  ["참조조문", "참조조문"],
  ["참조판례", "참조판례"],
  ["판례내용", "판결 전문"],
];
const EXPC_SECTIONS: [string, string][] = [
  ["질의요지", "질의요지"],
  ["회답", "회답"],
  ["이유", "이유"],
];

export function parseCaseDetail(data: Json, kind: CaseItem["kind"], id: string): CaseDetail | null {
  const body = rec(findAll(data, kind === "판례" ? "PrecService" : "ExpcService")[0]);
  const title = txt(body["사건명"] ?? body["안건명"]);
  if (!title) return null;
  const caseNo = txt(body["사건번호"] ?? body["안건번호"]);
  const sections = (kind === "판례" ? PREC_SECTIONS : EXPC_SECTIONS)
    .map(([key, label]) => ({ label, text: cleanCaseText(txt(body[key])) }))
    .filter((x) => x.text);
  return {
    kind,
    id,
    title,
    caseNo: caseNo || undefined,
    court: txt(body["법원명"] ?? body["해석기관명"]) || undefined,
    date: txt(body["선고일자"] ?? body["해석일자"]) || undefined,
    judgmentType: txt(body["판결유형"]) || undefined,
    sections,
    url: caseUrl(kind, caseNo),
  };
}
