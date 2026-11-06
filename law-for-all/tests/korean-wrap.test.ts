import { describe, expect, it } from "vitest";
import { bindListItems, koreanWrap, unwrapKorean } from "@/lib/korean-wrap";

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

describe("괄호 뒤 조사", () => {
  it("닫는 괄호와 조사 사이에 줄바꿈 금지", () => {
    expect(koreanWrap("개정 전·후 조문(신구법 비교)을 가져와요")).toContain(")⁠을");
    expect(unwrapKorean(koreanWrap("조문(신구법 비교)을 가져와요"))).toBe("조문(신구법 비교)을 가져와요");
  });
});

describe("강제 줄바꿈 없음 · 쉼표 나열 항목 묶기", () => {
  const show = (t: string) => koreanWrap(t).replace(/\u00A0/g, "~").replace(/\u2060/g, "").replace(/\u200B/g, "|");
  it("줄바꿈 문자를 넣지 않음", () => {
    const t = "상위법이 개정되면 개정 전·후 조문을 나란히 보여 주고, 우리 규정에서 바뀌기 전 용어를 찾아요";
    expect(koreanWrap(t)).not.toContain("\n");
  });
  it("짧은 나열 항목은 안에서 갈라지지 않고 쉼표 뒤에서만", () => {
    expect(show("바꾸고 싶은 내용을 말하듯 적으면 개정안, 신·구조문 대비표, 상위법 정합성 점검, 개정이유·부칙·입법예고문 초안을 한 번에 만들어 드려요.")).toBe(
      "바꾸고 싶은 내용을 말하듯 적으면 개정안, 신·구조문~대비표, 상위법~정합성~점검, 개정이유·|부칙·|입법예고문 초안을 한 번에 만들어 드려요.",
    );
  });
  it("묶은 항목의 가운뎃점 뒤에도 줄바꿈 금지", () => {
    expect(koreanWrap("적으면 개정안, 신·구조문 대비표, 상위법 점검, 그리고 나머지 설명")).toContain("신\u2060·\u2060구조문");
  });
  it("긴 구절·문장이 낀 항목은 묶지 않음", () => {
    const t = "주의, 이 항목은 아주 길어서 한 줄에 다 들어가지 않을 수도 있는 설명입니다, 끝";
    expect(bindListItems(t)).toBe(t);
  });
  it("복사하면 원래 글", () => {
    const t = "개정안, 신·구조문 대비표, 상위법 정합성 점검, 개정이유 초안";
    expect(unwrapKorean(koreanWrap(t))).toBe(t);
  });
});

describe("sentenceBreak 문장마다 새 줄", () => {
  it("마침표 뒤에서만, 소수점·주소는 그대로", async () => {
    const { sentenceBreak } = await import("@/lib/korean-wrap");
    expect(sentenceBreak("법원의 판결이 아닙니다. AI 결과를 맹신하지 말고, 자문을 받으세요(대한법률구조공단 ☎132).")).toBe("법원의 판결이 아닙니다.\nAI 결과를 맹신하지 말고, 자문을 받으세요(대한법률구조공단 ☎132).");
    expect(sentenceBreak("EXAONE 3.5 모델과 www.law.go.kr 에서 확인")).not.toContain("\n");
    expect(unwrapKorean(sentenceBreak("아닙니다. 확인하세요."))).toBe("아닙니다. 확인하세요.");
  });
});
