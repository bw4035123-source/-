/** 내장 법령·토픽·3관점 지식베이스를 Python 서버용 JSON으로 내보냄(단일 원천 유지) */
import fs from "node:fs";
import path from "node:path";
import { MOCK_LAWS, MOCK_DATASET_DATE } from "../lib/law-api/mock";
import { TOPICS } from "../lib/law-api/mock/topics";
import { PERSPECTIVES } from "../lib/law-api/mock/perspectives";
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, CITIZEN_SCHEMA, OFFICER_SCHEMA, buildSystemPrompt } from "../lib/answer/prompts";

const out = path.resolve(process.argv[2] ?? "python/law_for_all/data");
fs.mkdirSync(out, { recursive: true });
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 1), "utf8");
write("laws.json", { datasetDate: MOCK_DATASET_DATE, laws: MOCK_LAWS });
write("topics.json", TOPICS);
write("perspectives.json", PERSPECTIVES);
write("prompts.json", { citizen: buildSystemPrompt("citizen"), officer: buildSystemPrompt("officer"), analysis: ANALYSIS_SYSTEM, schemas: { citizen: CITIZEN_SCHEMA, officer: OFFICER_SCHEMA, analysis: ANALYSIS_SCHEMA } });
console.log(`exported ${MOCK_LAWS.length} laws, ${TOPICS.length} topics → ${out}`);
