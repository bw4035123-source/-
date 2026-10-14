import type { LawDoc } from "../types";
import { housingLaws } from "./housing";
import { livingLaws } from "./living";
import { adminLaws } from "./admin";
import { laborLaws } from "./labor";
import { criminalLaws } from "./criminal";

/** 내장 법령 데이터셋 기준일(시연용). 실시간 원문은 LAW_API_OC 설정 시 국가법령정보센터에서 조회 */
export const MOCK_DATASET_DATE = "2026-10";

export const MOCK_LAWS: LawDoc[] = [...housingLaws, ...livingLaws, ...adminLaws, ...laborLaws, ...criminalLaws];

const byId = new Map(MOCK_LAWS.map((l) => [l.id, l]));
const byName = new Map(MOCK_LAWS.map((l) => [l.name.replace(/\s/g, ""), l]));

export const getMockLaw = (id: string) => byId.get(id);
export const getMockLawByName = (name: string) => byName.get(name.replace(/\s/g, ""));
