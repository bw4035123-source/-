import { describe, expect, it } from "vitest";
import { lawNameHas, matchLawAliases } from "@/lib/law-api/search";
import fx from "./fixtures/alias-cases.json";

describe("생활 용어 → 법령 사전", () => {
  it(`질문 ${fx.cases.length}건이 맞는 법령을 가리킴(해당 없으면 사전에 안 걸림)`, () => {
    const wrong = fx.cases.map((c) => ({ ...c, got: matchLawAliases(c.q)[0]?.law ?? null })).filter((c) => c.got !== c.law);
    expect(wrong.map((c) => `${c.q} — 기대 ${c.law} / 실제 ${c.got}`)).toEqual([]);
  });

  it("법령명 낱말 일치: 두 글자 말은 이름 안쪽에 끼어 있으면 불일치", () => {
    expect(lawNameHas("군사기밀 보호법", "사기")).toBe(false);
    expect(lawNameHas("지진ㆍ화산재해대책법", "산재")).toBe(false);
    expect(lawNameHas("주차장법", "주차")).toBe(true);
    expect(lawNameHas("소음ㆍ진동관리법", "진동")).toBe(true);
    expect(lawNameHas("학교폭력예방 및 대책에 관한 법률", "학교폭력")).toBe(true);
  });
});
