import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/live-search.json";

/**
 * 내장 토픽 밖 질문 → 법제처 Open API 전체 법령 검색 순위.
 * 실제 API 응답을 저장한 고정 데이터(tests/fixtures/live-search.json)로 네트워크 없이 재현한다.
 */
const FX = fixture as Record<string, unknown>;
const keyOf = (u: URL) => {
  const p = Array.from(u.searchParams.entries()).filter(([k]) => k !== "OC" && k !== "type");
  p.sort(([a], [b]) => a.localeCompare(b));
  return `${u.pathname.split("/").pop()}?${new URLSearchParams(p).toString()}`;
};

describe("실시간 전체 법령 검색(토픽 밖 질문)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const k = keyOf(new URL(String(url)));
      if (!(k in FX)) return new Response(JSON.stringify({ result: "없음", msg: k }), { status: 200 });
      return new Response(JSON.stringify(FX[k]));
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const cases: [string, string, string][] = [
    ["반려견 목줄 안하면 과태료 있나요", "동물보호법", "16"],
    ["청소년에게 술 팔면 처벌받나요", "청소년 보호법", "28"],
    ["건축허가 받으려면 뭐가 필요해요", "건축법", "11"],
    ["학교폭력 신고하면 어떻게 처리되나요", "학교폭력예방 및 대책에 관한 법률", "20"],
    ["주차장 설치 기준은 어떻게 되나요?", "주차장법", "12"],
  ];
  it.each(cases)("%s → 「%s」 제%s조", async (q, law, no) => {
    const { LawService } = await import("@/lib/law-api/client");
    const svc = new LawService("test");
    const keys = await svc.searchLiveKeys(q, 60000);
    const cites = await svc.getCitations(keys, 0);
    expect(cites.map((c) => `${c.lawName}:${c.articleNo}`)).toContain(`${law}:${no}`);
  });
});
