/** 법령 도메인 타입 — 국가법령정보 DRF 응답과 내장 모의데이터가 같은 모양으로 정규화된다. */

export type LawKind = "법률" | "대통령령" | "총리령" | "부령" | "공동부령" | "행정규칙" | "자치법규";

export type DataSource = "mock" | "live";

/** 다른 법령(주로 하위법령)의 조문을 가리키는 참조 */
export interface ArticleRef {
  lawId: string;
  articleNo: string;
}

export interface LawArticle {
  /** 조문 번호: "3", "3의2" */
  no: string;
  title: string;
  /** 조문 본문(항·호·목은 줄바꿈으로 구분, 호·목은 공백 들여쓰기) */
  text: string;
  /** 이 조문이 위임한 하위법령 조문(3단 대조용) */
  delegates?: ArticleRef[];
  /** 검색 보조 키워드(시민 일상어 포함) */
  keywords?: string[];
}

export interface PracticeNote {
  title: string;
  note: string;
  /** 판례·해석례 실시간 검색어(OC 설정 시 law.go.kr 에서 조회) */
  query: string;
}

export interface LawDoc {
  /** 내부 식별자(slug) */
  id: string;
  /** 법령 정식 명칭(국가법령정보 검색 키) */
  name: string;
  shortName?: string;
  kind: LawKind;
  /** 상위법령 id(시행령·시행규칙 → 법률) */
  parentId?: string;
  ministry: string;
  /** 시행일(YYYYMMDD, 알 수 있는 경우) */
  effectiveDate?: string;
  /** 제·개정 이유 요약 */
  revisionReason?: string;
  articles: LawArticle[];
  practiceNotes?: PracticeNote[];
  source: DataSource;
  /** 실시간 조회 시 법령일련번호 */
  mst?: string;
  /** 내장 데이터의 공식 원문 수집일(국가법령정보센터 스냅샷) */
  officialSnapshot?: string;
  fetchedAt?: string;
}

export interface LawSummary {
  id: string;
  name: string;
  kind: LawKind;
  ministry: string;
  articleCount: number;
  parentId?: string;
  source: DataSource;
}

/** 답변에 인용되는 근거 조문 카드 */
export interface Citation {
  key: string; // `${lawId}:${articleNo}`
  lawId: string;
  lawName: string;
  lawKind: LawKind;
  articleNo: string;
  title: string;
  text: string;
  url: string;
  source: DataSource;
}

/** 판례·법령해석례 실시간 검색 결과 */
export interface CaseItem {
  kind: "판례" | "법령해석례";
  title: string;
  caseNo?: string;
  court?: string;
  date?: string;
  url: string;
}
