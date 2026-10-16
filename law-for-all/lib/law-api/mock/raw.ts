import type { LawDoc } from "../types";
import { housingLaws } from "./housing";
import { livingLaws } from "./living";
import { adminLaws } from "./admin";
import { laborLaws } from "./labor";
import { criminalLaws } from "./criminal";
import { publicSectorLaws } from "./public-sector";

/** 사람이 작성한 내장 법령(위임 관계·키워드·실무 노트 포함). 조문 본문은 index.ts 에서 공식 원문 스냅샷으로 덮어씀 */
export const RAW_LAWS: LawDoc[] = [...housingLaws, ...livingLaws, ...adminLaws, ...laborLaws, ...criminalLaws, ...publicSectorLaws];
