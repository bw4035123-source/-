import { describe, expect, it } from "vitest";
import { guardFill, matchFill, settleParticles } from "@/lib/enact-fill";

const input = {
  name: "○○공단 외부강의등 신고 처리 지침",
  kind: "행정규칙",
  purpose: "",
  basis: [{ label: "「부정청탁 및 금품등 수수의 금지에 관한 법률」 제10조(외부강의등의 사례금 수수 제한)", text: "② 외부강의등을 마친 날부터 10일 이내에 서면으로 신고하여야 한다." }],
  articles: [
    { label: "제3조(적용 범위)", text: "이 지침은 ○○공단 소속 ○○에 대하여 적용한다." },
    { label: "제5조(신고 절차)", text: "① ○○을(를) 하려는 사람은 ○○ 서식에 따라 기관의 장에게 신고하여야 한다.\n② 기관의 장은 신고를 받은 날부터 ○일 이내에 처리 결과를 알려야 한다." },
    { label: "제7조(반환)", text: "① ○○을(를) 받은 사람은 ○일 이내에 반환하여야 한다." },
    { label: "제8조(점검)", text: "① 기관의 장은 ○○의 운영 실태를 연 ○회 이상 점검하여야 한다." },
  ],
};

describe("제정안 AI 채우기 가드", () => {
  it("빈칸만 채운 값을 뽑고 겸용 조사를 정리, 줄바꿈 유지", () => {
    expect(matchFill("이 지침은 ○○공단 소속 ○○에 대하여 적용한다.", "이 지침은 ○○공단 소속 임직원에 대하여 적용한다.")).toEqual(["○○", "임직원"]);
    expect(settleParticles("외부강의등을(를) 하려는 ○○을(를)")).toBe("외부강의등을 하려는 ○○을(를)");
    const r = guardFill({ articles: [{ label: "제5조(신고 절차)", text: "① 외부강의등을 하려는 사람은 별지 제1호 서식에 따라 기관의 장에게 신고하여야 한다. ② 기관의 장은 신고를 받은 날부터 7일 이내에 처리 결과를 알려야 한다." }] }, input);
    const a = r.articles.find((x) => x.label === "제5조(신고 절차)")!;
    expect(a.values).toEqual(["외부강의등", "별지 제1호", "7일"]);
    expect(a.text).toBe("① 외부강의등을 하려는 사람은 별지 제1호 서식에 따라 기관의 장에게 신고하여야 한다.\n② 기관의 장은 신고를 받은 날부터 7일 이내에 처리 결과를 알려야 한다.");
    expect(r.rejected).toEqual([]);
  });
  it("빈칸 밖 변경·근거 밖 법령 인용·새 제재는 버리고, 상위 기준 초과는 경고", () => {
    const r = guardFill(
      {
        articles: [
          { label: "제5조(신고 절차)", text: "① 외부강의등을 하려는 사람은 별지 서식에 따라 기관의 장에게 신고하여야 한다. ② 기관의 장은 신고를 받은 날부터 14일 이내에 처리 결과를 알려야 한다." },
          { label: "제7조(반환)", text: "① 「근로기준법」 제9조에 따른 금품을 받은 사람은 2일 이내에 반환하여야 한다." },
          { label: "제8조(점검)", text: "① 이사장은 외부강의등의 운영 실태를 연 1회 이상 점검하여야 한다." },
          { label: "제3조(적용 범위)", text: "이 지침은 ○○공단 소속 직원에 대하여 적용하며 위반 시 과태료를 부과한다." },
        ],
      },
      input,
    );
    expect(r.rejected.map((x) => x.label)).toEqual(["제3조(적용 범위)", "제7조(반환)", "제8조(점검)"]);
    expect(r.rejected.find((x) => x.label === "제7조(반환)")!.reason).toContain("근로기준법");
    expect(r.warnings[0]).toContain("14일");
    expect(r.articles.find((x) => x.label === "제7조(반환)")!.text).toBe(input.articles[2].text);
  });
});
