# rulekit – 이수시간 인정 규칙 · 규정 검색 · 계산 엔진 · 제출 양식

다이수 기본 실행과 별개인 확장 모듈입니다(`daisu/rulekit/`). 설치: `pip install -r requirements-ai.txt`

| 모듈 | 하는 일 |
|---|---|
| `schema.py` | Rule(rule_id · category · legal_basis · eligibility_conditions · max_hours_cap · credit_ratio · bonus), Requirement(직렬·직급별 의무시간), RuleSet, Profile – Pydantic v2 |
| `parser.py` | 규정 문서를 조·항·호로 나눠 분야(기본·전문·자기개발·가점)·상한(연간/건당/일)·인정비율·대상(직급·직렬·직위·고용형태·재직연수)·가점 환산·의무시간을 정규식으로 읽음. 못 읽은 문장은 `unparsed` |
| `chunking.py` | 조 단위(긴 조문은 항 경계) LangChain Document, 메타데이터: 법령·조·시행일·version_key |
| `retrieval.py` | BM25 + 밀집 임베딩(BGE-m3) 가중/RRF 결합, 최신 시행일 가중치(반감기), 구판 제외(`latest_only`). 내부망용 `HashingEmbeddings` |
| `calc.py` | LLM 판정 JSON → 규칙으로 재검증(대상·분야·비율) → 건당·일·연간 상한 → 분야별 합계 → 가장 구체적인 의무 기준으로 미달시간 → 가점. Decimal 정확 계산 |
| `official.py` | 계산 결과를 제출 양식(hwpx·docx) 표에 채움. 표는 머리글 글자로 찾고, 서식 행을 복제. `{{기관명}}` 자리표시 치환 |

원칙: LLM 은 "어느 규칙에 해당하는지" 후보만 내고, 시간 계산·상한·대상 판정은 규칙 엔진이 합니다.

## 주의
- `tests/rulekit/fixtures/` 의 지침은 **시험용 가상 문서**입니다. 실제 「공무원 교육훈련 지침」·「지방공무원 평정규칙」의 수치가 아닙니다. 실제 문서를 넣고 `parse_text` 결과(특히 `unparsed`)를 확인하세요.
- 기본 제출 양식은 **[예시]** 입니다. 행정안전부·주무부처가 안내한 실제 서식 파일을 `template` 으로 넣고, 머리글 이름을 `TemplateMap.columns` 에 맞추면 그 서식에 채워집니다.
- BGE-m3 는 처음 한 번 모델(약 2.3GB)을 내려받아야 합니다. 내부망이면 미리 받은 폴더 경로를 `BGEM3Embeddings(model_path=...)` 에 넣으세요.

## 실행
```
python tools/rulekit_demo.py                     # 예시 전체 흐름(output/ 에 hwpx·docx)
python -m pytest tests/rulekit -q                # 70개 테스트
```
