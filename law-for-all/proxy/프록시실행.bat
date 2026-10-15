@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [법이음 프록시] 필요한 패키지 설치 중...
python -m pip install -q -r requirements.txt
if errorlevel 1 (echo Python 3.10 이상이 필요합니다. https://www.python.org & pause & exit /b 1)
echo [법이음 프록시] http://127.0.0.1:8787 에서 시작합니다. 종료: Ctrl+C
start "" http://127.0.0.1:8787
python -m uvicorn main:app --host 0.0.0.0 --port 8787
pause
