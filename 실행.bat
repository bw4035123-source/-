@echo off
chcp 65001 > nul
cd /d "%~dp0"
where py >nul 2>nul && (py -3 run.py %* & goto end)
where python >nul 2>nul && (python run.py %* & goto end)
echo 파이썬이 설치되어 있지 않습니다. https://www.python.org 에서 3.10 이상을 설치하세요.
:end
pause
