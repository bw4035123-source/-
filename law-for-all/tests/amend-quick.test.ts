import { describe, expect, it } from "vitest";
import { diffCells, quickMarkdown, splitQuick } from "@/lib/amend-quick";

describe("한 번에 개정", () => {
  it("요청 문장과 조문을 나눔", () => {
    const r = splitQuick("제5조(처리기간) ① 민원은 7일 안에 처리해야 한다.\n② 한번 연장할 수 있다.\n제 6 조 (결과 통지) 문서로 통지해야 한다.\n개정해줘");
    expect(r.request).toBe("개정해줘");
    expect(r.articles.map((a) => a.label)).toEqual(["제5조(처리기간)", "제6조(결과 통지)"]);
    expect(r.articles[0].text).toContain("\n② 한번");
  });
  it("구체 요청·조 머리 없는 조문", () => {
    const r = splitQuick("민원은 7일 안에 처리한다.\n7일을 5일로 수정해주세요.");
    expect(r.request).toBe("7일을 5일로 수정해주세요.");
    expect(r.articles).toEqual([{ label: "(조문)", text: "민원은 7일 안에 처리한다." }]);
  });
  it("요청 문장이 없으면 기본 '개정해줘'", () => {
    expect(splitQuick("제1조(목적) 이 규정은 목적을 정한다.").request).toBe("개정해줘");
  });
  it("신·구 대비: 바뀐 말만 굵게, 줄바꿈은 <br>", () => {
    const c = diffCells("① 7일 안에 처리해야 한다.\n② 끝", "① 7일 이내에 처리하여야 한다.\n② 끝");
    expect(c.old).toContain("**");
    expect(c.new).toContain("**");
    expect(c.new).toContain("<br>");
    expect(c.new).not.toContain("\n");
  });
  it("3가지 양식 마크다운", () => {
    const md = quickMarkdown("처리기간 문구를 정비함.", [{ label: "제5조(처리기간)", current: "a|b 해야 한다.", amended: "a|b 하여야 한다." }]);
    expect(md).toMatch(/\*\*1\. \[개정 이유 및 핵심 요약\]\*\*[\s\S]*\*\*2\. \[개정 조문 전문\]\*\*[\s\S]*\*\*3\. \[신·구조문대비표\]\*\*/);
    expect(md).toContain("| 현행 | 개정안 |");
    expect(md).toContain("a\\|b");
  });
});
