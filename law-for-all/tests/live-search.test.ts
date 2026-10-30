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

describe("실시간 검색 법령의 이름 닮음 기준", async () => {
  const { lawNameLooksLike } = await import("@/lib/law-api/search");
  it("이름이 질문과 닮은 법령만 근거로(우연히 낱말 하나만 겹친 긴 이름은 제외)", () => {
    expect(lawNameLooksLike("최저임금법", ["최저임금", "알바"])).toBe(true);
    expect(lawNameLooksLike("건축법", ["건축허가", "필요"])).toBe(true);
    expect(lawNameLooksLike("학교폭력예방 및 대책에 관한 법률", ["학교폭력", "신고"])).toBe(true);
    expect(lawNameLooksLike("온라인투자연계금융업 및 이용자 보호에 관한 법률", ["온라인", "배송"])).toBe(false);
    expect(lawNameLooksLike("군사기밀 보호법", ["사기", "피해"])).toBe(false);
    expect(lawNameLooksLike("우주손해배상법", ["중고폰", "판매자", "손해배상"])).toBe(false);
    expect(lawNameLooksLike("디지털포용법", ["디지털", "리뷰"])).toBe(false);
    expect(lawNameLooksLike("자동차손해배상 보장법", ["자동차", "손해배상"])).toBe(true);
    expect(lawNameLooksLike("개인정보 보호법", ["개인정보", "유출"])).toBe(true);
  });
});

describe("실시간 검색과 함께 쓸 내장 조문 기준", async () => {
  const { strongLocalHit } = await import("@/lib/law-api/search");
  const { getMockLaw } = await import("@/lib/law-api/mock");
  const hit = (key: string, q: string) => {
    const [law, no] = key.split(":");
    const a = getMockLaw(law)!.articles.find((x) => x.no === no)!;
    return strongLocalHit(a.title, a.keywords ?? [], q);
  };
  it("두 글자 키워드 하나만 겹친 다른 법은 빼고, 질문과 확실히 맞는 조문은 남김", () => {
    expect(hit("public-property:21", "운전면허 갱신은 어떻게 하나요")).toBe(false);
    expect(hit("anti-graft:9", "택배가 분실됐는데 반환받을 수 있나요")).toBe(false);
    expect(hit("criminal-act:347", "친구가 단톡방에서 저한테 욕을 했어요 고소할 수 있나요")).toBe(false);
    expect(hit("criminal-act:347", "중고거래 사기를 당했어요")).toBe(true);
    expect(hit("criminal-act:311", "친구가 단톡방에서 저한테 욕을 했어요 고소할 수 있나요")).toBe(true);
    expect(hit("criminal-act:260", "길에서 모르는 사람한테 맞았어요")).toBe(true);
    expect(hit("labor-standards:28", "한국소비자원에 피해구제 신청은 어떻게 하나요")).toBe(false);
  });
});
