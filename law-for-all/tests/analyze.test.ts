import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSPECTIVES } from "@/lib/law-api/mock/perspectives";
import { TOPICS } from "@/lib/law-api/mock/topics";
import { getMockLaw } from "@/lib/law-api/mock";
import { parseArticleKey } from "@/lib/law-api/util";
import { buildRuleAnalyses, collectKeys, evaluateRequirement, rankRecommendations, spotIssues } from "@/lib/answer/analyze-core";
import { extractFacts } from "@/lib/answer/facts";

const exists = (key: string) => {
  const p = parseArticleKey(key)!;
  return !!getMockLaw(p.lawId)?.articles.some((a) => a.no === p.articleNo);
};

const JEONSE =
  "전세 2억 5천만원에 빌라에 살고 있는데 계약이 지난달 만료됐어요. 집주인이 보증금을 안 돌려주고 연락 두절이에요. 알고 보니 집이 경매에 넘어갔고 다른 세입자들도 피해자래요. 전입신고는 했고 확정일자도 받았어요.";

describe("3관점 지식베이스 무결성", () => {
  it("모든 토픽에 관점 데이터가 있음", () => {
    for (const t of TOPICS) expect(PERSPECTIVES[t.id], t.id).toBeDefined();
  });
  it("관점 문장·요건·추가근거의 조문 키가 모두 실존", () => {
    for (const [id, p] of Object.entries(PERSPECTIVES)) {
      for (const k of p.extraRefs ?? []) expect(exists(k), `${id} extra ${k}`).toBe(true);
      for (const r of p.judge.requirements) if (r.ref) expect(exists(r.ref), `${id} req ${r.ref}`).toBe(true);
      for (const m of Array.from(JSON.stringify(p).matchAll(/\[\[([^\]]+)\]\]/g))) expect(exists(m[1]), `${id} ${m[1]}`).toBe(true);
    }
  });
});

describe("사실관계 추출", () => {
  it("당사자·금액·시점·행위", () => {
    const f = extractFacts(JEONSE);
    const v = (k: string) => f.filter((x) => x.kind === k).map((x) => x.value);
    expect(v("당사자")).toEqual(expect.arrayContaining(["임대인(집주인)", "임차인(세입자)"]));
    expect(v("금액")).toContain("2억5천만원");
    expect(v("기간·시점")).toContain("지난달");
    expect(v("행위·사건")).toEqual(expect.arrayContaining(["금전 미지급·미반환", "경매·공매 진행", "기망·연락 두절 정황"]));
  });
  it("혈중알코올농도 수치", () => {
    expect(extractFacts("0.052%가 나왔어요").map((x) => x.value)).toContain("혈중알코올농도 0.052%");
  });
});

describe("쟁점 발견·법령 추천", () => {
  it("복합 상황에서 여러 쟁점을 함께 발견", () => {
    const ids = spotIssues(JEONSE).map((i) => i.topic.id);
    expect(ids).toEqual(expect.arrayContaining(["jeonse-fraud", "deposit-return"]));
    expect(ids).not.toContain("lease-renewal"); // '2억 5천'의 5가 '5%'로 오인되지 않음
  });
  it("추천 순위: 핵심 조문 상위 + 사유 + 관련도", () => {
    const issues = spotIssues(JEONSE);
    const recs = rankRecommendations(JEONSE, issues, collectKeys(JEONSE, issues));
    expect(recs[0].relevance).toBe("high");
    expect(recs.slice(0, 3).map((r) => r.key)).toEqual(expect.arrayContaining(["housing-lease:3의2", "housing-lease:3"]));
    expect(recs.map((r) => r.key)).toEqual(expect.arrayContaining(["housing-lease:3의3", "criminal-act:347"]));
    expect(recs.find((r) => r.key === "criminal-act:347")!.reason).toContain("위법성·처벌");
    expect(recs.find((r) => r.key === "jeonse-fraud:3")!.reason).not.toContain("처벌");
  });
  it("임금체불 상황 → 금품청산 + 벌칙 조문", () => {
    const s = "편의점에서 일하다 지난달 퇴사했는데 사장님이 마지막 월급을 3주째 안 주고 있어요.";
    const issues = spotIssues(s);
    expect(issues[0].topic.id).toBe("unpaid-wages");
    expect(collectKeys(s, issues)).toEqual(expect.arrayContaining(["labor-standards:36", "labor-standards:109"]));
  });
});

describe("판사 관점 요건 대조", () => {
  it("확인됨 / 확인 필요 / 불충족 가능", () => {
    expect(evaluateRequirement("확정일자 받았어요", { label: "x", facts: ["확정일자"] }).status).toBe("met");
    expect(evaluateRequirement("아무 말", { label: "x", facts: ["확정일자"] }).status).toBe("unclear");
    expect(evaluateRequirement("나중에 주기로 합의했어요", { label: "x", facts: [], neg: ["합의했"] }).status).toBe("unmet");
  });
  it("층간소음: 급·배수 소음은 불충족 가능", () => {
    const s = "윗집 화장실 물소리가 밤마다 너무 커요";
    const a = buildRuleAnalyses(s, spotIssues(s), []);
    const req = a[0].perspectives.judge.requirements.find((r) => r.label.includes("급·배수"))!;
    expect(req.status).toBe("unmet");
  });
  it("형벌 조항 없는 쟁점은 검사 관점이 그렇다고 명시", () => {
    const s = "정보공개 청구를 했는데 비공개 결정을 받았어요";
    const a = buildRuleAnalyses(s, spotIssues(s), []);
    expect(a[0].perspectives.prosecutor.violations).toHaveLength(0);
    expect(a[0].perspectives.prosecutor.stance).toContain("형벌 조항");
  });
});

describe("analyze 파이프라인(LLM 모킹)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const load = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const k of ["LAW_API_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
    Object.assign(process.env, env);
    return (await import("@/lib/answer/analyze")).analyze;
  };

  it("키 없이: 규칙기반 3관점 + 쟁점별 분석", async () => {
    const analyze = await load({});
    const r = await analyze({ situation: JEONSE });
    expect(r.provider.id).toBe("mock");
    expect(r.analyses.map((a) => a.issue.id)).toEqual(expect.arrayContaining(["jeonse-fraud", "deposit-return"]));
    expect(r.citations.length).toBe(r.recommendations.length);
    expect(r.guard.passed).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("LLM 응답: 가짜 인용·요건 근거 제거, 상태값 정규화", async () => {
    const analyze = await load({ OPENAI_API_KEY: "sk-test", LLM_PROVIDER: "openai" });
    const content = JSON.stringify({
      lawyer: { stance: "임차권등기명령으로 권리 보전 [[housing-lease:3의3]]", arguments: ["대항력 주장 [[housing-lease:3]]", "민법 위반 [[civil-act:999]]"], evidence: ["계약서"], strategy: [] },
      prosecutor: { stance: "사기죄 검토 [[criminal-act:347]]", violations: ["기망 [[criminal-act:347]]"], sanctions: [], proofPoints: [] },
      judge: { stance: "요건 대조", issues: ["종료 여부"], requirements: [{ label: "확정일자", ref: "housing-lease:3의2", status: "met", basis: "서술" }, { label: "가짜", ref: "fake:1", status: "maybe", basis: "" }], outlook: "인용 가능성" },
      citations: ["housing-lease:3", "ghost:1"],
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content } }] }), { status: 200 }));
    const r = await analyze({ situation: JEONSE });
    expect(r.provider.id).toBe("openai");
    expect(r.analyses).toHaveLength(1);
    expect(r.analyses[0].issue.label).toContain("종합 분석");
    expect(r.guard.removedCitations).toEqual(expect.arrayContaining(["civil-act:999", "fake:1", "ghost:1"]));
    const req = r.analyses[0].perspectives.judge.requirements;
    expect(req[1].ref).toBeUndefined();
    expect(req[1].status).toBe("unclear");
    expect(JSON.stringify(r.analyses)).not.toContain("civil-act");
  });
});

describe("임금체불 사례 정밀도", () => {
  const s = "편의점에서 1년 6개월 일하다가 지난달 말에 퇴사했는데, 사장님이 마지막 달 월급 180만원과 퇴직금을 3주째 안 주고 있어요. 나중에 주겠다는 말만 하고 날짜도 안 정해 줬어요.";
  it("무관한 법령(육아휴직)이 추천되지 않음", () => {
    expect(collectKeys(s, spotIssues(s)).some((k) => k.startsWith("gender-equality"))).toBe(false);
  });
  it("요건 3개 모두 사실관계에서 확인", () => {
    const a = buildRuleAnalyses(s, spotIssues(s), []);
    expect(a[0].perspectives.judge.requirements.map((r) => r.status)).toEqual(["met", "met", "met"]);
  });
});

describe("일상 표현 해고 인식", () => {
  it("'내일부터 나오지 말라' → 부당해고 쟁점·해고 의사표시 확인", () => {
    const s = "회사에서 3년 근무했는데 어제 갑자기 내일부터 나오지 말라고 했어요";
    const issues = spotIssues(s);
    expect(issues[0]?.topic.id).toBe("unfair-dismissal");
    expect(buildRuleAnalyses(s, issues, [])[0].perspectives.judge.requirements[0].status).toBe("met");
    expect(extractFacts(s).map((f) => f.value)).toContain("해고");
  });
});
