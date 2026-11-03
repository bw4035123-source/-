// 실서비스 개정안 AI 실측 — 정해진 문형(‘A에서 B로’)으로 적지 않고 말하듯 쓴 개정 의도를 /api/amend-ai 에 보내
// 가드를 통과한 개정안이 나오는지, 버렸다면 그 이유를 기록한다(결과: lib/eval/amend-live.json)
//   node scripts/amend-live.mjs https://lawon.onrender.com
import fs from "node:fs";
const B = process.argv[2] ?? "https://lawon.onrender.com";
const cases = [
  ["제5조(신청)", "① 민원인은 별지 제1호서식의 신청서를 방문 또는 우편으로 제출하여야 한다.\n② 신청서를 받은 담당자는 접수대장에 적어야 한다.", "신청은 전자문서로도 할 수 있도록 추가"],
  ["제3조(구성)", "① 위원회는 위원장 1명을 포함한 5명 이상 7명 이하의 위원으로 구성한다.\n② 위원장은 부시장이 된다.", "위원회 위원 수를 7명 이상 9명 이하로 늘려 주세요"],
  ["제7조(수수료)", "① 증명서를 발급받으려는 자는 1건당 1,000원의 수수료를 내야 한다.\n② 국가유공자는 수수료를 면제한다.", "수수료 면제 대상에 기초생활수급자를 포함"],
  ["제4조(근무시간)", "① 직원의 근무시간은 오전 9시부터 오후 5시까지로 한다.\n② 점심시간은 낮 12시부터 오후 1시까지로 한다.", "근무시간을 오전 9시부터 오후 6시까지로 바꾸고 점심시간은 1시간으로"],
  ["제9조(여비)", "① 출장 여비는 예산의 범위에서 실비로 지급한다.\n② 여비 지급에 필요한 사항은 기관장이 정한다.", "출장비 지급 기준을 공무원 여비 규정에 맞게 고쳐줘"],
  ["제6조(처리기간)", "① 신청을 받은 날부터 7일 이내에 처리하여야 한다.\n② 부득이한 경우 7일의 범위에서 한 차례 연장할 수 있다.\n③ 연장한 경우 신청인에게 알려야 한다.", "연장할 때는 그 사유를 문자메시지로도 알릴 수 있도록"],
  ["제8조(회의)", "① 위원회의 회의는 위원장이 소집한다.\n② 회의는 재적위원 과반수의 출석으로 개의하고, 출석위원 과반수의 찬성으로 의결한다.", "긴급한 경우에는 서면이나 영상회의로도 심의할 수 있게 해 주세요"],
  ["제10조(비밀유지)", "위원회의 위원은 직무상 알게 된 비밀을 누설하여서는 아니 된다.", "위원에서 물러난 뒤에도 비밀유지 의무가 적용되도록"],
  ["제12조(포상)", "① 기관장은 업무 개선에 공이 있는 직원을 포상할 수 있다.\n② 포상의 절차는 따로 정한다.", "포상 대상에 우수 민원 처리 직원도 넣어줘"],
  ["제2조(적용 범위)", "이 규정은 ○○공단 소속 정규직 직원에게 적용한다.", "무기계약직 직원에게도 적용되도록 범위를 넓혀 주세요"],
];
const rows = [];
for (const [label, current, instruction] of cases) {
  const t = Date.now();
  const r = await fetch(`${B}/api/amend-ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lawName: "○○ 규정", kind: "행정규칙", label, current, instruction, upper: [] }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  const row = { label, instruction, ok: !!r.ok, retried: !!r.retried, ms: Date.now() - t, text: r.text, changes: r.changes, warnings: r.warnings, reason: r.reason ?? r.error, model: r.model };
  rows.push(row);
  console.log(`${row.ok ? "통과" : "버림"} ${(row.ms / 1000).toFixed(1).padStart(5)}s ${row.retried ? "재작성 " : ""}${instruction}${row.ok ? ` → ${row.changes.join(", ")}${row.warnings?.length ? ` · 경고: ${row.warnings.join(" / ")}` : ""}` : ` — ${row.reason}`}`);
}
const summary = { date: new Date().toISOString().slice(0, 10), base: B, total: rows.length, passed: rows.filter((r) => r.ok).length, retried: rows.filter((r) => r.retried).length, model: rows.find((r) => r.model)?.model };
fs.writeFileSync("lib/eval/amend-live.json", JSON.stringify({ summary, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary));
