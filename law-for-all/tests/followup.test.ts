import { describe, expect, it } from "vitest";
import { detectIntent, followUp } from "@/lib/answer/followup";
import { FOLLOWUP_SUGGESTIONS } from "@/lib/answer/followup-suggestions";

describe("이어서 묻기", () => {
  it("질문 유형 판별", () => {
    expect(detectIntent("언제까지 줘야 하나요?")).toBe("deadline");
    expect(detectIntent("어디에 신고하나요?")).toBe("where");
    expect(detectIntent("비공개 결정에 불복하려면?")).toBe("where");
    expect(detectIntent("어기면 처벌받나요?")).toBe("penalty");
    expect(detectIntent("무엇을 준비해야 하나요?")).toBe("prepare");
    expect(detectIntent("예외가 있나요?")).toBe("exception");
    expect(detectIntent("이건 뭐예요")).toBeNull();
    // 추천 질문은 모두 서로 다른 유형
    for (const list of Object.values(FOLLOWUP_SUGGESTIONS)) expect(new Set(list.map(detectIntent)).size).toBe(list.length);
  });

  it("이전 질문의 사안을 이어 기한 조문을 원문 문장으로 답함", async () => {
    const r = await followUp({ prevQuery: "퇴사했는데 마지막 월급을 안 줘요", question: "언제까지 줘야 하나요?", mode: "citizen" });
    expect(r.topic?.label).toContain("임금");
    expect(r.intent).toBe("deadline");
    expect(r.answer).toContain("14일 이내");
    expect(r.citations.map((c) => c.key)).toEqual(["labor-standards:36"]);
    expect(r.guard.passed).toBe(true);
    expect(r.suggestions).not.toContain("기한이 있나요?");
  });

  it("사안의 핵심어(보증금)가 든 조문 문장을 우선", async () => {
    const r = await followUp({ prevQuery: "전세 계약이 끝났는데 집주인이 보증금을 안 돌려줘요", question: "기한이 있나요?", mode: "citizen" });
    expect(r.topic?.id).toBe("deposit-return");
    expect(r.answer).toContain("보증금을 반환받을 때까지");
  });

  it("처벌을 물으면 벌칙·과태료 조문을 우선, 공직자 모드는 보고서체", async () => {
    const r = await followUp({ prevQuery: "청탁금지법 외부강의", question: "위반 시 제재는?", mode: "officer" });
    expect(r.answer.startsWith("추가 검토")).toBe(true);
    expect(r.citations.every((c) => /벌칙|과태료/.test(c.title))).toBe(true);
  });

  it("신고·상담은 토픽 연락처, 근거가 없으면 지어내지 않고 안내", async () => {
    const w = await followUp({ prevQuery: "퇴사했는데 마지막 월급을 안 줘요", question: "어디에 신고하나요?", mode: "citizen" });
    expect(w.answer).toContain("☎1350");
    const n = await followUp({ prevQuery: "zzqq xxyy", question: "이건 뭐예요", mode: "citizen" });
    expect(n.citations).toEqual([]);
    expect(n.answer).toContain("찾지 못했어요");
  });
});
