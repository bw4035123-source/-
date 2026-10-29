import type { CaseDetail, CaseItem, Citation, LawDoc, LawSummary } from "./types";
import { MOCK_LAWS, getMockLaw } from "./mock";
import { drfGet, findAll, txt, type DrfLawListItem, parseAdmrulDoc, parseAdmrulList, parseCaseDetail, parseCaseList, parseLawDoc, parseLawList, parseOrdinDoc, parseOrdinList, LawApiError } from "./drf";
import { bigramOverlap, lawNameHas, lawNameLooksLike, matchLawAliases, normalize, queryTerms, scoreArticleByTerms, searchLawNames } from "./search";
import { parseArticleKey, toCitation } from "./util";
import { rankCases } from "./case-rank";
import { MOCK_DATASET_DATE } from "./mock/dataset-date";

const CASE_TIMEOUT = 25000;
/** 판례 검색 전체 대기 한도 */
export const CASE_BUDGET_MS = 12000;
const CASE_FAST = { timeoutMs: 8000, retries: 1 };
/** 답변(질의응답·상황분석)이 실시간 원문을 기다리는 최대 시간 — 넘으면 공식 원문 스냅샷으로 즉시 답변 */
export const ANSWER_LIVE_BUDGET_MS = 6000;
/** 법령 뷰어가 실시간 원문을 기다리는 최대 시간 */
export const VIEWER_LIVE_BUDGET_MS = 9000;
/** 내장 토픽 밖 질문: 전체 법령 검색(법령명 검색 + 본문 조회)을 기다리는 최대 시간 */
export const LIVE_SEARCH_BUDGET_MS = 15000;
/** 내장 사본이 없는 법령(전체 법령·행정규칙·자치법규)을 기다리는 최대 시간 */
export const LIVE_ONLY_BUDGET_MS = 30000;
/** 시간 예산 안에서 쓰는 빠른 호출 설정(재시도 1회) */
const FAST = { timeoutMs: 5000, retries: 1 };

/** 기한 안에 끝나지 않으면 대체값으로 즉시 응답(원래 요청은 계속 진행되어 캐시에 저장 → 다음 요청부터 실시간) */
function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(onTimeout());
      },
    );
  });
}

export type LawListKind = "law" | "admrul" | "ordin";

/**
 * 법령 저장소(Repository) — 실시간(국가법령정보 Open API)과 내장 모의데이터를 하나의 인터페이스로 제공.
 * OC 인증키가 없거나 호출이 실패하면 자동으로 내장 데이터로 대체(Fallback)하고 그 사실을 warnings 에 남긴다.
 */
export class LawService {
  readonly warnings: string[] = [];

  constructor(private readonly oc: string = "") {}

  get mode(): "live" | "mock" {
    return this.oc ? "live" : "mock";
  }

  private summarize(l: LawDoc): LawSummary {
    return { id: l.id, name: l.name, kind: l.kind, ministry: l.ministry, articleCount: l.articles.length, parentId: l.parentId, source: l.source };
  }

  /**
   * 법령 목록 검색. kind: law(법률·시행령·시행규칙) | admrul(행정규칙: 훈령·예규·고시) | ordin(자치법규: 조례·규칙)
   * 실시간 모드에서는 국가법령정보 전체 법령을 검색한다(내장 데이터는 법령 검색에만 함께 표시).
   */
  async listLaws(query = "", kind: LawListKind = "law"): Promise<LawSummary[]> {
    const local = kind === "law" ? searchLawNames(query).map((l) => this.summarize(l)) : [];
    if (!this.oc || !query.trim()) return local;
    try {
      if (kind === "admrul") {
        const list = parseAdmrulList(await drfGet("lawSearch.do", { target: "admrul", query, display: "50" }, this.oc));
        return list.map<LawSummary>((x) => ({ id: `adm-${x.key}`, name: x.name, kind: "행정규칙", subKind: x.subKind, ministry: x.org, articleCount: 0, source: "live", effectiveDate: x.effective }));
      }
      if (kind === "ordin") {
        const list = parseOrdinList(await drfGet("lawSearch.do", { target: "ordin", query, display: "50" }, this.oc));
        return list.map<LawSummary>((x) => ({ id: `ord-${x.key}`, name: x.name, kind: "자치법규", subKind: x.subKind, ministry: x.org, articleCount: 0, source: "live", effectiveDate: x.effective }));
      }
      const data = await drfGet("lawSearch.do", { target: "law", query, display: "50" }, this.oc);
      const known = new Set(MOCK_LAWS.map((l) => l.name.replace(/\s/g, "")));
      const live = parseLawList(data)
        .filter((x) => !known.has(x.name.replace(/\s/g, "")) && (!x.status || x.status === "현행"))
        .map<LawSummary>((x) => ({ id: `mst-${x.mst}`, name: x.name, kind: (x.kind as LawSummary["kind"]) || "법률", ministry: x.ministry, articleCount: 0, source: "live", effectiveDate: x.effective }));
      return [...local, ...live];
    } catch (e) {
      this.warnings.push((e as Error).message);
      return local;
    }
  }

  /**
   * 내장 토픽에 없는 질문: 국가법령정보 Open API로 관련 법령을 찾아 조문 단위 근거 키를 만든다.
   * 질문 → 검색어 추출 → 법령명 검색(현행) → 상위 법령 본문 조회 → 검색어가 많이 맞는 조문.
   */
  async searchLiveKeys(query: string, budgetMs = LIVE_SEARCH_BUDGET_MS, maxArticles = 4): Promise<string[]> {
    if (!this.oc) return [];
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const work = (async () => {
      // 검색어마다 법령명 검색 + 본문 검색(본문 검색 결과 수가 적은 '드문 말'일수록 가중치 큼)
      const get = (t: string, body: boolean) =>
        drfGet("lawSearch.do", { target: "law", query: t, display: body ? "100" : "10", ...(body ? { search: "2" } : {}) }, this.oc, FAST.timeoutMs, FAST.retries)
          .then((d) => ({ list: parseLawList(d), total: Number(txt(findAll(d, "totalCnt")[0] ?? "")) || 0 }))
          .catch(() => ({ list: [], total: 0 }));
      // 여러 말을 한꺼번에 넣은 본문 검색은 AND 조건 → 모두 들어 있는 법령(결과가 적어 정확)
      const combos = terms.length >= 2 ? Array.from(new Set([terms.join(" "), terms.slice(0, 2).join(" ")])) : [];
      // 생활 용어 → 법령 사전(사람이 검수): 일치하면 그 법령을 먼저 세운다(법령명 검색은 넉넉히 받아 정확히 같은 이름만)
      const aliases = matchLawAliases(query);
      const byExactName = (law: string) =>
        drfGet("lawSearch.do", { target: "law", query: law, display: "100" }, this.oc, FAST.timeoutMs, FAST.retries)
          .then((d) => parseLawList(d).filter((x) => x.name.replace(/\s/g, "") === law.replace(/\s/g, "")))
          .catch(() => [] as DrfLawListItem[]);
      const [res, andRes, aliasRes] = await Promise.all([
        Promise.all(terms.flatMap((t) => [get(t, false), get(t, true)])),
        Promise.all(combos.map((c) => get(c, true))),
        Promise.all(aliases.map((a) => byExactName(a.law))),
      ]);
      // 점수: 드문 말일수록 큰 가중치(IDF). 본문 검색은 결과가 100건을 넘으면 가나다순 앞부분만 오므로
      // (관련도와 무관) 100건 이하로 '전부' 받은 경우만 근거로 쓴다.
      const idf = (n: number, base: number, hi: number) => (n > 0 ? Math.min(hi, Math.max(0.3, Math.log2(base / n))) : 0);
      const complete = (r: { total: number; list: unknown[] }) => r.total > 0 && r.total <= 100;
      const cand = new Map<string, { mst: string; name: string; score: number }>();
      const add = (x: DrfLawListItem, v: number) => {
        if (x.status && x.status !== "현행") return;
        const c = cand.get(x.mst) ?? { mst: x.mst, name: x.name, score: (x.kind === "법률" ? 0.5 : 0) - x.name.length / 40 + bigramOverlap(x.name, terms) * 3 };
        c.score += v;
        cand.set(x.mst, c);
      };
      terms.forEach((t, ti) => {
        const byName = res[ti * 2];
        const byBody = res[ti * 2 + 1];
        // 법령명 일치: 이름이 검색어에 가까울수록(짧을수록) 크게 — "주차장" → 주차장법
        const wName = idf(byName.total || byName.list.length, 300, 6) * 2;
        byName.list.filter((x) => lawNameHas(x.name, t)).forEach((x) => add(x, wName * Math.sqrt(t.length / x.name.replace(/\s/g, "").length)));
        if (complete(byBody)) byBody.list.forEach((x) => add(x, idf(byBody.total, 3000, 8)));
      });
      // 여러 말이 모두 들어 있는 법령(AND 본문 검색)
      andRes.forEach((r, i) => {
        if (complete(r)) r.list.forEach((x) => add(x, (i === 0 ? 5 : 3) * (x.kind === "법률" ? 1 : 0.6)));
      });
      // 사전에서 찾은 법령은 가장 앞에
      aliasRes.forEach((list) => list.forEach((x) => add(x, 30)));
      // 근거가 하나도 없으면(모든 말이 흔한 경우) 본문 검색 앞부분 중 법령명이 질문과 비슷한 것만 비교
      // (본문 검색 앞부분은 가나다순이라 관련 없는 법령이 섞이므로 이름이 전혀 안 닮은 법령은 제외)
      if (!cand.size) terms.forEach((_, ti) => res[ti * 2 + 1].list.forEach((x) => bigramOverlap(x.name, terms) > 0 && add(x, 0.1)));
      // 같은 법령의 여러 판(시행 예정 등)은 하나만
      const seen = new Set<string>();
      const aliasMst = new Set(aliasRes.flat().map((x) => x.mst));
      const top = Array.from(cand.values())
        // 사전에서 찾은 법령이 있으면 그 법령만(글자만 겹친 다른 법령을 섞지 않음), 없으면 이름이 질문과 닮은 법령만 —
        // 낱말 하나가 우연히 겹친 법령을 근거로 붙이느니 '찾지 못함'으로 정직하게 안내
        .filter((c) => (aliasMst.size ? aliasMst.has(c.mst) : lawNameLooksLike(c.name, terms)))
        .sort((a, b) => b.score - a.score)
        .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
        .slice(0, 2);
      const docs = await Promise.all(top.map((c) => this.getLaw(`mst-${c.mst}`)));
      const scored: { key: string; score: number }[] = [];
      for (const doc of docs) {
        if (!doc) continue;
        // 사전 법령은 그 항목의 키워드도 함께 써서 조문을 고름(같은 법령의 항목이 여럿 걸리면 키워드를 합침)
        const matched = aliases.filter((x) => x.law.replace(/\s/g, "") === doc.name.replace(/\s/g, ""));
        const alias = matched[0];
        const kw = Array.from(new Set(matched.flatMap((x) => x.keywords)));
        const ts = [...terms, ...kw.filter((k) => !terms.includes(k))];
        // 사람이 고른 키워드가 조문 제목에 있으면 가산 — 질문의 흔한 말('경찰')만 제목에 겹친 조문보다 앞에
        const kwTitle = (a: { title: string }) => (kw.some((k) => normalize(a.title).includes(normalize(k))) ? 6 : 0);
        // 법령명이 질문과 전혀 안 닮았고 사전에서 찾은 법령도 아니면 더 강한 일치(3점 이상)만 근거로('도서'→섬 '도서(島嶼)' 같은 우연 일치 방지)
        const min = alias || bigramOverlap(doc.name, terms) > 0 ? 2 : 3;
        for (const a of doc.articles) {
          const sc = scoreArticleByTerms(a, ts) + kwTitle(a);
          // 흔한 말 하나만 겹치는 조문은 근거로 쓰지 않음(제목 일치 또는 본문에 두 말 이상)
          if (sc >= min) scored.push({ key: `${doc.id}:${a.no}`, score: sc });
        }
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, maxArticles).map((x) => x.key);
    })();
    return withDeadline(work, budgetMs, () => {
      const msg = "국가법령정보센터 검색이 늦어 일부 근거를 표시하지 못했습니다. 잠시 후 다시 검색해 주세요.";
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
      return [];
    });
  }

  /** id: 내장 법령 id 또는 "mst-<법령일련번호>". fast: 짧은 제한시간·재시도 1회(시간 예산 경로용) */
  async getLaw(id: string, fast = false): Promise<LawDoc | null> {
    const mock = getMockLaw(id);
    if (!this.oc) return mock ?? null;
    try {
      if (id.startsWith("adm-")) {
        const t = fast ? FAST : { timeoutMs: 20000, retries: undefined };
        return parseAdmrulDoc(await drfGet("lawService.do", { target: "admrul", ID: id.slice(4) }, this.oc, t.timeoutMs, t.retries), id);
      }
      if (id.startsWith("ord-")) {
        const t = fast ? FAST : { timeoutMs: 20000, retries: undefined };
        return parseOrdinDoc(await drfGet("lawService.do", { target: "ordin", MST: id.slice(4) }, this.oc, t.timeoutMs, t.retries), id);
      }
      if (id.startsWith("mst-")) {
        const mst = id.slice(4);
        const data = fast ? await drfGet("lawService.do", { target: "law", MST: mst }, this.oc, FAST.timeoutMs, FAST.retries) : await drfGet("lawService.do", { target: "law", MST: mst }, this.oc);
        return parseLawDoc(data, { id, name: "", mst });
      }
      if (!mock) return null;
      const live = await this.fetchLiveByName(mock.name, id, fast);
      return live ? mergeWithMock(live, mock) : mock;
    } catch (e) {
      this.warnings.push(`${mock?.name ?? id}: ${(e as Error).message} — 내장 데이터로 대체`);
      return mock ?? null;
    }
  }

  private async fetchLiveByName(name: string, id: string, fast = false): Promise<LawDoc | null> {
    const t = fast ? FAST : { timeoutMs: 20000, retries: undefined };
    const same = (x: { name: string }) => x.name.replace(/\s/g, "") === name.replace(/\s/g, "");
    let exact = parseLawList(await drfGet("lawSearch.do", { target: "law", query: name, display: "20" }, this.oc, t.timeoutMs, t.retries)).filter(same);
    // 목록은 가나다순이라 짧은 이름('상법')은 앞 20건에 안 들 수 있어 넓혀 한 번 더
    if (!exact.length) exact = parseLawList(await drfGet("lawSearch.do", { target: "law", query: name, display: "100" }, this.oc, t.timeoutMs, t.retries)).filter(same);
    if (!exact.length) throw new LawApiError(`'${name}'을(를) 국가법령정보에서 찾지 못했습니다`);
    const current = exact.filter((x) => !x.status || x.status === "현행");
    const pick = (current.length ? current : exact).sort((a, b) => b.effective.localeCompare(a.effective))[0];
    const data = await drfGet("lawService.do", { target: "law", MST: pick.mst }, this.oc, t.timeoutMs, t.retries);
    const doc = parseLawDoc(data, { id, name, mst: pick.mst });
    // 본문의 기본정보.시행일자는 단계적 시행 조문 중 '마지막' 시행일일 수 있어, 목록의 현행 시행일자를 사용
    return pick.effective ? { ...doc, effectiveDate: pick.effective } : doc;
  }

  /**
   * 시간 예산 안에서 법령 조회. 예산을 넘기면 공식 원문 스냅샷(내장)으로 즉시 대체하고 안내를 남긴다.
   * 예산이 0이면 기다림(제한 없음).
   */
  private getLawWithin(id: string, budgetMs: number): Promise<LawDoc | null> {
    if (!this.oc || !budgetMs) return this.getLaw(id);
    // 내장 사본이 없는 법령(전체 법령 검색 결과·행정규칙·자치법규)은 대체할 것이 없으므로 더 기다린다
    if (!getMockLaw(id))
      return withDeadline(this.getLaw(id), Math.max(budgetMs, LIVE_ONLY_BUDGET_MS), () => {
        const msg = `국가법령정보센터 응답이 늦어 법령을 불러오지 못했습니다(${Math.round(Math.max(budgetMs, LIVE_ONLY_BUDGET_MS) / 1000)}초 초과). 잠시 후 다시 시도해 주세요.`;
        if (!this.warnings.includes(msg)) this.warnings.push(msg);
        return null;
      });
    return withDeadline(this.getLaw(id, true), budgetMs, () => {
      const mock = getMockLaw(id) ?? null;
      const msg = `국가법령정보센터 응답 지연(${Math.round(budgetMs / 1000)}초 초과) — 공식 원문 스냅샷(${MOCK_DATASET_DATE} 수집)으로 표시했습니다. 잠시 후 다시 검색하면 실시간 원문으로 표시됩니다.`;
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
      return mock;
    });
  }

  /** 상위법-시행령-시행규칙 3단 구조(관련 법령을 병렬 조회, 시간 예산 적용) */
  async getHierarchy(id: string, budgetMs = VIEWER_LIVE_BUDGET_MS): Promise<{ root: LawDoc; children: LawDoc[] } | null> {
    const base = getMockLaw(id);
    const rootId = base?.parentId ?? id;
    const childIds = MOCK_LAWS.filter((l) => l.parentId === rootId).map((l) => l.id);
    const ids = Array.from(new Set([rootId, id, ...childIds]));
    const docs = await Promise.all(ids.map((x) => this.getLawWithin(x, budgetMs)));
    const byId = new Map(ids.map((x, i) => [x, docs[i]]));
    const root = byId.get(rootId) ?? byId.get(id);
    if (!root) return null;
    const children = childIds.map((c) => byId.get(c)).filter((x): x is LawDoc => !!x);
    return { root, children };
  }

  /** 인용 키 → 인용 카드. 실시간 모드면 원문을 최신 조문으로 교체(법령별 병렬, 시간 예산 적용) */
  async getCitations(keys: string[], budgetMs = ANSWER_LIVE_BUDGET_MS): Promise<Citation[]> {
    const byLaw = new Map<string, string[]>();
    for (const k of keys) {
      const p = parseArticleKey(k);
      if (!p) continue;
      byLaw.set(p.lawId, [...(byLaw.get(p.lawId) ?? []), p.articleNo]);
    }
    const lawIds = Array.from(byLaw.keys());
    const docs = await Promise.all(lawIds.map((id) => this.getLawWithin(id, budgetMs)));
    const out: Citation[] = [];
    lawIds.forEach((lawId, i) => {
      const law = docs[i];
      if (!law) return;
      for (const no of byLaw.get(lawId)!) {
        const art = law.articles.find((a) => a.no === no) ?? getMockLaw(lawId)?.articles.find((a) => a.no === no);
        if (art) out.push(toCitation(law, art));
      }
    });
    // 요청 순서 유지
    return keys.map((k) => out.find((c) => c.key === k)).filter((c): c is Citation => !!c);
  }

  /**
   * 판례·법령해석례: 사건명 검색 우선, 결과가 부족하면 본문 검색(search=2)으로 보완.
   * 판례·해석례를 병렬로, 전체 CASE_BUDGET_MS 안에서만 기다린다(본문 검색은 느릴 수 있어 넘으면 생략 —
   * 요청은 계속되어 캐시에 저장되므로 다시 검색하면 표시).
   */
  async searchCases(query: string, limit = 5, budgetMs = CASE_BUDGET_MS): Promise<CaseItem[]> {
    if (!this.oc || !query.trim()) return [];
    const max = Math.min(Math.max(limit, 1), 20);
    // 제목으로 다시 거르므로 넉넉히 받는다(사건명 검색 20건, 본문 검색 40건)
    const display = "20";
    const deadline = Date.now() + budgetMs;
    let slowSkipped = false;
    const one = async (target: "prec" | "expc", kind: CaseItem["kind"]): Promise<CaseItem[]> => {
      const byName = rankCases(query, parseCaseList(await drfGet("lawSearch.do", { target, query, display }, this.oc, CASE_FAST.timeoutMs, CASE_FAST.retries), kind), max);
      if (byName.length >= 2) return byName;
      const remaining = deadline - Date.now();
      if (remaining < 1500) {
        slowSkipped = true;
        return byName;
      }
      const byText = await withDeadline(
        drfGet("lawSearch.do", { target, query, display: "40", search: "2" }, this.oc, CASE_TIMEOUT, 1).then((d) => parseCaseList(d, kind)),
        remaining,
        () => {
          slowSkipped = true;
          return [] as CaseItem[];
        },
      );
      return rankCases(query, [...byName, ...byText.filter((c) => !byName.some((b) => b.id === c.id))], max);
    };
    const settle = (p: Promise<CaseItem[]>) =>
      p.catch((e: Error) => {
        if (!this.warnings.includes(e.message)) this.warnings.push(e.message);
        return [] as CaseItem[];
      });
    const [prec, expc] = await Promise.all([settle(one("prec", "판례")), settle(one("expc", "법령해석례"))]);
    if (slowSkipped) this.warnings.push("국가법령정보센터 본문 검색이 지연되어 일부 결과를 생략했습니다. 잠시 후 다시 검색하면 더 많은 판례가 표시됩니다.");
    return [...prec, ...expc];
  }

  /** 판례·법령해석례 상세(판례 보기) — 실시간 연동 시에만 제공(사건 내용을 지어내지 않음) */
  async getCase(kind: CaseItem["kind"], id: string): Promise<CaseDetail | null> {
    if (!this.oc || !/^\d{1,12}$/.test(id)) return null;
    try {
      const data = await drfGet("lawService.do", { target: kind === "판례" ? "prec" : "expc", ID: id }, this.oc, CASE_TIMEOUT);
      return parseCaseDetail(data, kind, id);
    } catch (e) {
      this.warnings.push((e as Error).message);
      return null;
    }
  }
}

/** 실시간 원문 + 내장 메타데이터(위임 관계·키워드·실무 노트) 결합 */
/** 내장 조문에 사람이 덧붙인 별표 요지(금액·기준) — 실시간 조문 본문에는 별표가 없어 그대로 이어 붙인다 */
function byeolpyoTail(mockText = ""): string {
  const lines = mockText.split("\n");
  const i = lines.findIndex((l) => l.startsWith("[별표"));
  return i < 0 ? "" : lines.slice(i).join("\n");
}

function mergeWithMock(live: LawDoc, mock: LawDoc): LawDoc {
  const meta = new Map(mock.articles.map((a) => [a.no, a]));
  return {
    ...live,
    id: mock.id,
    shortName: mock.shortName,
    parentId: mock.parentId,
    kind: mock.kind,
    ministry: live.ministry || mock.ministry,
    revisionReason: live.revisionReason || mock.revisionReason,
    practiceNotes: mock.practiceNotes,
    articles: live.articles.map((a) => {
      const tail = a.text.includes("[별표") ? "" : byeolpyoTail(meta.get(a.no)?.text);
      return { ...a, text: tail ? `${a.text}\n${tail}` : a.text, delegates: meta.get(a.no)?.delegates, keywords: meta.get(a.no)?.keywords };
    }),
  };
}
