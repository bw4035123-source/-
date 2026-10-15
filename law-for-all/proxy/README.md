# 법이음 법령 API 중계 서버 (FastAPI)

```
브라우저/프런트엔드 ──► 이 서버(내 PC) ──► 국가법령정보센터 Open API (www.law.go.kr/DRF)
                        └ 인증키(OC)는 여기만 보관
```

- 국가법령정보센터는 **호출한 PC의 공인 IP**만 확인합니다. 브라우저가 직접 부르면 사용자마다 IP가 달라 차단되지만, 이 서버를 거치면 항상 **내 PC(등록한 IP)** 에서 나가므로 통과합니다.
- Cloudflare Tunnel로 외부에 공개해도 법령센터로 나가는 요청은 여전히 내 PC에서 출발합니다. **IP 등록은 내 PC 한 곳이면 됩니다.**
- 인증키는 `.env.local`에서만 읽고 응답·오류·로그에 나오지 않습니다(시작 로그에는 `bw*****`처럼 가려서 표시).

## 1. 준비

Python 3.10 이상이 필요합니다. `.env.local`은 다음 순서로 찾습니다(먼저 찾은 값이 우선).

1. 현재 폴더
2. `proxy/`
3. 프로젝트 루트(`law-for-all/`)
4. `python/`

이미 `키설정.bat`으로 만든 `.env.local`이 있으면 그대로 씁니다. 없다면 `.env.example`을 복사해 `LAW_API_OC=발급받은키`를 채우세요.

## 2. 실행

| 환경 | 명령 |
|---|---|
| Windows | `프록시실행.bat` 더블클릭 |
| macOS/Linux | `./run.sh` |
| 직접 | `pip install -r requirements.txt` → `uvicorn main:app --host 0.0.0.0 --port 8787` |

## 3. 로컬 테스트

| 확인 | 주소 |
|---|---|
| 테스트 화면 | http://127.0.0.1:8787 (검색 → 항목 클릭 시 조문·판례 원문) |
| 서버 상태 | http://127.0.0.1:8787/health |
| **법령센터 실제 연결** | http://127.0.0.1:8787/api/health/live → `"국가법령정보센터 실시간 연결 성공"` |
| API 문서(Swagger) | http://127.0.0.1:8787/docs |

```bash
curl "http://127.0.0.1:8787/api/search?query=주택임대차"                 # 법령 검색
curl "http://127.0.0.1:8787/api/law?mst=276291&article=3의2"           # 조문 본문
curl "http://127.0.0.1:8787/api/search?query=층간소음&target=prec"      # 판례(제목 0건이면 본문 검색 자동 재시도)
curl "http://127.0.0.1:8787/api/case?id=618229"                         # 판례 상세
```

### API 요약

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/search?query=&target=&display=&page=&search=` | `target`: `law` 법령 · `prec` 판례 · `expc` 법령해석례 · `admrul` 행정규칙 · `ordin` 자치법규 · `detc` 헌재결정례. `search=2`는 본문 검색 |
| `GET /api/law?mst=` 또는 `?id=` (`&article=3의2`) | 법령 기본정보·조문·제개정이유 |
| `GET /api/case?id=&target=prec\|expc\|detc` | 판시사항·판결요지·전문 / 질의요지·회답·이유 |
| `GET /api/raw/lawSearch.do?target=...` | 원본 JSON 그대로(OC는 서버가 붙임) |
| `GET /health`, `GET /api/health/live` | 상태 / 실제 연결 확인 |

모든 응답은 `{"ok": true, ...}` 형식입니다. 실패하면 `{"ok": false, "error": "..."}`가 오고, 미등록 IP는 HTTP 403을 받습니다.

### 프런트엔드에서 호출

```js
const BASE = "https://xxxx.trycloudflare.com"; // 또는 http://127.0.0.1:8787
const res = await fetch(`${BASE}/api/search?query=${encodeURIComponent("층간소음")}&target=prec`, {
  headers: { "X-Proxy-Token": "설정한_토큰" }, // PROXY_TOKEN 을 쓸 때만
});
const { ok, items, error } = await res.json();
```

## 4. 외부 공개 — Cloudflare Tunnel(무료, 가입 불필요)

```powershell
# 1) 설치 (한 번만)
winget install --id Cloudflare.cloudflared      # Windows
brew install cloudflared                        # macOS

# 2) 프록시 서버를 켠 상태에서, 새 터미널에서
cloudflared tunnel --url http://localhost:8787
```

출력되는 `https://<임의 이름>.trycloudflare.com`이 공개 URL입니다. Windows에서는 `공개URL.bat`이 설치와 실행을 대신합니다.

- **Quick Tunnel 주소는 실행할 때마다 바뀝니다.** 창을 닫거나 PC가 꺼지면 접속이 끊깁니다. 심사 기간에는 PC를 켜 두세요.
- 주소를 고정하려면 Cloudflare 계정과 도메인으로 Named Tunnel을 만드세요: `cloudflared tunnel login` → `cloudflared tunnel create law-on` → `cloudflared tunnel route dns law-on api.내도메인` → `cloudflared tunnel run --url http://localhost:8787 law-on`.

### 공개할 때 권장 설정 (`.env.local`)

```
PROXY_TOKEN=아무도모르는긴문자열     # 토큰 없는 /api/* 호출은 401
CORS_ORIGINS=https://내프런트주소    # 허용 출처 제한
RATE_LIMIT_PER_MIN=300                # IP당 분당 호출 제한(초과 시 429)
```

토큰을 쓰면 테스트 화면은 `https://….trycloudflare.com/?token=토큰`으로 엽니다.
