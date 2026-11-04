import { describe, expect, it } from "vitest";
import { guardWrite, type WriteInput } from "@/lib/enact-write";

const IN: WriteInput = {
  name: "○○공단 산업안전보건 관리 지침",
  kind: "행정규칙",
  org: "○○공단",
  purpose: "안전보건 관리 기준을 정하기 위함",
  articles: [
    { label: "제5조(안전보건관리책임자 지정)", text: "○○공단의 장은 ○○의 운영 실태를 연 1회 이상 점검하여야 한다." },
    { label: "제6조(안전보건교육)", text: "○○공단의 장은 ○○에 관한 교육을 연 1회 이상 실시하여야 한다." },
    { label: "제7조(위원회)", text: "○○위원회를 둔다." },
    { label: "제8조(점검)", text: "○○을 점검한다." },
  ],
  basis: [{ label: "「산업안전보건법」 제29조(근로자에 대한 안전보건교육)", text: "사업주는 근로자에게 매분기 3시간 이상 안전보건교육을 하여야 한다." }],
};

describe("제정안 AI 작성 가드", () => {
  it("조문 머리를 떼고 본문만, 근거 밖 법령·새 벌칙·항 번호 오류는 표준 초안 유지", () => {
    const r = guardWrite(
      {
        articles: [
          { label: "제5조(안전보건관리책임자 지정)", text: "제5조(안전보건관리책임자 지정) ① ○○공단의 장은 안전보건관리책임자를 지정하여야 한다.\n② 안전보건관리책임자는 「산업안전보건법」 제29조에 따른 교육을 총괄한다." },
          { label: "제6조(안전보건교육)", text: "○○공단의 장은 「중대재해 처벌 등에 관한 법률」에 따라 교육한다." },
          { label: "제7조(위원회)", text: "위원회 결정을 어긴 자에게는 과태료를 부과한다." },
          { label: "제8조(점검)", text: "① 점검한다.\n③ 결과를 보고한다." },
        ],
      },
      IN,
    );
    expect(r.articles[0]).toMatchObject({ written: true });
    expect(r.articles[0].text.startsWith("①")).toBe(true);
    expect(r.articles.slice(1).every((a) => !a.written)).toBe(true);
    expect(r.rejected.map((x) => x.reason)).toEqual([expect.stringContaining("중대재해"), expect.stringContaining("제재"), expect.stringContaining("항 번호")]);
  });
  it("상위 조문에 없는 수치는 쓰되 확인 필요로", () => {
    const r = guardWrite({ articles: [{ label: "제6조(안전보건교육)", text: "○○공단의 장은 근로자에게 매분기 3시간 이상, 신규 채용 시 8시간 이상 교육을 하여야 한다." }] }, IN);
    expect(r.articles[1].written).toBe(true);
    expect(r.checks).toEqual([{ label: "제6조(안전보건교육)", values: ["8시간"] }]);
  });
});
