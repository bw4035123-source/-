@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo [업무바통] 처음 실행 시 필요한 프로그램을 설치합니다...
if not exist .venv (
  python -m venv .venv || (echo 파이썬 3.10 이상을 먼저 설치하세요: https://www.python.org & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
if exist wheels (
  pip install --no-index --find-links wheels -r requirements.txt -q
) else (
  pip install -r requirements.txt -q
)
python run.py %*
pause
