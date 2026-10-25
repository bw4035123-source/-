import { describe, expect, it } from "vitest";
import { maskPII } from "@/lib/privacy-mask";
import { ask } from "@/lib/answer/ask";

describe("질문 속 개인정보 가리기", () => {
  it("주민등록번호·전화번호·카드·계좌·이메일·여권번호를 가림", () => {
    const r = maskPII("제 주민번호는 900101-1234567이고 010-1234-5678로 연락주세요. 국민은행 123456-01-234567, 카드 1234-5678-9012-3456, a.b@test.co.kr, 여권 M12345678");
    expect(r.text).not.toMatch(/\d{6}-\d{7}|010-1234|123456-01|1234-5678-9012|@test|M12345678/);
    expect(r.found).toEqual(["주민등록번호", "카드번호", "전화번호", "이메일", "계좌번호", "여권번호"]);
    expect(maskPII("집주인 번호 01098765432 이에요").found).toEqual(["전화번호"]);
    expect(maskPII("02-123-4567 사무실").found).toEqual(["전화번호"]);
  });

  it("날짜·금액·혈중알코올농도·조문 번호는 그대로", () => {
    for (const q of ["2026-10-25에 계약 끝나요", "보증금 2억 3000만원", "음주운전 0.03 걸리면", "제3조의2 대항력", "2025년 10월 1일부터 30일까지", "시급 10,030원"]) {
      expect(maskPII(q)).toEqual({ text: q, found: [] });
    }
  });

  it("가린 질문으로 검색하고 안내를 붙임(근거는 그대로)", async () => {
    const r = await ask({ query: "집주인(010-1234-5678)이 전세 보증금을 안 돌려줘요", mode: "citizen" });
    expect(r.query).not.toContain("010-1234-5678");
    expect(r.notices[0]).toContain("전화번호");
    expect(r.topic?.id).toBe("deposit-return");
  });
});
