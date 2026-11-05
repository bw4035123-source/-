import { describe, expect, it } from "vitest";
import { koreanWrap, unwrapKorean } from "@/lib/korean-wrap";

const show = (s: string) => koreanWrap(s).replace(/\u00A0/g, "~").replace(/[\u200B\u2060]/g, "");

describe("koreanWrap", () => {
  it("앞말에 기대는 짧은 말을 붙임", () => {
    expect(show("결과를 맹신하지 말고, 중요한 결정 전에는 반드시 변호사 등 전문가의 자문을 받으세요")).toBe("결과를 맹신하지~말고, 중요한 결정~전에는 반드시 변호사~등 전문가의 자문을 받으세요");
    expect(show("직접 고칠 수 있어요")).toBe("직접 고칠~수~있어요");
    expect(show("확인하지 못했어요")).toBe("확인하지~못했어요");
    expect(show("공포 후 30 일")).toBe("공포~후 30~일");
    expect(show("검토할 때 쓰는 것")).toBe("검토할~때 쓰는~것");
  });
  it("비슷한 낱말은 그대로", () => {
    expect(show("중요한 전문가 수수료 등기 데이터 후보")).toBe("중요한 전문가 수수료 등기 데이터 후보");
    expect(show("2026. 3. 12. 시행")).toBe("2026.~3.~12. 시행");
  });
  it("복사하면 원래 글", () => {
    const s = "괴롭힘·성희롱을 맹신하지 말고 할 수 있어요";
    expect(unwrapKorean(koreanWrap(s))).toBe(s);
  });
});

describe("koreanWrap 이름표", () => {
  it("dots=false 면 가운뎃점은 그대로, 공백 규칙만", () => {
    const out = koreanWrap("협약과 어긋나지 않는지·작성", false);
    expect(out).not.toMatch(/[⁠​]/);
    expect(out).toContain("어긋나지 않는지");
  });
});
