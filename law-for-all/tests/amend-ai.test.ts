import { describe, expect, it } from "vitest";
import { applyEdits, parseInstruction, reasonDraft } from "@/lib/drafting";
import { guardAmend, type AmendInput } from "@/lib/amend-ai";

const CUR = "① 신청을 받은 날부터 7일 이내에 처리하여야 한다.\n② 부득이한 경우 7일의 범위에서 한 차례 연장할 수 있다.\n③ 연장한 경우 신청인에게 알려야 한다.";
const base: AmendInput = { lawName: "○○ 민원 처리 규정", kind: "행정규칙", label: "제5조(처리기간)", current: CUR, instruction: "", upper: [{ label: "「민원 처리에 관한 법률」 제17조", text: "민원의 처리기간은 30일 이내로 한다." }] };
const g = (amended: string, instruction: string) => guardAmend({ amended }, { ...base, instruction });

describe("항 삭제(규칙)", () => {
  it("‘제2항을 삭제’ → 번호를 남기고 ‘② 삭제 <날짜>’", () => {
    const e = parseInstruction("제2항을 삭제");
    expect(e).toEqual([{ type: "deleteParagraph", no: 2 }]);
    const r = applyEdits(CUR, e);
    expect(r.applied).toHaveLength(1);
    expect(r.text).toMatch(/^① 신청을[^\n]+\n② 삭제 <\d{4}\. \d{1,2}\. \d{1,2}\.>\n③ 연장한/);
    expect(reasonDraft({ kind: "행정규칙", lawName: "규정", articleLabel: "제5조(처리기간)", instruction: "제2항을 삭제" }, r.applied)).toContain("제2항 삭제함");
  });
  it("없는 항·이미 삭제된 항은 찾지 못함으로", () => {
    expect(applyEdits(CUR, parseInstruction("제5항 삭제")).notFound).toHaveLength(1);
  });
});

describe("AI 개정안 가드", () => {
  it("지시대로 항을 신설하면 통과, 바뀐 곳을 항 단위로", () => {
    const r = g(`${CUR}\n④ 제1항의 신청은 전자문서로도 할 수 있다.`, "신청은 전자문서로도 할 수 있도록 추가");
    expect(r).toMatchObject({ ok: true, changes: ["제4항 신설"] });
    // 개정이유 주요내용
    if (r.ok) expect(reasonDraft({ kind: "행정규칙", lawName: "규정", articleLabel: "제5조", instruction: "x" }, [], r.changes)).toContain("제4항을 신설함");
  });
  it("조문 머리를 다시 붙여도 본문만 대조", () => {
    expect(g(`제5조(처리기간) ${CUR.replace("7일 이내", "5일 이내")}`, "처리를 빨리 하도록 5일 이내로")).toMatchObject({ ok: true, changes: ["제1항 개정"] });
  });
  it("근거 밖 수치·인원은 버림(지시·현행·상위법에 있는 값만)", () => {
    expect(g(CUR.replace("7일 이내", "10일 이내"), "처리기간을 늘려 주세요")).toMatchObject({ ok: false });
    expect(g(`${CUR}\n④ 위원은 9명 이내로 한다.`, "위원 규정 추가")).toMatchObject({ ok: false, reason: expect.stringContaining("9명") });
    expect(g(`${CUR}\n④ 위원은 9명 이내로 한다.`, "위원을 9명 이내로 두도록 추가")).toMatchObject({ ok: true });
    // 오후 6시 = 18시
    expect(g(`${CUR}\n④ 접수는 18시까지 한다.`, "접수는 오후 6시까지로 추가").ok).toBe(true);
  });
  it("지시에 없는 항 삭제·번호 체계 깨짐·새 벌칙·근거 밖 법령은 버림", () => {
    expect(g("① 신청을 받은 날부터 7일 이내에 처리하여야 한다.\n② 연장한 경우 신청인에게 알려야 한다.", "알림 문구 정비")).toMatchObject({ ok: false, reason: "개정 방향에 없는 항을 지움" });
    expect(g(CUR.replace("③", "④"), "정비")).toMatchObject({ ok: false });
    expect(g(`${CUR}\n④ 이를 위반한 자에게는 과태료를 부과한다.`, "위반 시 조치 추가")).toMatchObject({ ok: false, reason: expect.stringContaining("제재") });
    expect(g(`${CUR}\n④ 「전자정부법」에 따른 전자문서로도 신청할 수 있다.`, "전자문서 신청 추가")).toMatchObject({ ok: false, reason: expect.stringContaining("전자정부법") });
    expect(g(CUR, "아무거나")).toMatchObject({ ok: false, reason: "현행과 바뀐 내용이 없음" });
  });
  it("항을 지울 때는 번호를 남겨야(법제 관행), 새로 인용한 조문은 경고", () => {
    expect(g("① 신청을 받은 날부터 7일 이내에 처리하여야 한다.\n② 연장한 경우 신청인에게 알려야 한다.", "제2항 연장 규정을 없애 주세요")).toMatchObject({ ok: false, reason: expect.stringContaining("번호를 남기지") });
    expect(g(CUR.replace(/② [^\n]+/, "② 삭제"), "연장 규정을 없애 주세요")).toMatchObject({ ok: true, changes: ["제2항 삭제"] });
    const w = g(`${CUR}\n④ 제8조에 따른 신청은 전자문서로도 할 수 있다.`, "전자문서 신청 추가");
    expect(w.ok && w.warnings[0]).toContain("제8조");
  });
  it("의무·재량 표현 변경: 지시에 없으면 버리고, 지시에 있으면 확인 경고", () => {
    const opt = CUR.replace("처리하여야 한다", "처리할 수 있다");
    expect(g(opt, "처리기간 문구 정비")).toMatchObject({ ok: false, reason: expect.stringContaining("의무 → 재량") });
    const w = g(opt, "처리는 재량으로 할 수 있도록");
    expect(w.ok && w.warnings.join()).toContain("제1항: 의무 → 재량");
    // 활용형만 바뀐 경우(아니 된다 → 아니 되며)는 같은 금지 표현
    const sec = guardAmend({ amended: "위원은 비밀을 누설하여서는 아니 되며, 물러난 뒤에도 같다." }, { ...base, current: "위원은 비밀을 누설하여서는 아니 된다.", instruction: "물러난 뒤에도 적용" });
    expect(sec).toMatchObject({ ok: true, warnings: [] });
  });
  it("규칙으로 이미 ‘③ 삭제 <날짜>’ 한 항은 AI가 다시 써도 그대로(중복 개정 표시 없음)", () => {
    const cur = CUR.replace(/③ [^\n]+/, "③ 삭제 <2026. 11. 3.>");
    const r = guardAmend({ amended: cur.replace("7일 이내", "7일 이내(전자문서 포함)").replace("③ 삭제 <2026. 11. 3.>", "③ 삭제") }, { ...base, current: cur, original: CUR, instruction: "전자문서 접수도 포함" });
    expect(r).toMatchObject({ ok: true, changes: ["제1항 개정"] });
    expect(r.ok && r.text).toContain("③ 삭제 <2026. 11. 3.>");
  });
});
