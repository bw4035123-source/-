import { describe, expect, it } from "vitest";
import { enactDraft, purposeObject } from "@/lib/enact";

describe("제정 목적 → 목적 조문", () => {
  it.each([
    ["체계적 관리를 위하여 필요한 사항을 정함", "체계적 관리를 위하여 필요한 사항"],
    ["산업안전보건위원회 운영을 위하여 필요한", "산업안전보건위원회 운영을 위하여 필요한 사항"],
    ["직원의 재택근무 신청·승인과 복무 관리 기준을 정하기 위함", "직원의 재택근무 신청·승인과 복무 관리 기준"],
    ["직원의 재택근무 운영", "직원의 재택근무 운영에 관한 사항"],
    ["민원을 신속하게 처리하기 위함", "민원을 신속하게 처리하기 위하여 필요한 사항"],
    ["체계적 관리에 필요한 사항을 규정함.", "체계적 관리에 필요한 사항"],
  ])("%s", (inp, out) => expect(purposeObject(inp)).toBe(out));
  it("'필요한에 관한' 같은 비문이 나오지 않음", () => {
    for (const purpose of ["안전보건 업무의 체계적 관리를 위하여 필요한", "체계적 관리를 위하여 필요한 사항을 정함", "", "재택근무 운영"]) {
      const d = enactDraft({ name: "○○ 지침", kind: "행정규칙", purpose, items: [], terms: [], basis: [] } as never);
      expect(d.fullText).not.toMatch(/한에 관한|사항에 관한 사항|을 정에|를 정에/);
      expect(d.fullText).toMatch(/제1조\(목적\) 이 지침은 .+(을|를) 정함을 목적으로 한다\./);
    }
  });
});
