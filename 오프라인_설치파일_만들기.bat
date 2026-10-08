@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"
title 업무바통 - 인터넷이 막힌 PC용 설치 파일 만들기
echo.
echo   인터넷이 되는 PC에서 실행하세요.
echo   wheels 폴더에 64비트 Windows용 설치 파일(Python 3.10~3.13)을 모두 내려받습니다.
echo   다 받으면 업무바통 폴더를 통째로(wheels 포함) 인터넷이 막힌 PC로 옮기고 run.bat 을 실행하면 됩니다.
echo.
call "%~dp0tools\find_python.bat"
if defined PY goto foundpy
echo   [오류] Python 3.10 이상을 찾지 못했습니다. https://www.python.org/downloads/ 에서 설치하세요.
pause
exit /b 1

:foundpy
if not exist wheels mkdir wheels
for %%v in (310 311 312 313) do (
  echo   - Python %%v 용 내려받는 중...
  %PY% -m pip download -q --disable-pip-version-check -r requirements.txt -d wheels --only-binary=:all: --platform win_amd64 --python-version %%v
)
if errorlevel 1 goto fail
echo.
echo   완료: wheels 폴더가 준비되었습니다.
pause
exit /b 0

:fail
echo.
echo   [오류] 내려받기에 실패했습니다. 인터넷 연결이나 프록시 설정을 확인하세요.
pause
exit /b 1
