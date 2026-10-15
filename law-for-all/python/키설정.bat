@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 법이음 - 국가법령정보 API 인증키(OC) 설정
where py >nul 2>nul && (py -3 run.py --setup-key & goto :end)
where python >nul 2>nul && (python run.py --setup-key & goto :end)
echo Python 3.9 이상이 필요합니다: https://www.python.org/downloads/
:end
pause
