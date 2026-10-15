import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArticles, parseCaseList, parseLawList } from "@/lib/law-api/drf";

/** 국가법령정보 DRF JSON 응답 형태(축약 샘플) */
const lawSearchSample = {
  LawSearch: {
    totalCnt: "2",
    law: [
      { 법령명한글: "주택임대차보호법", 법령일련번호: "111", 법령ID: "001", 법령구분명: "법률", 소관부처명: "법무부", 시행일자: "20230719", 현행연혁코드: "현행" },
      { 법령명한글: "주택임대차보호법 시행령", 법령일련번호: "222", 법령ID: "002", 법령구분명: "대통령령", 소관부처명: "법무부", 시행일자: "20230221", 현행연혁코드: "현행" },
    ],
  },
};

const lawServiceSample = {
  법령: {
    기본정보: { 법령명_한글: "주택임대차보호법" },
    조문: {
      조문단위: [
        { 조문여부: "전문", 조문내용: "제1장 총칙" },
        {
          조문여부: "조문",
          조문번호: "3",
          조문제목: "대항력 등",
          조문내용: "제3조(대항력 등)",
          항: [
            { 항내용: "① 임대차는 그 등기가 없는 경우에도 ..." },
            { 항내용: "② 주택도시기금을 ...", 호: [{ 호내용: "1. 첫째 호", 목: { 목내용: "가. 목 내용" } }] },
          ],
        },
        { 조문여부: "조문", 조문번호: "3", 조문가지번호: "2", 조문제목: "보증금의 회수", 조문내용: "제3조의2(보증금의 회수) ① 임차인이 ..." },
      ],
    },
  },
};

describe("DRF 응답 파서", () => {
  it("법령 목록", () => {
    const list = parseLawList(lawSearchSample);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: "주택임대차보호법", mst: "111", kind: "법률" });
  });

  it("조문: 전문 제외, 가지번호, 항·호·목 들여쓰기, 머리말 제거", () => {
    const arts = parseArticles(lawServiceSample);
    expect(arts.map((a) => a.no)).toEqual(["3", "3의2"]);
    expect(arts[0].text.split("\n")).toEqual(["① 임대차는 그 등기가 없는 경우에도 ...", "② 주택도시기금을 ...", "  1. 첫째 호", "    가. 목 내용"]);
    expect(arts[1].text.startsWith("① 임차인이")).toBe(true);
  });

  it("판례 목록 → 공개 주소(인증키 미포함)", () => {
    const cases = parseCaseList({ PrecSearch: { prec: { 사건명: "보증금반환", 사건번호: "2020다12345", 법원명: "대법원", 선고일자: "20210101" } } }, "판례");
    expect(cases[0].url).toContain("law.go.kr/판례/");
    expect(cases[0].url).not.toContain("OC=");
  });
});

describe("LawService 실시간 모드(fetch 모킹)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("연결 끊김은 재시도하고, 시행일자는 목록의 현행 시행일을 사용", async () => {
    const { LawService } = await import("@/lib/law-api/client");
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      calls++;
      const u = String(url);
      if (calls === 1) throw new TypeError("fetch failed"); // 첫 시도 연결 끊김
      if (u.includes("lawSearch.do"))
        return new Response(JSON.stringify({ LawSearch: { law: [{ 법령명한글: "행정심판법", 법령일련번호: "777", 시행일자: "20230321", 현행연혁코드: "현행" }] } }));
      return new Response(JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "행정심판법", 시행일자: "20280101" }, 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "27", 조문제목: "심판청구의 기간", 조문내용: "제27조(심판청구의 기간) ① 90일" }] } } }));
    }) as unknown as typeof fetch;
    const law = await new LawService("k").getLaw("admin-appeal");
    expect(law?.source).toBe("live");
    expect(law?.effectiveDate).toBe("20230321");
    expect(law?.articles.find((a) => a.no === "27")?.delegates).toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("판례: 사건명 검색이 부족하면 본문검색(search=2)으로 보완", async () => {
    const { LawService } = await import("@/lib/law-api/client");
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      urls.push(u);
      const fulltext = u.includes("search=2");
      if (u.includes("target=prec")) return new Response(JSON.stringify({ PrecSearch: { prec: fulltext ? [{ 사건명: "본문일치", 사건번호: "2025다1" }] : [] } }));
      return new Response(JSON.stringify({ Expc: { expc: [{ 안건명: "a", 안건번호: "1" }, { 안건명: "b", 안건번호: "2" }] } }));
    }) as unknown as typeof fetch;
    const cases = await new LawService("k").searchCases("층간소음");
    expect(cases.filter((c) => c.kind === "판례").map((c) => c.caseNo)).toEqual(["2025다1"]);
    expect(cases.filter((c) => c.kind === "법령해석례")).toHaveLength(2);
    expect(urls.some((u) => u.includes("target=expc") && u.includes("search=2"))).toBe(false);
  });
});

describe("판례 보기(상세) 파서", () => {
  it("판례: HTML 줄바꿈을 텍스트로, 태그 제거, 섹션 순서", async () => {
    const { parseCaseDetail, cleanCaseText } = await import("@/lib/law-api/drf");
    const d = parseCaseDetail(
      { PrecService: { 사건명: "부당해고구제재심판정취소", 사건번호: "2023두54914", 법원명: "대법원", 선고일자: "20260129", 판결유형: "판결", 판시사항: "<br/> [1] 근로자 판단 기준", 판결요지: "[1] 실질<br/>[2] 종속", 판례내용: "【원고】 <b>○○</b>&nbsp;조합" } },
      "판례",
      "616245",
    )!;
    expect(d.sections.map((s) => s.label)).toEqual(["판시사항", "판결요지", "판결 전문"]);
    expect(d.sections[1].text).toBe("[1] 실질\n[2] 종속");
    expect(d.sections[2].text).toBe("【원고】 ○○ 조합");
    expect(d.url).toContain("/판례/(2023%EB%91%9054914)");
    expect(cleanCaseText("<script>x</script>a&lt;b")).toBe("xa<b");
  });
  it("법령해석례: 질의요지·회답·이유", async () => {
    const { parseCaseDetail } = await import("@/lib/law-api/drf");
    const d = parseCaseDetail({ ExpcService: { 안건명: "공공기관 해당 여부", 안건번호: "08-0204", 해석기관명: "법제처", 해석일자: "20080724", 질의요지: "q", 회답: "a", 이유: "r" } }, "법령해석례", "311671")!;
    expect(d.sections.map((s) => s.label)).toEqual(["질의요지", "회답", "이유"]);
    expect(d.court).toBe("법제처");
  });
  it("목록에 상세 조회용 일련번호 포함", async () => {
    const { parseCaseList } = await import("@/lib/law-api/drf");
    expect(parseCaseList({ PrecSearch: { prec: [{ 사건명: "x", 사건번호: "1", 판례일련번호: "616245" }] } }, "판례")[0].id).toBe("616245");
  });
});

describe("실시간 원문 시간 예산", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  it("국가법령정보센터가 응답하지 않아도 예산 안에 공식 원문 스냅샷으로 답변", async () => {
    const { LawService } = await import("@/lib/law-api/client");
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch; // 영원히 응답 없음
    const svc = new LawService("k");
    const t0 = Date.now();
    const cites = await svc.getCitations(["apartment-mgmt:20", "floor-noise-rule:3"], 300);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(cites.map((c) => c.key)).toEqual(["apartment-mgmt:20", "floor-noise-rule:3"]);
    expect(cites.every((c) => c.source === "mock")).toBe(true);
    expect(svc.warnings.some((w) => w.includes("응답 지연"))).toBe(true);
  });
});
