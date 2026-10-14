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
