import { describe, expect, it } from "vitest";
import { getMockLaw } from "@/lib/law-api/mock";
import { TARGET_LAWS, SAMPLE_REGULATIONS, amendedText, complianceReport, crossCheck, findReferences, parseRegulation } from "@/lib/compliance";
import type { LawDoc } from "@/lib/law-api/types";

const laws = TARGET_LAWS.map((l) => getMockLaw(l.id)!).filter(Boolean);
const run = (text: string, orgType: Parameters<typeof crossCheck>[0]["orgType"] = "공기업·준정부기관", ls: LawDoc[] = laws) => crossCheck({ text, orgType, laws: ls });
const rules = (text: string, org?: Parameters<typeof crossCheck>[0]["orgType"]) => run(text, org).results.flatMap((r) => r.findings.map((f) => `${f.rule}:${f.severity}`));

describe("우리 기관 규정 검증 — 조문 분리·인용", () => {
  it("제N조(제목) 단위로 나누고 항은 이어 붙이며 부칙은 제외", () => {
    const a = parseRegulation("제1조(목적) 목적이다.\n제2조의2(정의) ① 가\n② 나\n부칙\n제1조(시행일) 공포한 날부터 시행한다.");
    expect(a.map((x) => [x.no, x.title])).toEqual([["1", "목적"], ["2의2", "정의"]]);
    expect(a[1].text).toBe("① 가\n② 나");
  });
  it("인용 조문: 약칭·띄어쓰기 차이를 정식 법령으로 연결, 시행령은 별도 표시", () => {
    const r = findReferences("「청탁금지법」 제8조, 「공유재산 및 물품관리법」 제21조, 「근로기준법 시행령」 제5조, 근로기준법 시행령 제30조");
    expect(r.map((x) => [x.lawId, x.articleNo, x.decree])).toEqual([["anti-graft", "8", false], ["public-property", "21", false], [null, "5", false], ["labor-standards", "30", true]]);
  });
  it("실시간 원문이면 없는 조문 인용은 상충, 내장 원문 범위 밖이면 검토", () => {
    const live = { ...getMockLaw("labor-standards")!, source: "live" as const };
    expect(rules("제9조(준용) 「근로기준법」 제150조에 따른다.").some((x) => x === "ref-unverified:review")).toBe(true);
    const rep = run("제9조(준용) 「근로기준법」 제150조와 「근로기준법」 제60조에 따른다.", "공기업·준정부기관", [live]);
    const f = rep.results[0].findings.map((x) => `${x.rule}:${x.severity}`);
    expect(f).toEqual(expect.arrayContaining(["ref-missing:conflict", "ref-ok:ok"]));
    expect(rep.liveLaws).toEqual(["labor-standards"]);
  });
});

describe("우리 기관 규정 검증 — 근로기준법", () => {
  it("근로시간·연장·휴게·가산·연차·해고예고·금품청산 미달을 상충으로", () => {
    const r = rules(
      "제10조(근로시간) ① 1일 근로시간은 휴게시간을 제외하고 8시간으로 하며, 1주 44시간으로 한다.\n② 휴게시간은 근로시간 4시간마다 20분을 부여한다.\n제11조(연장근로) 합의하여 1주 15시간 이내에서 연장근로를 시킬 수 있다.\n제12조(수당) 연장근로와 야간근로에 대하여는 통상임금의 100분의 30을 가산하여 지급한다.\n제15조(연차휴가) 1년간 80퍼센트 이상 출근한 직원에게는 12일의 유급휴가를 준다.\n제20조(퇴직) 직원이 퇴직한 경우 30일 이내에 임금을 지급한다.\n제25조(해고의 예고) 해고하려면 적어도 15일 전에 예고하여야 한다.",
    );
    expect(r).toEqual(expect.arrayContaining(["work-hours-week:conflict", "rest-4h:conflict", "overtime-week:conflict", "premium:conflict", "annual-leave:conflict", "settlement:conflict", "dismissal-notice:conflict"]));
    expect(r).not.toContain("work-hours-day:conflict");
  });
  it("법 기준을 지키거나 더 유리하면 상충 없음", () => {
    const r = rules("제10조(근로시간) 1일 8시간, 1주 40시간으로 한다.\n제15조(연차휴가) 1년간 80퍼센트 이상 출근한 직원에게는 20일의 유급휴가를 준다.\n제12조(수당) 연장근로에는 통상임금의 100분의 50을 가산한다.");
    expect(r.filter((x) => x.endsWith(":conflict"))).toEqual([]);
  });
  it("법령 우선 배제 조항과 개정 절차(의견청취·동의) 누락", () => {
    const r = rules("제2조(관계) 이 취업규칙은 근로조건에 관하여 법령에 우선하여 적용한다.\n제30조(규칙의 개정) 이 규칙의 개정은 이사회의 의결을 거쳐 사장이 정한다.");
    expect(r).toEqual(expect.arrayContaining(["precedence:conflict", "change-procedure:review"]));
    expect(rules("제2조(사규) 이 사규는 근로자 과반수의 동의를 받아 개정한다.")).not.toContain("change-procedure:review");
  });
  it("개정안: 수치 위반을 법 기준으로 바꾼 문구", () => {
    const rep = run("제15조(연차휴가) 1년간 80퍼센트 이상 출근한 직원에게는 12일의 유급휴가를 준다.");
    expect(amendedText(rep.results[0])).toBe("1년간 80퍼센트 이상 출근한 직원에게는 15일의 유급휴가를 준다.");
  });
});

describe("우리 기관 규정 검증 — 청탁금지법·공직선거법", () => {
  it("금품 허용 한도 초과·직무관련 허용·외부강의 신고기한·서면 신고", () => {
    const r = rules("제8조(금품) ① 직무관련자로부터 1회 10만원 이하의 선물은 받을 수 있다.\n② 동일인으로부터 연간 500만원 이내의 경조사비를 받을 수 있다.\n③ 동일인으로부터 1회 150만원까지의 금품을 받을 수 있다.\n제10조(외부강의) 사례금을 받는 외부강의는 마친 날부터 30일 이내에 신고하여야 한다.\n제5조(신고) 부정청탁을 받은 경우 감사실에 신고하여야 한다.");
    expect(r).toEqual(expect.arrayContaining(["graft-duty:review", "graft-yearly:conflict", "graft-once:conflict", "lecture-deadline:conflict", "graft-report-form:review"]));
  });
  it("선거운동 허용은 상충, 금지 조항은 통과", () => {
    expect(rules("제12조(정치적 중립) 임직원은 근무시간 외에는 특정 후보자를 위한 선거운동에 참여할 수 있다.")).toContain("election:conflict");
    expect(rules("제12조(정치적 중립) 임직원은 선거운동을 할 수 없다.")).not.toContain("election:conflict");
  });
});

describe("우리 기관 규정 검증 — 지방공기업법·공유재산법", () => {
  it("임원 임기·연임 단위·추천 절차(지방공기업)", () => {
    const r = rules("제15조(임원) 이사장의 임기는 2년으로 하며, 2년 단위로 연임할 수 있다.\n제16조(임명) 상임이사는 이사장이 임명한다.", "지방공기업");
    expect(r).toEqual(expect.arrayContaining(["lpe-term:conflict", "lpe-renew:conflict", "lpe-recommend:review"]));
    expect(rules("제15조(임원) 사장의 임기는 3년으로 하며, 1년 단위로 연임할 수 있다.", "지방공기업").filter((x) => x.startsWith("lpe"))).toEqual([]);
    expect(rules("제15조(임원) 이사장의 임기는 2년으로 한다.", "공기업·준정부기관")).not.toContain("lpe-term:conflict");
  });
  it("사용허가기간·자동연장·전대·수의, 대부기간", () => {
    const r = rules("제5조(사용허가) ① 수의의 방법으로 사용허가를 할 수 있다.\n② 사용허가를 받은 자는 다른 자에게 전대할 수 있다.\n제6조(사용허가기간) 사용허가기간은 10년으로 하며, 기간이 끝나면 자동으로 연장된다.\n제10조(대부기간) 토지와 건물의 대부기간은 7년 이내로 한다.");
    expect(r).toEqual(expect.arrayContaining(["prop-bid:review", "prop-sublet:conflict", "prop-permit-term:conflict", "prop-auto-renew:conflict", "prop-lease-land:conflict"]));
  });
});

describe("예시 내규·보고서", () => {
  it("예시 3종 모두 상충을 찾고, 근거 조문은 모두 내장 원문에 실존", () => {
    for (const s of SAMPLE_REGULATIONS) {
      const rep = crossCheck({ text: s.text, orgType: s.orgType, regName: s.name, laws });
      expect(rep.counts.conflict, s.label).toBeGreaterThan(0);
      for (const r of rep.results) for (const f of r.findings) for (const b of f.basis) expect(getMockLaw(b.lawId)?.articles.some((a) => a.no === b.articleNo), `${s.label} ${b.lawId}:${b.articleNo}`).toBe(true);
    }
  });
  it("보고서: 개요·조문별 근거·조치 계획", () => {
    const s = SAMPLE_REGULATIONS[0];
    const rep = crossCheck({ text: s.text, orgType: s.orgType, regName: s.name, laws });
    const t = complianceReport(rep, (id) => TARGET_LAWS.find((l) => l.id === id)!.name, new Date(2026, 9, 16));
    expect(t).toContain("「○○도시공사 취업규칙」 상위법령 교차 검증 결과 보고");
    expect(t).toContain("「근로기준법」 제60조");
    expect(t).toContain("3. 조치 계획(안)");
    expect(rep.results.find((r) => r.article.no === "30")?.findings.map((f) => f.rule)).toContain("change-procedure");
  });
});
