# 모두의 법 (Law For All)

> **2026년 공공 AI 대전환 챌린지 · 세션 1 출품작**
> 복잡하고 어려운 법률·조례·행정규칙을 **시민과 공무원 누구나** 쉽게 찾고, 해석하고, 바로 활용하는 AI 법률 지능형 포털

| 구분 | 내용 |
|---|---|
| 서비스 형태 | 웹 포털(반응형: 모바일·태블릿·데스크톱) |
| 핵심 가치 | ① 듀얼 모드(시민/공무원) ② 조문 근거 인용·환각 방지 ③ LLM 비종속(설정 하나로 교체) ④ 키 없이 즉시 시연 |
| 기술 스택 | Next.js 14(App Router) · TypeScript · Tailwind CSS · shadcn/ui(Radix) · Lucide · Framer Motion · Zod · Vitest |
| 법령 데이터 | 국가법령정보 공동활용 Open API(`lawSearch.do`, `lawService.do`) + 내장 시연 데이터(법률 13종·하위법령 6종) |
| LLM | OpenAI(및 Solar·vLLM 등 OpenAI 호환) · Anthropic Claude · Ollama(EXAONE·Gemma·Llama·Solar) · 규칙기반 엔진 |
| 라이선스 | MIT |

---

## 1. 바로 실행

### 🐍 Python 실행판 (Node.js 불필요 — 권장 배포 형태)
`law-for-all-python.zip` 압축을 풀고 **Python 3.9 이상**으로 실행합니다. `pip install` 없이 표준 라이브러리만 사용합니다.

```bash
python run.py        # Windows는 실행.bat / run.bat 더블클릭 → http://127.0.0.1:8000
```

- 화면은 Next.js 정적 빌드, API(검색·질의응답·상황분석·환각 가드·LLM 어댑터·법령 Open API)는 Python으로 이식(`python/law_for_all/`)
- **TypeScript 엔진과 결과 동일성 테스트**(38개 입력에 대해 응답 JSON 완전 일치) 포함, Python 3.9~3.13 검증
- 배포판 다시 만들기: `node scripts/build-python.mjs` → `dist/law-for-all-python.zip`

### Node.js 실행판 (3가지 방법 중 하나)

필요 환경: **Node.js 18.18 이상**(20 LTS 권장). API 키·인터넷 없이도 모든 화면이 동작합니다.

```bash
# 방법 A — 원클릭
./start.sh          # macOS / Linux
start.bat           # Windows (더블클릭)

# 방법 B — npm
npm install
npm run dev         # → http://localhost:3000

# 방법 C — Docker
docker compose up --build                       # → http://localhost:3000
docker compose --profile local-llm up --build   # + 로컬 LLM(Ollama, EXAONE 3.5) 함께 구동
```

프로덕션 실행: `npm run build && npm start`

---

## 2. 주요 기능

### 시민 모드 (Easy & Warm)
- 일상 언어 질문 → **말풍선 요약**(문장마다 근거 번호), **어려운 용어 풀이 카드**, **지금 해야 할 3단계 행동 가이드**
- **관련 기관 연락처**(검수된 고정 데이터, 전화 바로걸기) · **PDF 법률 리포트**(브라우저 인쇄 → PDF 저장, 한글 깨짐 없음)
- 추천 키워드: 층간소음 · 전세사기 예방 · 보증금 반환 · 육아휴직 급여 · 민원 처리 기한 · 임금체불 · 음주운전 · 정보공개

### 공무원·실무자 모드 (Pro & Accurate)
- **행정 요약 보고서**(검토 결론 → 법적 근거 체계 → 주요 쟁점 → 업무 유의사항 → 확인 체크리스트)
- **법제처 형식 조문 뷰어**(`/laws/[id]`): 조문 목차, 조문별 앵커 링크, 위임 조문 바로가기
- **상위법령–시행령–시행규칙 3단 대조**(위임 관계 기준, 2단계 위임까지 추적)
- **제·개정 이유**, **실무 쟁점 노트**, **판례·법령해석례 실시간 조회**(Open API 연동 시)
- **기안문 인용문 복사**: `「주택임대차보호법」 제3조(대항력 등)에 따르면, "…"라고 규정하고 있음.` / '관련 근거 가. 나. …' 블록 / 보고서 전문 복사

### AI 법률 상황 분석실 (`/analyze`) — 변호사·검사·판사 3관점
- 겪은 일을 자유롭게 서술하면 **사실관계 자동 정리**(당사자·행위·금액·시점·장소) → **법률 쟁점 발견**(복합 쟁점 최대 3개) → **관련 법령 추천 순위**(핵심/관련/참고 + 추천 사유 + 관련도 막대)
- **AI 모의 법정**: 같은 사실을 세 법률가의 시각으로 검토
  - **변호사**(내 편): 주장할 권리·근거, 준비할 증거, 대응 전략
  - **검사**(공익): 위법·범죄 성립 가능성, 적용 제재(형법 사기·경범죄 인근소란·근로기준법 벌칙 등). 형벌 조항이 근거에 없으면 그렇다고 명시
  - **판사**(중립): 쟁점 정리, **법률 요건 ↔ 사실관계 대조표**(확인됨/확인 필요/불충족 가능), 예상 판단 방향(가능성 표현)
- 예시 상황 5종, 검색 결과에서 바로 이어보기, 분석 결과 텍스트 복사, 모바일은 역할별 탭
- 모든 관점 문장에 조문 인용, LLM 사용 시에도 동일한 인용 화이트리스트 가드 적용(가짜 조문·요건 근거 자동 제거)

### 공통
- 근거 조문 카드 클릭 → **원문 전문 슬라이드 오버 뷰어** + 위임 관계로 연결된 상·하위법령 조문
- 접근성: 글자 크기 3단계(어르신 배려), 고대비 모드, 다크 모드, 키보드 탐색·스킵 링크, 스크린리더 레이블, 움직임 줄이기 설정 존중

---

## 3. 아키텍처

```
 질문 ─▶ ① 근거 검색(retrieve) ─▶ ② 원문 확보(LawService) ─▶ ③ LLMProvider(Adapter) ─▶ ④ 환각 가드 ─▶ ⑤ 답변 + 근거 카드
         토픽 라우팅 + 2-gram        Open API 실시간 원문          openai / anthropic /        인용 화이트리스트
         조문 검색 + 위임조문         (실패·미설정 시 내장 데이터)    ollama / mock(규칙엔진)      조문 언급 원문 대조
                                                                                              실패 시 규칙엔진 대체
```

```
law-for-all/
├─ app/                         # Next.js App Router
│  ├─ page.tsx                  # 메인(히어로 검색 + 추천 키워드)
│  ├─ search/                   # 검색 결과(시민/공무원 듀얼 뷰)
│  ├─ laws/ , laws/[id]/        # 법령 목록 · 법제처 형식 뷰어(3단 대조·제개정이유·판례)
│  ├─ analyze/                  # AI 법률 상황 분석실(법령 추천 + 변호사·검사·판사 관점)
│  ├─ report/                   # 인쇄·PDF 리포트
│  ├─ about/                    # 서비스 구조·LLM 상태·검증 방식
│  └─ api/                      # ask · analyze · providers · laws · laws/[id] · cases · health
├─ components/
│  ├─ ui/                       # shadcn/ui 패턴 컴포넌트(Button, Card, Sheet, Tabs, Switch …)
│  ├─ law-search/               # 검색창, 결과, 인용 카드, 원문 슬라이드 뷰어, 검증 배지
│  ├─ citizen-view/             # 시민 모드 답변, 기관 연락처, 리포트
│  ├─ officer-view/             # 행정 보고서, 법령 문서 뷰어, 3단 대조, 판례 패널
│  ├─ case-analysis/            # 상황 분석: 입력 폼, 사실관계, 법령 추천, 3관점 패널
│  └─ layout/                   # 헤더(모드 토글·LLM 선택·접근성 도구), 푸터
├─ lib/
│  ├─ law-api/                  # 국가법령정보 Open API 클라이언트 + Mock 엔진
│  │  ├─ drf.ts                 #   DRF 호출·캐시·응답 파서(lawSearch.do / lawService.do)
│  │  ├─ client.ts              #   LawService: 실시간 ↔ 내장 데이터 자동 Fallback
│  │  ├─ search.ts              #   한국어 2-gram 검색 엔진(외부 의존성 없음)
│  │  └─ mock/                  #   법률 13종·하위법령 6종·생활 법률 토픽 12종·3관점 지식베이스
│  ├─ llm/                      # LLM 비종속 계층(Adapter Pattern)
│  │  ├─ types.ts               #   LLMProvider 인터페이스
│  │  ├─ providers/             #   openai · anthropic · ollama · mock
│  │  └─ registry.ts            #   환경변수 기반 생성·선택·안전 대체
│  └─ answer/                   # 질의응답·상황분석 파이프라인 · 사실 추출 · 프롬프트 · 환각 가드 · 규칙엔진
├─ tests/                       # Vitest 44개(데이터 무결성·검색·가드·DRF 파서·3종 LLM·상황 분석)
├─ scripts/llm-check.ts         # 설정된 LLM 전체 비교 점검
├─ python/                     # Python 실행판(표준 라이브러리 서버 + 동등성 테스트)
├─ Dockerfile · docker-compose.yml · .gitlab-ci.yml
└─ docs/JUDGE_GUIDE.md          # 예선 심사위원용 구동안내서
```

### 환각(Hallucination) 방지 설계
1. LLM에는 **검색된 근거 조문만** 제공하고 문장마다 `[[조문키]]` 인용을 강제합니다.
2. 근거 목록 밖 인용은 **서버에서 자동 제거**, 인용이 하나도 없거나 JSON 형식이 깨지면 **답변을 폐기하고 규칙엔진으로 대체**합니다.
3. 본문의 `「법령」 제N조` 표현을 근거 원문과 **대조**해 확인되지 않으면 화면에 '확인 필요'로 표시합니다.
4. 근거 카드에는 AI 문장이 아닌 **법령 원문만** 표시하고 국가법령정보센터 원문 링크를 제공합니다.
5. 기관 연락처는 LLM이 만들지 않으며, 근거가 없으면 **LLM을 호출하지 않습니다**.
6. 시연 데이터에는 확인되지 않은 판례 사건번호를 넣지 않고, 판례는 Open API 실시간 조회로만 제공합니다.

---

## 4. 환경설정

`.env.example`을 `.env.local`로 복사해 필요한 값만 넣습니다. **아무 값도 없어도 동작합니다.**

| 변수 | 설명 | 기본값 |
|---|---|---|
| `LAW_API_OC` | 국가법령정보 Open API 인증키(OC). [open.law.go.kr](https://open.law.go.kr)에서 신청 후 서버 IP/도메인 등록 | (비움 → 내장 데이터) |
| `LLM_PROVIDER` | 기본 LLM: `mock` · `openai` · `anthropic` · `ollama` | `mock` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | OpenAI 또는 OpenAI 호환 서버(Upstage Solar, vLLM, LM Studio 등) | `gpt-4o-mini`, `https://api.openai.com/v1` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Anthropic Claude | `claude-sonnet-5-5` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | 로컬·폐쇄망 LLM | `http://localhost:11434`, `exaone3.5:7.8b` |
| `LLM_TIMEOUT_MS` | LLM 응답 제한시간 | `45000` |

API 키는 서버(Route Handler)에서만 사용되며 브라우저로 전달되지 않습니다(`server-only` 모듈 보호).

---

## 5. LLM 스위칭 (2종 이상 테스트)

```bash
# 예) Ollama 로컬 모델 + OpenAI 를 함께 설정
ollama pull exaone3.5:7.8b          # 또는 gemma3:4b, llama3.1:8b, solar 등
cat >> .env.local <<'ENV'
OPENAI_API_KEY=sk-...
OLLAMA_MODEL=exaone3.5:7.8b
ENV

npm run llm:check                    # 설정된 모든 공급자로 같은 질문 → 결과·검증 상태 비교
npm run llm:check -- "질의민원 처리기간" officer
```

- **기본값 변경**: `LLM_PROVIDER=ollama` 한 줄 수정 후 재시작
- **실시간 전환**: 화면 상단 `AI 모델` 드롭다운(설정된 공급자만 활성화) — 답변 상단 배지에 실제 응답한 모델이 표시됩니다.
- **새 공급자 추가**: `lib/llm/providers/`에 `LLMProvider` 구현 1개 + `registry.ts` 등록 1줄

---

## 6. 품질 점검

```bash
npm run check      # 타입검사 + ESLint + 단위테스트(44개)
npm run build      # 프로덕션 빌드
```

테스트 범위: 내장 데이터 무결성(토픽·위임 조문 실존 검증) · 검색 라우팅 · 환각 가드 · DRF 응답 파서 · OpenAI/Anthropic/Ollama 어댑터 요청 형식과 실패 시 대체 동작.

## 7. 유의사항

본 서비스는 **법률 정보 제공** 목적이며 개별 사안에 대한 법률 자문이 아닙니다. 내장 시연 데이터는 주요 조문을 발췌·요약한 것으로, 실제 업무에는 `LAW_API_OC`를 설정하여 국가법령정보센터 현행 원문을 사용하십시오.
