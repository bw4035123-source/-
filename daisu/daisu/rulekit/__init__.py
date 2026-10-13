"""rulekit – 공무원 교육훈련 이수시간 인정 기준을 규칙으로 다루는 도구 모음.

  schema     인정 기준 규칙(Rule)·규칙 묶음(RuleSet)·개인 정보(Profile) Pydantic 모델
  parser     규정 문서(조문·표)에서 규칙을 뽑아냄(정규식 기반, 원문 근거 보존)
  chunking   규정 문서를 조·항 단위의 구조화된 청크로 나눔(LangChain Document)
  retrieval  BM25 + 밀집 임베딩(BGE-m3) 하이브리드 검색, 최신 시행일 우선 가중치
  calc       판정 결과(JSON)를 받아 직렬·직급별 인정시간·미달시간을 정확히 계산
  official   계산 결과를 제출 양식(hwpx·docx 표)에 채워 문서를 만듦

원칙: LLM은 '판정 후보'를 낼 수 있지만, 최종 시간 계산과 상한·대상 검증은 규칙으로만 한다.
"""
