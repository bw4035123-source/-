import { describe, expect, it } from "vitest";
import SNAP from "@/lib/law-api/mock/old-and-new.json";
import { applyEdits, parseInstruction } from "@/lib/drafting";
import { impactOn, parseOldAndNew, parts, splitArticles } from "@/lib/upper-change";

const c = parseOldAndNew((SNAP as Record<string, unknown>)["근로기준법"])!;

describe("상위법 개정 전후 비교(신구법 비교 원자료)", () => {
  it("개정 정보와 조문 단위 신설·삭제·개정", () => {
    expect(c.law).toBe("근로기준법");
    expect(c.after).toMatchObject({ type: "일부개정", promulgated: "2026. 4. 7.", effective: "2026. 10. 8." });
    expect(c.added).toEqual(["제44조의4"]);
    expect(c.deleted).toEqual(["제102조", "제102조의2", "제103조", "제105조"]);
    expect(c.amended).toContain("제13조");
    // '(생 략)'·'(현행과 같음)' 줄과 바뀐 곳 없는 맥락 줄은 빠짐
    expect(c.rows.every((r) => !/생\s*략|현행과\s*같음/.test(r.old.map((p) => p.t).join("") + r.new.map((p) => p.t).join("")))).toBe(true);
  });
  it("바뀐 용어만 뽑고(근로감독관 → 노동감독관), 어미만 바뀐 말은 빼기", () => {
    expect(c.terms).toEqual([{ from: "근로감독관", to: "노동감독관", count: 18, articles: ["제13조", "제101조", "제104조", "제108조", "제116조"] }]);
  });
  it("<P> 표시를 조각으로", () => {
    expect(parts("가 <P>나</P> 다")).toEqual([{ t: "가 ", m: false }, { t: "나", m: true }, { t: " 다", m: false }]);
  });
});

describe("우리 규정 영향 점검", () => {
  const REG = `○○공단 취업규칙
제12조(근로감독 대응) ① 공단은 근로감독관의 현장조사에 협조한다.
② 「근로기준법」 제102조에 따라 근로감독관이 요구하면 서류를 제출한다.
제13조(신고자 보호) 「근로기준법」 제104조에 따라 통보한 직원에게 불리한 처우를 하지 아니한다.
제20조(임금 지급) 임금은 「근로기준법」 제43조에 따라 매월 지급한다.`;
  it("바뀌기 전 용어·삭제·개정된 조문 인용을 찾고, 용어는 개정 방향까지", () => {
    const hits = impactOn(REG, c);
    expect(hits.map((h) => h.article.label)).toEqual(["제12조(근로감독 대응)", "제13조(신고자 보호)"]);
    expect(hits[0].reasons.map((r) => r.kind)).toEqual(["용어", "인용-삭제"]);
    expect(hits[0].instruction).toBe("‘근로감독관’을 ‘노동감독관’으로 변경");
    expect(hits[1].reasons.map((r) => r.kind)).toEqual(["인용-개정"]);
    expect(hits[1].instruction).toBe("");
  });
  it("개정 방향은 개정 화면의 규칙으로 그대로 반영됨(모든 곳 치환)", () => {
    const a = splitArticles(REG)[0];
    const r = applyEdits(a.text, parseInstruction(impactOn(REG, c)[0].instruction));
    expect(r.applied).toHaveLength(1);
    expect(r.text).not.toContain("근로감독관");
    expect(r.text.split("노동감독관").length - 1).toBe(2);
  });
});

describe("개정이유에 상위법 개정 근거", () => {
  it("upperBasis가 있으면 ‘…에 맞추어’로 시작", async () => {
    const { reasonDraft } = await import("@/lib/drafting");
    const r = reasonDraft({ kind: "행정규칙", lawName: "○○공단 취업규칙", articleLabel: "제12조(근로감독 대응)", instruction: "‘근로감독관’을 ‘노동감독관’으로 변경", upperBasis: "「근로기준법」 일부개정(2026. 4. 7. 공포, 2026. 10. 8. 시행)" }, []);
    expect(r).toContain("「근로기준법」 일부개정(2026. 4. 7. 공포, 2026. 10. 8. 시행)에 맞추어 ‘근로감독관’을 ‘노동감독관’으로 변경 등");
  });
});
