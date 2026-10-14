import type { CaseDetail, CaseItem, Citation, LawDoc, LawSummary } from "./types";
import { MOCK_LAWS, getMockLaw } from "./mock";
import { drfGet, parseCaseDetail, parseCaseList, parseLawDoc, parseLawList, LawApiError } from "./drf";
import { searchLawNames } from "./search";
import { parseArticleKey, toCitation } from "./util";

const CASE_TIMEOUT = 25000;

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

  async listLaws(query = ""): Promise<LawSummary[]> {
    const local = searchLawNames(query).map((l) => this.summarize(l));
    if (!this.oc || !query.trim()) return local;
    try {
      const data = await drfGet("lawSearch.do", { target: "law", query, display: "20" }, this.oc);
      const known = new Set(MOCK_LAWS.map((l) => l.name.replace(/\s/g, "")));
      const live = parseLawList(data)
        .filter((x) => !known.has(x.name.replace(/\s/g, "")))
        .map<LawSummary>((x) => ({ id: `mst-${x.mst}`, name: x.name, kind: (x.kind as LawSummary["kind"]) || "법률", ministry: x.ministry, articleCount: 0, source: "live" }));
      return [...local, ...live];
    } catch (e) {
      this.warnings.push((e as Error).message);
      return local;
    }
  }

  /** id: 내장 법령 id 또는 "mst-<법령일련번호>" */
  async getLaw(id: string): Promise<LawDoc | null> {
    const mock = getMockLaw(id);
    if (!this.oc) return mock ?? null;
    try {
      if (id.startsWith("mst-")) {
        const mst = id.slice(4);
        const data = await drfGet("lawService.do", { target: "law", MST: mst }, this.oc);
        return parseLawDoc(data, { id, name: "", mst });
      }
      if (!mock) return null;
      const live = await this.fetchLiveByName(mock.name, id);
      return live ? mergeWithMock(live, mock) : mock;
    } catch (e) {
      this.warnings.push(`${mock?.name ?? id}: ${(e as Error).message} — 내장 데이터로 대체`);
      return mock ?? null;
    }
  }

  private async fetchLiveByName(name: string, id: string): Promise<LawDoc | null> {
    const list = parseLawList(await drfGet("lawSearch.do", { target: "law", query: name, display: "20" }, this.oc));
    const exact = list.filter((x) => x.name.replace(/\s/g, "") === name.replace(/\s/g, ""));
    if (!exact.length) throw new LawApiError(`'${name}'을(를) 국가법령정보에서 찾지 못했습니다`);
    const current = exact.filter((x) => !x.status || x.status === "현행");
    const pick = (current.length ? current : exact).sort((a, b) => b.effective.localeCompare(a.effective))[0];
    const data = await drfGet("lawService.do", { target: "law", MST: pick.mst }, this.oc);
    const doc = parseLawDoc(data, { id, name, mst: pick.mst });
    // 본문의 기본정보.시행일자는 단계적 시행 조문 중 '마지막' 시행일일 수 있어, 목록의 현행 시행일자를 사용
    return pick.effective ? { ...doc, effectiveDate: pick.effective } : doc;
  }

  /** 상위법-시행령-시행규칙 3단 구조 */
  async getHierarchy(id: string): Promise<{ root: LawDoc; children: LawDoc[] } | null> {
    const base = await this.getLaw(id);
    if (!base) return null;
    const rootId = base.parentId ?? base.id;
    const root = rootId === base.id ? base : (await this.getLaw(rootId)) ?? base;
    const childIds = MOCK_LAWS.filter((l) => l.parentId === root.id).map((l) => l.id);
    const children = (await Promise.all(childIds.map((c) => this.getLaw(c)))).filter((x): x is LawDoc => !!x);
    return { root, children };
  }

  /** 인용 키 → 인용 카드. 실시간 모드면 원문을 최신 조문으로 교체 */
  async getCitations(keys: string[]): Promise<Citation[]> {
    const byLaw = new Map<string, string[]>();
    for (const k of keys) {
      const p = parseArticleKey(k);
      if (!p) continue;
      byLaw.set(p.lawId, [...(byLaw.get(p.lawId) ?? []), p.articleNo]);
    }
    const out: Citation[] = [];
    for (const [lawId, nos] of Array.from(byLaw.entries())) {
      const law = await this.getLaw(lawId);
      if (!law) continue;
      for (const no of nos) {
        const art = law.articles.find((a) => a.no === no) ?? getMockLaw(lawId)?.articles.find((a) => a.no === no);
        if (art) out.push(toCitation(law, art));
      }
    }
    // 요청 순서 유지
    return keys.map((k) => out.find((c) => c.key === k)).filter((c): c is Citation => !!c);
  }

  /** 판례·법령해석례: 사건명 검색 우선, 결과가 부족하면 본문 검색(search=2)으로 보완 */
  async searchCases(query: string, limit = 5): Promise<CaseItem[]> {
    if (!this.oc || !query.trim()) return [];
    const display = String(Math.min(Math.max(limit, 1), 20));
    const one = async (target: "prec" | "expc", kind: CaseItem["kind"]) => {
      const byName = parseCaseList(await drfGet("lawSearch.do", { target, query, display }, this.oc, CASE_TIMEOUT), kind);
      if (byName.length >= 2) return byName;
      const byText = parseCaseList(await drfGet("lawSearch.do", { target, query, display, search: "2" }, this.oc, CASE_TIMEOUT), kind);
      return [...byName, ...byText.filter((c) => !byName.some((b) => b.id === c.id))].slice(0, Number(display));
    };
    try {
      const [prec, expc] = await Promise.all([one("prec", "판례"), one("expc", "법령해석례")]);
      return [...prec, ...expc];
    } catch (e) {
      this.warnings.push((e as Error).message);
      return [];
    }
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
    articles: live.articles.map((a) => ({ ...a, delegates: meta.get(a.no)?.delegates, keywords: meta.get(a.no)?.keywords })),
  };
}
