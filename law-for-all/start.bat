@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js가 필요합니다: https://nodejs.org & pause & exit /b 1)
if not exist .env.local copy .env.example .env.local >nul
if not exist node_modules call npm ci --no-audit --no-fund
set NODE_USE_ENV_PROXY=1
echo http://localhost:3000 에서 실행됩니다 (종료: Ctrl+C)
start "" http://localhost:3000
call npm run dev
