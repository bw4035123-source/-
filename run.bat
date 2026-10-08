@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"
title 업무바통 - AI 인수인계 도우미
echo.
echo   업무바통 - AI 인수인계 도우미
echo   -----------------------------------------
echo   사용법: run.bat [--model 프로필] [--port 번호] [--check] [--reinstall]
echo.

set "VPY=.venv\Scripts\python.exe"
set "PYCHK=import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"

rem --reinstall : 실행 환경(.venv)을 지우고 처음부터 다시 만든다
if /i "%~1"=="--reinstall" goto reinstall
goto checkvenv

:reinstall
echo [1/3] 실행 환경을 지우고 다시 만듭니다...
if exist .venv rmdir /s /q .venv
shift

:checkvenv
rem 1) 이미 만든 실행 환경이 정상이면 그대로 사용(파이썬을 지우거나 버전을 바꾸면 자동으로 다시 만듦)
if not exist "%VPY%" goto makevenv
"%VPY%" -c "%PYCHK%" >nul 2>nul && goto venvok
echo [1/3] 실행 환경이 손상되어 다시 만듭니다...
rmdir /s /q .venv

:makevenv
rem 반쯤 지워진 실행 환경이 남아 있으면 새로 만들 수 없으므로 정리
if exist .venv rmdir /s /q .venv
call "%~dp0tools\find_python.bat"
if defined PY goto foundpy
echo.
echo   [오류] Python 3.10 이상을 찾지 못했습니다.
echo   1. https://www.python.org/downloads/ 에서 Python 을 내려받아 설치하세요.
echo   2. 설치 첫 화면 아래쪽 "Add python.exe to PATH" 를 꼭 체크하세요.
echo   3. 설치가 끝나면 이 창을 닫고 run.bat 을 다시 실행하세요.
echo.
pause
exit /b 1

:foundpy
echo [1/3] 처음 실행: 실행 환경을 준비합니다... (사용 파이썬: %PY%)
%PY% -m venv .venv
if exist "%VPY%" goto venvok
echo.
echo   [오류] 실행 환경을 만들지 못했습니다.
echo   - 폴더가 읽기 전용이거나 바이러스 백신이 막았을 수 있습니다.
echo   - 바탕화면이나 문서 폴더처럼 쓰기 가능한 곳에 압축을 풀고 다시 실행하세요.
echo.
pause
exit /b 1

:venvok
rem 2) 라이브러리 설치: requirements.txt 가 바뀌었을 때만 설치해 두 번째 실행부터는 바로 시작
fc /b requirements.txt .venv\requirements.stamp >nul 2>nul && goto installed
echo [2/3] 필요한 라이브러리를 설치합니다... (처음 1회, 1~2분)
if exist "wheels\" goto offline
"%VPY%" -m pip install -q --disable-pip-version-check -r requirements.txt
goto afterinstall

:offline
rem 인터넷이 막힌 PC: 같은 폴더의 wheels\ 에 미리 받아 둔 설치 파일로 설치
echo       wheels 폴더에서 설치합니다 (인터넷 불필요)
"%VPY%" -m pip install -q --disable-pip-version-check --no-index --find-links wheels -r requirements.txt

:afterinstall
if errorlevel 1 goto installfail
copy /y requirements.txt .venv\requirements.stamp >nul
goto installed

:installfail
echo.
echo   [주의] 라이브러리 설치에 실패했습니다. 인터넷 연결을 확인하세요.
echo   - 인터넷이 막힌 PC라면 README 의 '인터넷이 막힌 PC' 안내를 보세요.
echo   - 그래도 실행을 시도합니다. 부족한 라이브러리는 아래에 안내됩니다.
echo.

:installed
echo [3/3] 업무바통을 시작합니다. 잠시 후 브라우저가 열립니다.
"%VPY%" run.py %1 %2 %3 %4 %5 %6 %7 %8
if errorlevel 1 goto failed
goto end

:failed
echo.
echo   업무바통이 오류로 종료되었습니다. 위 메시지를 확인하세요.
echo   - 문제가 계속되면 run.bat --reinstall 로 실행 환경을 새로 만들어 보세요.
echo   - 환경 점검: run.bat --check

:end
echo.
pause
endlocal
