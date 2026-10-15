@echo off
chcp 65001 >nul
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared 설치 중... ^(winget^)
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo 설치가 끝나면 이 창을 닫고 공개URL.bat 을 다시 실행하세요.
  pause & exit /b 0
)
echo 먼저 프록시실행.bat 이 켜져 있어야 합니다.
echo 아래에 나오는 https://....trycloudflare.com 주소가 외부 공개 URL 입니다.
cloudflared tunnel --url http://localhost:8787
pause
