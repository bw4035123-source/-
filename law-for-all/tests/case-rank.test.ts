import { describe, expect, it } from "vitest";
import { caseCoreTitle, rankCases } from "@/lib/law-api/case-rank";
import { liveCaseQuery } from "@/lib/law-api/search";
import type { CaseItem } from "@/lib/law-api/types";

const c = (kind: CaseItem["kind"], title: string, id: string): CaseItem => ({ kind, id, title, url: "" });

describe("판례·해석례 관련도 정리", () => {
  it("본문에만 낱말이 있는 엉뚱한 사건은 빼고, 제목이 맞는 것을 앞으로", () => {
    const items = [
      c("판례", "특수공무집행방해, 허위공문서작성, 대통령기록물관리에관한법률위반", "1"),
      c("판례", "공유재산사용허가취소처분취소", "2"),
      c("법령해석례", "고양시 - 기부채납 재산에 대하여 무상 사용·수익허가기간을 20년으로 정하여 허가하는 경우(「공유재산 및 물품 관리법」 제21조 관련)", "3"),
    ];
    expect(rankCases("공유재산 사용허가", items, 10).map((x) => x.id)).toEqual(["2", "3"]);
  });
  it("해석례 앞 질의기관 표기('민원인 - ')는 보지 않음 — '민원'이 '민원인'에 걸리지 않게", () => {
    expect(caseCoreTitle(c("법령해석례", "경기도 고양시ㆍ민원인 - 둘 이상의 주택건설대지를 대상으로 지역주택조합 설립", "x"))).toBe("둘 이상의 주택건설대지를 대상으로 지역주택조합 설립");
    const items = [c("법령해석례", "민원인 - 지역주택조합의 설립 인가", "1"), c("법령해석례", "민원인 - 법정민원의 처리기간을 연장하는 경우(「민원 처리에 관한 법률 시행령」 제21조)", "2")];
    expect(rankCases("민원 처리기간", items, 10).map((x) => x.id)).toEqual(["2"]);
  });
  it("여러 낱말이면 첫 낱말(중심어)이 제목에 있어야 — 곁가지 낱말만 같은 건 제외, 첫 낱말이 넓은 말이면 따지지 않음", () => {
    const items = [c("법령해석례", "광주광역시 서구 - 무기계약근로자 등 행정보조인력에게 인·허가 등의 업무를 분장할 수 있는지", "1"), c("법령해석례", "개인정보보호위원회 - 비상임위원이 겸직하려는 경우 별도의 허가 절차를 거쳐야 하는지 여부", "2")];
    expect(rankCases("겸직 허가", items, 10).map((x) => x.id)).toEqual(["2"]);
    expect(rankCases("공무원 선거운동", [c("판례", "국가공무원법위반·공직선거법위반", "1")], 10)).toHaveLength(1);
  });
  it("엄격한 규칙으로 하나도 안 남으면 낱말 앞뒤 두 글자로 느슨하게 — 관계없는 건은 여전히 제외", () => {
    const items = [c("판례", "취득세 중과세율 적용", "1"), c("판례", "스토킹범죄의처벌등에관한법률위반[수개월간 반복하여 고의로 소음을 발생시킨 행위]", "2"), c("법령해석례", "감사원 - 공동주택 각 층간 바닥충격음 기준이 적용되는 시점", "3")];
    expect(rankCases("층간소음", items, 10).map((x) => x.id)).toEqual(["2", "3"]);
    // 여러 낱말 검색어는 느슨한 일치를 쓰지 않음('공유재산 사용허가' → '공유관계'·'재산세' 사건 제외)
    expect(rankCases("공유재산 사용허가", [c("판례", "단독주택을 지분 취득한 경우 구분소유적 공유관계를 인정하여 세율을 적용할 수 있는지 여부", "1")], 10)).toHaveLength(0);
  });
  it("같은 제목은 한 번만", () => {
    const t = "국토교통부 - 공공임대주택 임차인의 재계약에 적용되는 법률(「공공주택 특별법」 제49조의3 등)";
    expect(rankCases("공공임대주택 재계약", [c("법령해석례", t, "1"), c("법령해석례", t, "2"), c("법령해석례", t, "3")], 10)).toHaveLength(1);
  });
  it("실시간 답변의 판례 검색어: 사전에 걸린 말 우선, 넓은 말·동사 꼬리 제외", () => {
    expect(liveCaseQuery("공무원 겸직 허가 기준")).toBe("겸직");
    expect(liveCaseQuery("택배가 분실됐는데 배상받을 수 있나요")).toBe("택배 분실");
    expect(liveCaseQuery("주차장에서 문콕 당했어요")).toBe("주차장 문콕");
    expect(liveCaseQuery("아르바이트 최저시급 못 받았어요")).toBe("최저임금");
  });
});
