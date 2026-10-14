import type { LawDoc } from "../types";
import { RAW_LAWS } from "./raw";
import snapshot from "./official-snapshot.json";

/**
 * 내장 법령 데이터 = 사람이 작성한 메타데이터(raw.ts) + 국가법령정보센터 공식 원문 스냅샷(official-snapshot.json).
 * 스냅샷은 scripts/sync_official.py 로 갱신하며, 조문 제목·본문·시행일은 스냅샷 값을 사용한다.
 * LAW_API_OC 설정 시에는 실행 중에도 실시간 원문으로 다시 대체된다.
 */
type Snapshot = { fetchedAt: string; laws: Record<string, { effectiveDate?: string | null; articles: Record<string, { title: string; text: string }> }> };
const snap = snapshot as Snapshot;

/** 내장 데이터 기준일 = 공식 원문 수집일 */
export const MOCK_DATASET_DATE = snap.fetchedAt;

export const MOCK_LAWS: LawDoc[] = RAW_LAWS.map((law) => {
  const s = snap.laws[law.id];
  if (!s) return law;
  return {
    ...law,
    effectiveDate: s.effectiveDate ?? law.effectiveDate,
    officialSnapshot: snap.fetchedAt,
    articles: law.articles.map((a) => (s.articles[a.no] ? { ...a, title: s.articles[a.no].title, text: s.articles[a.no].text } : a)),
  };
});

const byId = new Map(MOCK_LAWS.map((l) => [l.id, l]));
const byName = new Map(MOCK_LAWS.map((l) => [l.name.replace(/\s/g, ""), l]));

export const getMockLaw = (id: string) => byId.get(id);
export const getMockLawByName = (name: string) => byName.get(name.replace(/\s/g, ""));
