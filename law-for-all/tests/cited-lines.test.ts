import { describe, expect, it } from "vitest";
import { splitCitedSentences } from "@/components/law-search/cited-text";

describe("법도우미 문장 앞 근거 번호", () => {
  it("문장마다 나누고 표식은 그 문장 앞 번호로(마침표 앞·뒤 모두)", () => {
    const r = splitCitedSentences("계약 기간이 끝나도 임대차가 계속돼요 [[a:4]]. 임차권등기명령을 신청할 수 있어요.[[a:3의3]] 근거 없는 문장이에요. 둘 다 [[a:1]] [[a:2]].");
    expect(r).toEqual([
      { keys: ["a:4"], text: "계약 기간이 끝나도 임대차가 계속돼요." },
      { keys: ["a:3의3"], text: "임차권등기명령을 신청할 수 있어요." },
      { keys: [], text: "근거 없는 문장이에요." },
      { keys: ["a:1", "a:2"], text: "둘 다." },
    ]);
  });
  it("소수점·금액은 문장 경계로 보지 않음", () => {
    expect(splitCitedSentences("최대 1.5배까지 [[x:1]]. 끝.").map((x) => x.text)).toEqual(["최대 1.5배까지.", "끝."]);
  });
});
