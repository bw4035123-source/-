import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CITIZEN_FORMS, citeFrom, formForTopic } from "@/lib/citizen-forms";
import { TOPICS } from "@/lib/law-api/mock/topics";
import { ask } from "@/lib/answer/ask";
import { buildReceipt, receiptText } from "@/lib/receipt";

describe("국민 모드 서류 초안", () => {
  it("서식마다 해당 상황(토픽)의 근거 조문만 인용", () => {
    for (const f of CITIZEN_FORMS) {
      const topic = TOPICS.find((t) => t.id === f.topicId);
      expect(topic, f.topicId).toBeTruthy();
      for (const k of f.refs) expect(topic!.refs, `${f.title} ${k}`).toContain(k);
    }
  });

  it("빈칸은 ○○○, 입력하면 채워지고 금액은 천 단위 표기", async () => {
    const r = await ask({ query: "퇴사했는데 마지막 월급을 안 줘요", mode: "citizen" });
    const f = formForTopic(r.topic?.id)!;
    expect(f.title).toBe("임금체불 진정서");
    const empty = f.build({}, citeFrom(r.citations), "2026. 10. 21.");
    expect(empty).toContain("○○○");
    expect(empty).not.toMatch(/undefined|NaN/);
    const filled = f.build({ name: "홍길동", wage: "1800000", end: "2025. 8. 31." }, citeFrom(r.citations), "2026. 10. 21.");
    expect(filled).toContain("1,800,000원");
    expect(filled).toContain("「근로기준법」 제36조(금품 청산)");
    expect(filled).toContain("진정인 홍길동");
  });

  it("모든 서식이 빈 입력에서도 깨지지 않음", () => {
    for (const f of CITIZEN_FORMS) expect(f.build({}, citeFrom([]), "2026. 10. 21.")).not.toMatch(/undefined|NaN/);
  });
});

describe("답변 검증 영수증", () => {
  it("조문 원문 지문은 SHA-256과 일치, 검증 항목·영수증 번호 포함", async () => {
    const r = await ask({ query: "윗집 층간소음 기준이 어떻게 되나요?", mode: "citizen" });
    const rc = await buildReceipt(r);
    expect(rc.id).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(rc.rows).toHaveLength(r.citations.length);
    expect(rc.rows[0].fingerprint).toBe(createHash("sha256").update(r.citations[0].text).digest("hex").slice(0, 16));
    expect(rc.rows.some((x) => x.cited)).toBe(true);
    const t = receiptText(rc);
    expect(t).toContain("근거 목록 밖 인용 제거");
    expect(t).toContain("(KST)");
    // 같은 답변이면 같은 영수증 번호
    expect((await buildReceipt(r)).id).toBe(rc.id);
  });
});
