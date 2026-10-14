# 모두의 법 (Law For All) — Python 실행판

**Python 3.9 이상만 있으면** 바로 실행됩니다. `pip install`·Node.js·인터넷 연결이 필요 없습니다(표준 라이브러리만 사용).

## 실행

| 환경 | 방법 |
|---|---|
| Windows | `실행.bat` 또는 `run.bat` 더블클릭 |
| macOS / Linux | `./run.sh` |
| 공통 | `python run.py` (또는 `python3 run.py`) |

브라우저가 자동으로 **http://127.0.0.1:8000** 을 엽니다. 종료는 `Ctrl+C`.

| 옵션 | 설명 |
|---|---|
| `--port 9000` | 포트 변경(사용 중이면 다음 빈 포트 자동 선택) |
| `--host 0.0.0.0` | 같은 네트워크의 다른 PC·휴대폰에서 접속 허용 |
| `--no-browser` | 브라우저 자동 열기 끔 |
| `--check` | 화면 파일·내장 데이터·LLM 설정 점검 후 종료 |

## 기능

- **AI 법률 검색** — 시민 모드(쉬운 설명·3단계 행동 가이드·PDF 리포트) / 공무원 모드(행정 보고서·기안문 인용 복사)
- **AI 법률 상황 분석실** — 상황을 이야기하면 관련 법령 추천 + 변호사·검사·판사 3관점 분석
- **법령 뷰어** — 조문 본문, 상위법–시행령–시행규칙 3단 대조, 제·개정 이유
- **근거 인용·환각 방지** — 모든 답변에 조문 인용, 근거 밖 인용 자동 제거
- **접근성** — 글자 크기 3단계, 고대비, 다크 모드, 모바일 반응형

## 설정(선택)

`.env.example` 을 `.env.local` 로 복사해 필요한 값만 넣으세요. 비워 두면 내장 법령 데이터와 규칙기반 엔진으로 동작합니다.

| 변수 | 설명 |
|---|---|
| `LAW_API_OC` | 국가법령정보 Open API 인증키 → 실시간 원문·판례 조회 |
| `LLM_PROVIDER` | 기본 AI: `mock`(기본) · `openai` · `anthropic` · `ollama` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI 또는 호환 서버(Upstage Solar, vLLM 등) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic Claude |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | 로컬·폐쇄망 LLM(예: `exaone3.5:7.8b`) |

설정한 AI는 화면 상단 **AI 모델** 메뉴에서 실시간으로 바꿀 수 있습니다. `python run.py --check` 로 연결 상태를 확인하세요.

## 구성

```
run.py               실행기
law_for_all/
  server.py          HTTP 서버(정적 화면 + JSON API)
  ask.py             질의응답 파이프라인
  analyze.py         상황 분석(법령 추천 + 3관점)
  guard.py           환각 방지 가드
  llm.py             LLM 어댑터(OpenAI·Anthropic·Ollama·규칙엔진)
  drf.py, service.py 국가법령정보 Open API 클라이언트 + 내장 데이터 대체
  search.py, facts.py, rule_engine.py, prompts.py, data/ (내장 법령·토픽·3관점 지식베이스)
  web/               화면(Next.js 정적 빌드)
tests/               단위·통합 테스트 + Next.js 판과의 결과 동등성 테스트
```

테스트: `python -m unittest discover -s tests -t .`

※ 법률 정보 제공 목적이며 법률 자문이 아닙니다. 내장 데이터는 주요 조문 발췌로, 실제 업무에는 `LAW_API_OC` 를 설정해 현행 원문을 사용하세요.
