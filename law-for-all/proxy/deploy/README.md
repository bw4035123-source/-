# 고정 IP 24시간 운영 가이드 — 법령 API 중계 서버

## 왜 Render(무료)로는 안 되는가

| 문제 | 원인 |
|---|---|
| `인증 실패: 사용자 정보 검증에 실패…` | 국가법령정보센터는 **단일 고정 공인 IP**만 승인합니다. Render·Vercel·Cloudflare Workers 같은 PaaS는 여러 서버가 공유하는 IP 대역에서 나가서, 요청마다 IP가 바뀝니다. |
| 첫 요청이 30~60초 걸림 | Render 무료 인스턴스는 15분 동안 요청이 없으면 잠듭니다. |

**해결:** 고정 공인 IP가 붙는 **리눅스 VM** 한 대에 중계 서버를 올립니다. VM은 계속 켜져 있으니 슬립 문제도 함께 사라집니다.

```
법이음 앱(어디서든) ──HTTPS──► VM(고정 IP) : Caddy ─► FastAPI 중계 서버 ──► www.law.go.kr
                                 └ 이 IP 하나만 open.law.go.kr 에 등록
```

## 어디에 올릴까

| | **A. Oracle Cloud Always Free** (권장) | **B. AWS Lightsail 서울** |
|---|---|---|
| 비용 | 무료(Always Free 한도 안) | 월 약 5달러(IPv4 포함 최저 요금제). 신규 계정은 일부 요금제가 일정 기간 무료이니 콘솔에서 확인 |
| 지역 | 서울·춘천 | 서울(ap-northeast-2) |
| 고정 IP | 예약(Reserved) 공인 IP | Static IP(인스턴스에 연결돼 있는 동안 무료) |
| 가입 | 카드 인증 필요(과금 없음) | 카드 필요 |
| 주의 | 무료 계정은 CPU 사용이 매우 낮으면 유휴 인스턴스로 회수될 수 있음 → 아래 '안정 운영' 참고 | 없음(가장 단순) |

> 공공기관 납품·보안 요건이 있으면 네이버 클라우드·KT 클라우드 같은 국내 VM에서도 같은 스크립트로 설치할 수 있습니다(Ubuntu 기준).

---

## A. Oracle Cloud Always Free (약 20분)

1. **가입**: https://www.oracle.com/cloud/free → 홈 리전을 **South Korea Central (Seoul)** 또는 **North (Chuncheon)** 으로 고릅니다. 홈 리전은 나중에 바꿀 수 없습니다.
2. **VM 만들기**: 메뉴 → Compute → Instances → **Create instance**
   - Image: **Canonical Ubuntu 22.04** (또는 24.04)
   - Shape: **VM.Standard.E2.1.Micro** (Always Free). Ampere A1도 무료지만 '용량 부족'이 자주 납니다.
   - Networking: 새 VCN 생성(기본값), **Assign a public IPv4 address** 체크
   - SSH 키: '키 쌍 생성' → 개인키 내려받기
3. **IP를 고정으로**: 인스턴스 → Attached VNICs → VNIC → IPv4 Addresses → ⋮ Edit → **Reserved public IP** → 새로 만들기
   - 이렇게 하면 인스턴스를 다시 만들어도 같은 IP를 쓸 수 있습니다.
4. **포트 열기**: VNIC의 Subnet → Security List → **Add Ingress Rules**
   - Source CIDR `0.0.0.0/0`, TCP, Destination Port `80,443`
5. 아래 **[공통] 설치**로 이동합니다.

## B. AWS Lightsail 서울 (약 10분)

1. https://lightsail.aws.amazon.com → **Create instance**
   - 리전 **Seoul**, 플랫폼 Linux, 블루프린트 **OS Only → Ubuntu 22.04**
   - 요금제: **IPv4가 포함된** 요금제(가장 저렴한 IPv6 전용 요금제는 국가법령정보센터 접속 불가)
2. **Networking** 탭 → **Create static IP** → 이 인스턴스에 연결
3. 같은 탭 IPv4 Firewall에 **HTTPS(443)** 추가(HTTP 80은 기본 열림)
4. 아래 **[공통] 설치**로 이동합니다.

---

## [공통] 설치 — 명령 3줄

VM에 SSH로 접속합니다. 사용자명은 Oracle이 `ubuntu`, Lightsail은 브라우저 SSH 버튼으로 접속합니다.

```bash
ssh -i 내려받은키.key ubuntu@고정IP
```

코드를 받고 설치 스크립트를 실행합니다.

```bash
sudo apt-get update && sudo apt-get install -y git
git clone -b claude/bold-sagan-wxagtd --depth 1 https://github.com/bw4035123-source/-.git law-on
cd law-on/law-for-all/proxy && sudo bash deploy/setup-vm.sh
```

- 저장소가 **비공개**면 `git clone` 때 비밀번호 자리에 GitHub **Personal Access Token**(repo 읽기 권한)을 넣습니다.
- 또는 `law-on-proxy.zip`을 `scp law-on-proxy.zip ubuntu@고정IP:~`로 올리고 `unzip law-on-proxy.zip -d proxy && cd proxy && sudo bash deploy/setup-vm.sh` 하셔도 됩니다.

스크립트가 인증키(OC)와 접근 토큰(선택)을 물어본 뒤 아래를 자동으로 처리합니다.

- Python 가상환경과 서버 설치
- **systemd 서비스**: 부팅 시 자동 시작, 오류로 죽으면 3초 뒤 자동 재시작
- **Caddy**로 HTTPS 인증서 자동 발급·갱신. 도메인이 없으면 `고정IP.sslip.io` 무료 주소를 씁니다(예: `152-70-1-2.sslip.io`).
- 방화벽 80/443 열기(Oracle 우분투의 iptables 규칙 포함)
- 끝나면 **등록할 IP**, **최종 주소**, **법령센터 연결 결과**를 출력

## 국가법령정보센터 등록 → 확인

1. open.law.go.kr 로그인 → [OPEN API] → 인증키 → 서버 IP에 **스크립트가 출력한 고정 IP 하나**를 등록합니다.
   - Render용으로 넣었던 IP들은 지워도 됩니다.
2. 몇 분 뒤 브라우저에서 확인합니다.
   - `https://<주소>/api/egress-ip` → `"stable": true`이고, 등록한 IP와 같아야 합니다.
   - `https://<주소>/api/health/live` → `"국가법령정보센터 실시간 연결 성공"`
   - 토큰을 설정했다면 주소 뒤에 `?token=토큰`을 붙입니다.

## 법이음 앱 연결

앱의 `.env.local`(Next.js는 `law-for-all/.env.local`, Python 실행판은 `python/.env.local`)에 아래를 넣습니다.

```
LAW_PROXY_URL=https://<스크립트가 출력한 주소>
LAW_PROXY_TOKEN=<설정한 토큰, 없으면 비움>
```

앱을 Render 등에 배포했다면 그 서비스의 환경변수에 같은 두 값을 넣습니다.
- 앱 서버는 IP 등록이 필요 없습니다. 국가법령정보센터를 부르는 건 VM뿐입니다.
- 이전 Render 중계 서버는 꺼도 됩니다.

## 안정 운영

| 할 일 | 방법 |
|---|---|
| 상태 감시(무료) | [UptimeRobot](https://uptimerobot.com)에서 `https://<주소>/health`를 5분 간격 HTTP 모니터로 등록 → 장애 시 메일 알림 |
| Oracle 유휴 회수 방지 | 계정을 **Pay As You Go**로 업그레이드하면 유휴 회수 정책이 적용되지 않습니다. Always Free 한도 안에서는 계속 무료입니다. |
| 코드 업데이트 | `cd ~/law-on && git pull && cd law-for-all/proxy && sudo bash deploy/setup-vm.sh` (설정은 유지) |
| 로그·재시작 | `journalctl -u law-proxy -f` / `sudo systemctl restart law-proxy` |
| 인증키 변경 | `sudo nano /etc/law-proxy/env` → `sudo systemctl restart law-proxy` |
| 고정 도메인 | 도메인이 있으면 A 레코드를 고정 IP로 → `sudo DOMAIN=api.내도메인 bash deploy/setup-vm.sh` |
