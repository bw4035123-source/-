import { describe, expect, it } from "vitest";
import { commaBreak, koreanWrap, unwrapKorean } from "@/lib/korean-wrap";

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

describe("commaBreak 안내 글 쉼표 줄바꿈", () => {
  const cb = commaBreak;
  it("구절 쉼표 뒤에서 줄바꿈", () => {
    expect(cb("상위법이 개정되면 개정 전·후 조문을 나란히 보여 주고, 우리 규정에서 바뀌기 전 용어를 찾아요")).toBe("상위법이 개정되면 개정 전·후 조문을 나란히 보여 주고,\n우리 규정에서 바뀌기 전 용어를 찾아요");
    expect(cb("대한민국 모든 현행 법령을 국가법령정보 ‘법령 목록’에서 찾아, 고른 법령의 가장 최근 개정을 보여 줘요")).toContain("찾아,\n고른");
  });
  it("괄호·따옴표 안, 숫자, 짧은 나열은 그대로", () => {
    expect(cb("부서·담당자 정보(예: 경영지원팀, 총무팀)는 이 브라우저에만 저장돼요")).not.toContain("\n");
    expect(cb("제1항, 제2항에 따라 처리합니다")).not.toContain("\n");
    expect(cb("1, 2, 3단계로 진행해요 그다음 확인해요")).not.toContain("\n");
    expect(cb("한글, Word 파일로 내려받으세요")).not.toContain("\n");
  });
  it("복사하면 원래 글", () => {
    const s = "상위법이 개정되면 조문을 나란히 보여 주고, 우리 규정에서 영향을 받는 조문을 찾아요";
    expect(unwrapKorean(cb(s))).toBe(s);
  });
});

describe("commaBreak 다시 다듬기·앞 글", () => {
  it("이미 바꾼 글을 다시 다듬어도 짧은 나열은 그대로", () => {
    const once = commaBreak("근거 밖 인용 자동 제거, 원문 대조, 인용 표기 복사로 공문서에 바로 활용");
    expect(commaBreak(once)).toBe(once);
    expect(once.split("\n")).toHaveLength(1);
  });
  it("앞 요소의 글까지 세어 쉼표 뒤 줄바꿈", () => {
    expect(commaBreak("하고, AI 변호사·검사·판사의 시각으로 각각 검토해 드려요", "상황을 이야기하면 관련 법령을 추천")).toBe("하고,\nAI 변호사·검사·판사의 시각으로 각각 검토해 드려요");
  });
});

describe("commaBreak 나열", () => {
  it("짧은 말 나열은 문장 끝까지 그대로, 다음 문장은 다시", () => {
    expect(commaBreak("조문 체계와 표준 조문 초안, 위임 사항 대조, 제정이유·입법예고문 초안을 만들어 드려요")).not.toContain("\n");
    expect(commaBreak("판례, 해석례를 찾아요. 업무 쟁점의 법령해석례와 판례를 찾아, 검토보고서에 쓸 요지를 가져가세요")).toBe("판례, 해석례를 찾아요. 업무 쟁점의 법령해석례와 판례를 찾아,\n검토보고서에 쓸 요지를 가져가세요");
  });
});

describe("괄호 뒤 조사", () => {
  it("닫는 괄호와 조사 사이에 줄바꿈 금지", () => {
    expect(koreanWrap("개정 전·후 조문(신구법 비교)을 가져와요")).toContain(")⁠을");
    expect(unwrapKorean(koreanWrap("조문(신구법 비교)을 가져와요"))).toBe("조문(신구법 비교)을 가져와요");
  });
});
