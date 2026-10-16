import { describe, expect, it } from "vitest";
import fx from "./fixtures/rules.json";
import { parseAdmrulDoc, parseOrdinDoc, splitRuleArticles, tidyRuleText } from "@/lib/law-api/drf";
import { articleLabel } from "@/lib/law-api/util";

describe("행정규칙·자치법규 파서(실제 응답)", () => {
  it("자치법규: 조문번호(000200)→제2조, 머리말 제거, 호 줄바꿈", () => {
    const d = parseOrdinDoc(fx.ordin, "ord-2118167");
    expect([d.name, d.kind, d.ministry]).toEqual(["강화군 공동주택 층간소음 방지 조례", "자치법규", "인천광역시 강화군 · 조례"]);
    expect(d.articles.map((a) => [a.no, a.title])).toEqual([["1", "목적"], ["2", "정의"], ["3", "군수의 책무"]]);
    expect(d.articles[1].text.split("\n")[1]).toMatch(/^ {2}1\. “공동주택”이란/);
    expect(d.revisionReason).toContain("층간소음");
  });
  it("행정규칙: 조문 형식이 아니면 '본문' 하나, 전각 공백 뒤 번호 줄바꿈, 이미지 태그 제거", () => {
    const d = parseAdmrulDoc(fx.admrul, "adm-2100000265232");
    expect([d.name, d.kind, d.ministry]).toEqual(["층간소음 전문기관 지정 고시", "행정규칙", "기후에너지환경부 · 고시"]);
    expect(d.articles).toHaveLength(1);
    expect(d.articles[0].no).toBe("본문");
    expect(articleLabel("본문")).toBe("본문");
    expect(d.articles[0].text).not.toContain("<img");
    expect(d.articles[0].text.split("\n")[1]).toMatch(/^2\. 재검토기한/);
  });
  it("행정규칙: 조문 형식(목록)은 제N조·제N조의M 단위로, 항·호 줄바꿈", () => {
    const d = parseAdmrulDoc(fx.admrulArticles, "adm-99");
    expect(d.articles.map((a) => a.no)).toEqual(["1", "2", "2의2"]);
    expect(d.articles[1].text).toBe("① 이 지침은 공무원에게 적용한다.\n② 다만, 다음 각 호는 제외한다.\n  1. 계약직2. 위촉직"); // 번호 앞에 마침표가 없으면 붙여 둠
    expect(splitRuleArticles(["앞 설명"])[0].no).toBe("본문");
    expect(tidyRuleText("가<br/>나")).toBe("가\n나");
  });
});
