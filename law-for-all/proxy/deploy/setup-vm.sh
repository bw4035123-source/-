#!/usr/bin/env bash
# 법이음 법령 API 중계 서버 — 고정 IP 리눅스 VM 설치 스크립트 (Ubuntu 22.04 / 24.04)
#
# 하는 일
#   1) Python 가상환경에 FastAPI 서버 설치 → systemd 서비스(부팅 시 자동 시작, 죽으면 자동 재시작)
#   2) Caddy 웹서버로 HTTPS 자동 발급(도메인이 없으면 <IP>.sslip.io 무료 주소 사용)
#   3) 방화벽 80/443 열기(Oracle Cloud 우분투 이미지의 iptables 규칙 포함)
#   4) 마지막에 open.law.go.kr 에 등록할 고정 IP와 최종 주소, 실제 연결 결과 출력
#
# 사용법 (proxy 폴더를 VM에 올린 뒤)
#   sudo bash deploy/setup-vm.sh
# 환경변수로 미리 넘길 수도 있음(물어보지 않음)
#   sudo LAW_API_OC=키 PROXY_TOKEN=토큰 DOMAIN=api.example.com bash deploy/setup-vm.sh
# 다시 실행하면 코드·설정만 갱신(멱등)
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "sudo 로 실행하세요: sudo bash $0"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$SRC/main.py" ]] || { echo "main.py 를 찾을 수 없습니다. proxy 폴더 안에서 실행하세요."; exit 1; }

APP=/opt/law-proxy
ENV_DIR=/etc/law-proxy
ENV_FILE=$ENV_DIR/env
PORT=8787

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

# ── 설정값 ───────────────────────────────────────────────
OLD_OC=""; OLD_TOKEN=""
if [[ -f $ENV_FILE ]]; then
  OLD_OC=$(sed -n 's/^LAW_API_OC=//p' "$ENV_FILE")
  OLD_TOKEN=$(sed -n 's/^PROXY_TOKEN=//p' "$ENV_FILE")
fi
LAW_API_OC=${LAW_API_OC:-$OLD_OC}
if [[ -z $LAW_API_OC ]]; then
  read -rsp "국가법령정보 Open API 인증키(OC): " LAW_API_OC; echo
fi
[[ -n $LAW_API_OC ]] || { echo "인증키가 필요합니다."; exit 1; }
if [[ -z ${PROXY_TOKEN+x} ]]; then
  if [[ -n $OLD_TOKEN ]]; then PROXY_TOKEN=$OLD_TOKEN
  else read -rp "접근 토큰(PROXY_TOKEN, 비우면 사용 안 함): " PROXY_TOKEN; fi
fi

step "1/5 패키지 설치"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv curl debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

step "2/5 서버 코드·가상환경"
id lawproxy >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin lawproxy
mkdir -p "$APP"
cp -r "$SRC/main.py" "$SRC/requirements.txt" "$SRC/static" "$APP/"
[[ -d $APP/venv ]] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/requirements.txt"
chown -R lawproxy:lawproxy "$APP"

mkdir -p "$ENV_DIR"
umask 077
cat > "$ENV_FILE" <<EOF
LAW_API_OC=$LAW_API_OC
PROXY_TOKEN=$PROXY_TOKEN
CORS_ORIGINS=${CORS_ORIGINS:-*}
RATE_LIMIT_PER_MIN=${RATE_LIMIT_PER_MIN:-300}
EOF
umask 022
chmod 600 "$ENV_FILE"

step "3/5 systemd 서비스(24시간 상시 실행·자동 재시작)"
cat > /etc/systemd/system/law-proxy.service <<EOF
[Unit]
Description=LAW:ON law.go.kr API relay (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
User=lawproxy
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$APP/venv/bin/uvicorn main:app --host 127.0.0.1 --port $PORT --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now law-proxy >/dev/null 2>&1
systemctl restart law-proxy

step "4/5 HTTPS(Caddy)·방화벽"
PUBLIC_IP=$(curl -s4 --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
[[ -n $PUBLIC_IP ]] || { echo "공인 IP를 확인할 수 없습니다."; exit 1; }
DOMAIN=${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
# Oracle Cloud 우분투 이미지는 iptables 가 80/443 을 막아 둠 → 허용 규칙을 맨 앞에 추가
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null ||
    iptables -I INPUT -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT
done
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

step "5/5 확인"
sleep 3
HDR=(); [[ -n $PROXY_TOKEN ]] && HDR=(-H "X-Proxy-Token: $PROXY_TOKEN")
LIVE=$(curl -s --max-time 30 "${HDR[@]}" "http://127.0.0.1:$PORT/api/health/live" || true)
EGRESS=$(curl -s --max-time 30 "${HDR[@]}" "http://127.0.0.1:$PORT/api/egress-ip" || true)

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 설치 완료
 ● open.law.go.kr 에 등록할 고정 IP : $PUBLIC_IP
 ● 외부 IP 확인 결과                : $EGRESS
 ● 중계 서버 주소(LAW_PROXY_URL)     : https://$DOMAIN
 ● 법령센터 연결 확인                : $LIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 - '인증 실패'가 나오면 위 IP를 open.law.go.kr [OPEN API] 인증키의 서버 IP에 등록한 뒤
   몇 분 후: curl ${PROXY_TOKEN:+-H 'X-Proxy-Token: ***' }https://$DOMAIN/api/health/live
 - HTTPS 인증서는 첫 접속 때 발급됩니다(클라우드 콘솔에서 80·443 인바운드 허용 필요).
 - 로그: journalctl -u law-proxy -f   /  재시작: sudo systemctl restart law-proxy
 - 법이음 앱 .env.local: LAW_PROXY_URL=https://$DOMAIN${PROXY_TOKEN:+  /  LAW_PROXY_TOKEN=(설정한 토큰)}
EOF
