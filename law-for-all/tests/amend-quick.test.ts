import { describe, expect, it } from "vitest";
import { diffCells, isBareRequest, limitWarning, quantityWarning, quickMarkdown, splitQuick } from "@/lib/amend-quick";

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

describe("한 번에 개정 — 보완", () => {
  it("굵게 이어 붙일 때 띄어쓰기 유지", () => {
    const c = diffCells("민원은 접수한날부터 7일안에 처리해야 한다.", "민원은 접수한 날부터 7일 이내에 처리하여야 한다.");
    expect(c.old.replace(/\*\*/g, "")).toBe("민원은 접수한날부터 7일안에 처리해야 한다.");
    expect(c.new.replace(/\*\*/g, "")).toBe("민원은 접수한 날부터 7일 이내에 처리하여야 한다.");
  });
  it("구체 요청 없이 수치가 바뀌면 경고", () => {
    expect(isBareRequest("개정해줘")).toBe(true);
    expect(isBareRequest("7일을 5일로 수정해줘")).toBe(false);
    expect(quantityWarning("개정해줘", "7일 안에 처리", "14일 이내에 처리")).toContain("삭제 7일 / 추가 14일");
    expect(quantityWarning("개정해줘", "7일안에", "7일 이내에")).toBeNull();
    expect(quantityWarning("7일을 5일로 수정해줘", "7일", "5일")).toBeNull();
  });
});

describe("한 번에 개정 — 기준 완화 경고", () => {
  it("한 번 연장 제한이 빠지면 경고, 표현만 바뀌면 통과", () => {
    expect(limitWarning("개정해줘", "한번 연장할 수 있다", "연장할 수 있다")).toContain("한차례");
    expect(limitWarning("개정해줘", "한번 연장할수 있다", "한 차례 연장할 수 있다")).toBeNull();
    expect(limitWarning("개정해줘", "7일까지 처리", "7일 이내에 처리")).toBeNull();
    expect(limitWarning("연장 제한을 없애줘", "한번 연장", "연장")).toBeNull();
  });
});

it("새 수치를 담은 상위 조문을 밝힘", () => {
  const w = quantityWarning("개정해줘", "1년 미만이면 주지 않는다", "1년 미만이면 1개월 개근 시 1일을 준다", [{ label: "「근로기준법」 제60조(연차 유급휴가)", text: "1년 미만인 근로자에게 1개월 개근 시 1일의 유급휴가를 주어야 한다" }]);
  expect(w).toContain("「근로기준법」 제60조");
  expect(w).toContain("추가 1개월, 1일");
});
