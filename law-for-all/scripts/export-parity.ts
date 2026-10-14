/** Python 이식판 동등성 검증용 기준 결과(TS 엔진 출력)를 생성 → python/tests/parity_fixtures.json */
import fs from "node:fs";
import { ask } from "../lib/answer/ask";
import { analyze } from "../lib/answer/analyze";

const QUERIES = [
  "윗집 층간소음 기준이 어떻게 되나요?",
  "전세 계약할 때 전세사기 예방하려면 뭘 확인해야 하나요?",
  "계약이 끝났는데 집주인이 보증금을 안 돌려줘요",
  "육아휴직 급여는 얼마나 받을 수 있나요?",
  "민원 처리 기한은 며칠인가요?",
  "퇴사했는데 마지막 월급을 안 줘요",
  "음주운전 처벌 기준이 궁금해요",
  "정보공개 청구하면 언제까지 결정해야 하나요?",
  "질의민원 처리기간과 기간 계산 방법",
  "주택임대차 소액임차인 최우선변제 기준 금액",
  "혈중알코올농도 기준",
  "개인정보 열람 요구했는데 답이 없어요",
  "zzqq xxyy",
  "횡단보도 일시정지 의무",
];
const SITUATIONS = [
  "전세 2억 5천만원에 빌라에 살고 있는데 계약이 지난달 만료됐어요. 집주인이 보증금을 안 돌려주고 연락 두절이에요. 알고 보니 집이 경매에 넘어갔고 다른 세입자들도 피해자래요. 전입신고는 했고 확정일자도 받았어요.",
  "아파트 윗집에서 밤마다 쿵쿵 뛰는 소리와 큰 음악 소리가 나요. 관리사무소에 두 번 말했는데도 계속되고, 직접 올라가 얘기했더니 오히려 화를 냈어요. 어떻게 대응해야 하나요?",
  "편의점에서 1년 6개월 일하다가 지난달 말에 퇴사했는데, 사장님이 마지막 달 월급 180만원과 퇴직금을 3주째 안 주고 있어요. 나중에 주겠다는 말만 하고 날짜도 안 정해 줬어요.",
  "회사에서 3년 근무했는데 어제 팀장이 갑자기 내일부터 나오지 말라고 했어요. 해고 사유도 말로만 들었고 서면 통지나 예고는 없었어요.",
  "회식에서 맥주 두 잔을 마시고 30분 뒤 운전하다 단속에 걸렸는데 혈중알코올농도 0.052%가 나왔어요. 면허는 어떻게 되고 처벌은 얼마나 받나요?",
  "회사에서 3년 근무했는데 어제 갑자기 내일부터 나오지 말라고 했어요",
  "보증금 1억 2,000만원 원룸인데 계약 갱신을 요구했더니 집주인이 10% 올려 달래요",
  "윗집 화장실 물소리가 밤마다 너무 커요",
  "정보공개 청구를 했는데 비공개 결정을 받았어요",
  "아무 관련 없는 이야기를 길게 적어 봅니다 오늘 날씨가 좋네요",
];

const strip = <T extends Record<string, unknown>>(o: T) => {
  const { elapsedMs, generatedAt, ...rest } = o;
  void elapsedMs;
  void generatedAt;
  return rest;
};

async function main() {
  for (const k of ["LAW_API_OC", "LAW_OC", "LLM_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  const out = { ask: [] as unknown[], analyze: [] as unknown[] };
  for (const q of QUERIES) for (const mode of ["citizen", "officer"] as const) out.ask.push({ input: { query: q, mode }, output: strip((await ask({ query: q, mode })) as never) });
  for (const s of SITUATIONS) out.analyze.push({ input: { situation: s }, output: strip((await analyze({ situation: s })) as never) });
  fs.mkdirSync("python/tests", { recursive: true });
  fs.writeFileSync("python/tests/parity_fixtures.json", JSON.stringify(out, null, 1));
  console.log(`parity fixtures: ask ${out.ask.length}, analyze ${out.analyze.length}`);
}
main();
