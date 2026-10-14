@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 법이음 - Python 실행기(Windows). 외부 라이브러리 설치 불필요
where py >nul 2>nul && (py -3 run.py %* & goto :end)
where python >nul 2>nul && (python run.py %* & goto :end)
echo Python 3.9 이상이 필요합니다: https://www.python.org/downloads/  (설치 시 "Add python.exe to PATH" 체크)
pause
:end
