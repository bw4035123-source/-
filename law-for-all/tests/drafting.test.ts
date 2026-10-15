import { describe, expect, it } from "vitest";
import { addendaDraft, applyEdits, consistencyChecks, diffWords, parseInstruction, procedureChecklist, reasonDraft } from "@/lib/drafting";

describe("개정 방향 해석", () => {
  it("A에서 B로 — 앞 명사를 잘못 잡지 않음", () => {
    expect(parseInstruction("처리기간을 7일에서 5일로 단축")).toEqual([{ type: "replace", from: "7일", to: "5일" }]);
  });
  it("한 단어 A을 B로 변경", () => {
    expect(parseInstruction("14일을 10일로 단축")).toEqual([{ type: "replace", from: "14일", to: "10일" }]);
    expect(parseInstruction("민원인을 신청인으로 변경")).toEqual([{ type: "replace", from: "민원인", to: "신청인" }]);
  });
  it("따옴표 표현·삭제·신설", () => {
    const e = parseInstruction("‘행정기관의 장’을 ‘시장ㆍ군수’로 변경하고, ‘특별한 사유가 없으면’ 삭제\n신설: ③ 처리기간은 공휴일을 제외한다.");
    expect(e).toEqual([
      { type: "replace", from: "행정기관의 장", to: "시장ㆍ군수" },
      { type: "delete", from: "특별한 사유가 없으면" },
      { type: "append", text: "③ 처리기간은 공휴일을 제외한다." },
    ]);
  });
});

describe("개정안 반영·대비", () => {
  const cur = "① 행정기관의 장은 질의민원을 7일 이내에 처리하여야 한다.";
  it("반영 및 찾지 못한 표현 보고", () => {
    const r = applyEdits(cur, [{ type: "replace", from: "7일", to: "5일" }, { type: "replace", from: "없는말", to: "x" }]);
    expect(r.text).toBe("① 행정기관의 장은 질의민원을 5일 이내에 처리하여야 한다.");
    expect(r.notFound).toHaveLength(1);
  });
  it("신설 시 다음 항 번호", () => {
    expect(applyEdits(cur, [{ type: "append", text: "새 항." }]).text.endsWith("② 새 항.")).toBe(true);
  });
  it("단어 단위 대비", () => {
    const d = diffWords(cur, cur.replace("7일", "5일"));
    expect(d.old.find((p) => p.op === "del")?.text).toBe("7일");
    expect(d.new.find((p) => p.op === "ins")?.text).toBe("5일");
  });
});

describe("정합성 점검", () => {
  it("상위법 기한 초과·규제 표현·인용 조문", () => {
    const checks = consistencyChecks({
      current: "① 공개 여부를 10일 이내에 결정하여야 한다.",
      amended: "① 공개 여부를 15일 이내에 결정하여야 한다. 위반 시 과태료를 부과한다. 제99조를 준용한다.",
      lawArticleNos: ["10", "11"],
      upper: [{ label: "「정보공개법」 제11조", text: "그 청구를 받은 날부터 10일 이내에 공개 여부를 결정하여야 한다." }],
    });
    const titles = checks.map((c) => c.title);
    expect(titles).toContain("상위법 기준 초과 가능");
    expect(titles).toContain("규제 신설·강화 여부 검토");
    expect(titles).toContain("인용 조문 확인");
  });
  it("변경 없음", () => {
    expect(consistencyChecks({ current: "a", amended: "a" })[0].title).toBe("변경 없음");
  });
});

describe("문서 초안", () => {
  const meta = { kind: "행정규칙" as const, lawName: "민원 처리 규정", articleLabel: "제5조(처리기간)", instruction: "처리기간 단축", effectiveDays: 30 };
  it("개정이유·부칙·절차", () => {
    expect(reasonDraft(meta, [{ type: "replace", from: "7일", to: "5일" }])).toContain("‘7일’을(를) ‘5일’(으)로 변경");
    expect(addendaDraft(meta)).toContain("공포 후 30일이 경과한 날부터");
    expect(procedureChecklist("자치법규")).toContain("지방의회 의결(조례)");
  });
});

describe("보완: 들여쓰기 보존·끝맺음 점검·개정이유 문장", () => {
  it("삭제 후에도 호(1.) 앞 들여쓰기 유지", () => {
    const cur = "① 장은 특별한 사유가 없으면 처리하여야 한다.\n  1. 법령 질의: 14일 이내";
    const r = applyEdits(cur, [{ type: "delete", from: "특별한 사유가 없으면" }]);
    expect(r.text).toBe("① 장은 처리하여야 한다.\n  1. 법령 질의: 14일 이내");
    const d = diffWords(cur, r.text);
    expect(d.new.filter((p) => p.op === "ins")).toHaveLength(0);
  });
  it("호로 끝나는 조문은 끝맺음 경고 없음", () => {
    const titles = consistencyChecks({ current: "가 한다.\n  1. a: 14일 이내", amended: "가 한다.\n  1. a: 10일 이내" }).map((c) => c.title);
    expect(titles).not.toContain("문장 끝맺음");
  });
  it("여러 줄 개정 방향을 한 문장으로", () => {
    const t = reasonDraft({ kind: "법령", lawName: "법", articleLabel: "제1조(목적)", instruction: "7일에서 5일로 단축\n‘사유’ 삭제\n신설: ③ x" }, []);
    expect(t).toContain("7일에서 5일로 단축, ‘사유’ 삭제 등 「법」 제1조(목적)의 내용을 정비하려는 것임.");
  });
});
