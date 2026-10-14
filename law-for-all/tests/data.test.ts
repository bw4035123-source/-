import { describe, expect, it } from "vitest";
import { MOCK_LAWS, getMockLaw } from "@/lib/law-api/mock";
import { TOPICS } from "@/lib/law-api/mock/topics";
import { parseArticleKey } from "@/lib/law-api/util";

/** 내장 데이터 무결성 — 토픽·위임 관계가 존재하지 않는 조문을 가리키면 환각과 같으므로 빌드 단계에서 차단 */
describe("내장 법령 데이터 무결성", () => {
  const exists = (key: string) => {
    const p = parseArticleKey(key)!;
    return !!getMockLaw(p.lawId)?.articles.some((a) => a.no === p.articleNo);
  };

  it("법률 10종 이상 + 하위법령 포함", () => {
    expect(MOCK_LAWS.filter((l) => l.kind === "법률").length).toBeGreaterThanOrEqual(10);
    expect(MOCK_LAWS.some((l) => l.kind === "대통령령")).toBe(true);
    expect(MOCK_LAWS.some((l) => ["부령", "공동부령"].includes(l.kind))).toBe(true);
  });

  it("id 중복 없음, 하위법령의 parentId 유효", () => {
    const ids = MOCK_LAWS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of MOCK_LAWS) if (l.parentId) expect(getMockLaw(l.parentId), l.id).toBeDefined();
  });

  it("위임(delegates) 대상 조문이 모두 존재", () => {
    for (const l of MOCK_LAWS) for (const a of l.articles) for (const d of a.delegates ?? []) expect(exists(`${d.lawId}:${d.articleNo}`), `${l.id}:${a.no} → ${d.lawId}:${d.articleNo}`).toBe(true);
  });

  it("토픽의 근거 조문·인용 표식·단계 근거가 모두 존재", () => {
    for (const t of TOPICS) {
      for (const r of t.refs) expect(exists(r), `${t.id} refs ${r}`).toBe(true);
      for (const s of t.citizen.steps) if (s.ref) expect(exists(s.ref), `${t.id} step ${s.ref}`).toBe(true);
      for (const m of Array.from(t.citizen.summary.matchAll(/\[\[([^\]]+)\]\]/g))) expect(exists(m[1]), `${t.id} summary ${m[1]}`).toBe(true);
      expect(t.citizen.steps.length).toBe(3);
    }
  });
});

describe("공식 원문 스냅샷", () => {
  it("모든 내장 조문이 국가법령정보센터 원문 스냅샷으로 대체됨(사람이 쓴 본문이 그대로 노출되지 않음)", async () => {
    const snap = (await import("@/lib/law-api/mock/official-snapshot.json")).default as { fetchedAt: string; laws: Record<string, { articles: Record<string, unknown> }> };
    expect(snap.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await import("@/lib/law-api/mock/dataset-date")).MOCK_DATASET_DATE).toBe(snap.fetchedAt);
    for (const l of MOCK_LAWS) for (const a of l.articles) expect(snap.laws[l.id]?.articles[a.no], `${l.id}:${a.no}`).toBeDefined();
  });
  it("개정 반영 확인: 형법 사기 법정형, 임금체불 벌칙 조문, 층간소음 조정 절차", () => {
    const art = (id: string, no: string) => getMockLaw(id)!.articles.find((a) => a.no === no)!.text;
    expect(art("criminal-act", "347")).toContain("20년 이하의 징역 또는 5천만원 이하의 벌금");
    expect(art("labor-standards", "107")).toContain("제36조");
    expect(art("apartment-mgmt", "20")).toContain("층간소음관리위원회");
  });
});

describe("토픽 문장 ↔ 근거 대조(환각 가드)", () => {
  it("모든 토픽의 검수 문장에 쓰인 조문 표기가 그 토픽의 근거 조문에서 확인됨", async () => {
    const { findUnverifiedMentions } = await import("@/lib/answer/guard");
    const { toCitation } = await import("@/lib/law-api/util");
    for (const t of TOPICS) {
      const keys = Array.from(new Set([...t.refs, ...t.citizen.steps.map((s) => s.ref).filter((x): x is string => !!x)]));
      const cites = keys.map((k) => {
        const p = parseArticleKey(k)!;
        const law = getMockLaw(p.lawId)!;
        return toCitation(law, law.articles.find((a) => a.no === p.articleNo)!);
      });
      const text = [t.citizen.summary, t.officer.background, ...t.officer.keyPoints, ...t.officer.adminNotes].join("\n");
      expect(findUnverifiedMentions(text, cites), t.id).toEqual([]);
    }
  });
});
