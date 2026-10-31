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

describe("규정 제정 — 조문 체계·표준 조문·위임 사항", async () => {
  const { enactDraft, delegatedMatters, unitOf } = await import("@/lib/enact");
  it("규범 이름에 맞는 자기 지칭", () => {
    expect(unitOf("행정규칙", "○○공단 재택근무 운영 지침")).toBe("지침");
    expect(unitOf("자치법규", "○○구 청년 지원 조례")).toBe("조례");
    expect(unitOf("행정규칙", "○○공단 보수 규정")).toBe("규정");
  });
  it("상위 조문에서 이 규범 종류로 위임한 사항만 찾음", () => {
    const t = "① 감면의 대상·기준 및 절차에 필요한 사항은 조례로 정한다.\n② 그 밖에 신고에 관하여 필요한 사항은 대통령령으로 정한다.";
    expect(delegatedMatters(t, "자치법규")).toEqual(["감면의 대상·기준 및 절차"]);
    expect(delegatedMatters(t, "법령")).toEqual(["신고"]);
  });
  it("목적·적용 범위·실체 조문·세부 사항·부칙 순 조문 체계", () => {
    const d = enactDraft({ kind: "행정규칙", name: "○○공단 재택근무 운영 지침", purpose: "직원의 재택근무 신청·승인과 복무 관리 기준을 정하기 위함", items: ["신청 절차", "정보 보안"], terms: ["재택근무"], basis: [], org: "○○공단" });
    expect(d.articles.map((a) => a.label)).toEqual(["제1조(목적)", "제2조(정의)", "제3조(적용 범위)", "제4조(신청 절차)", "제5조(정보 보안)", "제6조(세부 사항)"]);
    expect(d.articles[0].text).toBe("이 지침은 직원의 재택근무 신청·승인과 복무 관리에 관한 사항을 정함을 목적으로 한다.");
    expect(d.articles[1].text).toContain("“재택근무”란");
    expect(d.articles[3].text).toContain("○○공단의 장에게 신청하여야 한다");
    expect(d.addenda).toContain("이 지침은 발령한 날부터 시행한다.");
    expect(d.steps).toContain("유사 규정 조사(다른 기관 규정·자치법규)");
  });
  it("담을 내용을 비우면 위임 사항을 조문으로 배정하고, 빠진 위임 사항·위임 없는 의무 부과를 알림", () => {
    const basis = [{ label: "「○○법」 제9조(감면)", text: "③ 감면의 대상·기준 및 절차에 필요한 사항은 조례로 정한다." }];
    const auto = enactDraft({ kind: "자치법규", name: "○○구 사용료 감면 조례", purpose: "", items: [], terms: [], basis });
    expect(auto.articles.some((a) => a.label.startsWith("제") && a.label.includes("감면의 대상"))).toBe(true);
    expect(auto.delegated[0].covered).toBe(true);
    expect(auto.articles[0].text).toContain("「○○법」 제9조에 따라");
    const miss = enactDraft({ kind: "자치법규", name: "○○구 사용료 감면 조례", purpose: "", items: ["교육"], terms: [], basis });
    expect(miss.checks.some((c) => c.title === "위임 사항 누락 가능")).toBe(true);
    const burden = enactDraft({ kind: "자치법규", name: "○○구 금연 조례", purpose: "흡연자에게 과태료를 부과하기 위함", items: [], terms: [], basis: [] });
    expect(burden.checks.some((c) => c.title === "법률 위임 필요" && c.detail.includes("지방자치법"))).toBe(true);
  });
});

describe("조 번호 정리 — 신설·삭제에 따른 인용 정정", async () => {
  const { renumber } = await import("@/lib/renumber");
  const T = "제1조(목적) 목적.\n제2조(정의) 「민원 처리에 관한 법률」 제2조에 따른다.\n제3조(접수) ① 제4조에 따른 서식으로 접수한다.\n② 제5조제1항의 기간에 따른다.\n제4조(서식) 별지 서식에 따른다.\n제5조(처리기간) ① 7일 이내. ② 법 제17조에 따른다.\n제6조(이의신청) 제5조에 따르며 제9조를 준용한다.";
  it("신설: 뒤 조문 번호와 같은 규정 안 인용만 정정(다른 법령 인용은 그대로), 없는 조문 인용은 기존 오류로", () => {
    const r = renumber(T, { type: "insert", at: 4 });
    expect(r.fixes.map((f) => `${f.from}→${f.to}`)).toEqual(["제4조→제5조", "제5조→제6조", "제5조→제6조"]);
    expect(r.text).toContain("「민원 처리에 관한 법률」 제2조");
    expect(r.text).toContain("법 제17조");
    expect(r.text).toContain("제4조(○○) (신설할 조문)\n제5조(서식)");
    expect(r.broken.map((f) => f.from)).toEqual(["제9조"]);
  });
  it("삭제: 뒤 번호를 당기고, 삭제 조문을 가리키던 인용은 '정비 필요'로 표시", () => {
    const r = renumber(T, { type: "delete", no: 4 });
    expect(r.fixes.map((f) => `${f.from}→${f.to}`)).toEqual(["제5조→제4조", "제5조→제4조"]);
    expect(r.dangling.map((f) => f.where)).toEqual(["제3조(접수)"]);
    expect(r.text).toContain("【삭제된 제4조 인용 — 정비 필요】");
    expect(r.text).not.toContain("별지 서식에 따른다");
  });
});
