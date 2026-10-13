@echo off
setlocal
cd /d "%~dp0"
title 다이수 - 법정의무교육 비서
rem 다이수 실행: 파이썬을 찾아 run.py 를 실행한다. 실행 환경 만들기·설치·기록은 run.py 가 맡는다.
rem 사용법: run.bat [--port 번호] [--reinstall] [--check]

call "%~dp0tools\find_python.bat"
if defined PY goto run

echo.
echo   [오류] Python 3.10 이상을 찾지 못했습니다.
echo   1. https://www.python.org/downloads/ 에서 Python 을 내려받아 설치하세요.
echo   2. 설치 첫 화면 아래쪽 "Add python.exe to PATH" 를 꼭 체크하세요.
echo   3. 설치가 끝나면 이 창을 닫고 run.bat 을 다시 실행하세요.
echo.
echo [%date% %time%] python not found >> "%~dp0run_log.txt"
pause
exit /b 1

:run
echo   사용 파이썬: %PY%
%PY% "%~dp0run.py" %*
if errorlevel 1 goto failed
goto end

:failed
echo.
echo   [오류] 다이수가 정상 종료되지 않았습니다. 위 메시지를 확인하세요.
echo   - 같은 폴더의 run_log.txt 에 자세한 기록이 있습니다(문의 시 이 파일을 보내 주세요).
echo   - 실행 환경을 새로 만들려면: run.bat --reinstall
pause

:end
endlocal
