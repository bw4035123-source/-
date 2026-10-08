@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"
title 업무바통 - 모델 2종 검증
echo.
echo   업무바통 - AI 모델 2종 이상 정상 구동 검증
echo   -----------------------------------------
echo   사용법: 모델검증.bat [모델1] [모델2] ...   (기본: gemma3:4b exaone3.5:7.8b)
echo.

where ollama >nul 2>nul
if not errorlevel 1 goto haveollama
echo   [오류] Ollama 가 필요합니다. https://ollama.com/download 에서 설치한 뒤 다시 실행하세요.
echo   - AI 공통기반 등 다른 서버는 README 의 '직접 실행' 명령을 쓰세요.
pause
exit /b 1

:haveollama
set "MODELS=%*"
if "%MODELS%"=="" set "MODELS=gemma3:4b exaone3.5:7.8b"

if defined OLLAMA_MODELS goto storeok
echo   주의: 모델 파일(모델마다 수 GB)을 C 드라이브 사용자 폴더(.ollama)에 받습니다.
echo   다른 드라이브에 받으려면 N 을 누르고, 환경변수 OLLAMA_MODELS 를 지정한 뒤 Ollama 를 다시 시작하세요.
choice /c YN /m "  C 드라이브에 받을까요"
if errorlevel 2 exit /b 1
goto pull
:storeok
echo   모델 저장 위치: %OLLAMA_MODELS%

:pull
echo.
echo [1/3] 모델을 준비합니다: %MODELS%
for %%m in (%MODELS%) do (
  echo   - %%m 내려받는 중...
  ollama pull %%m
  if errorlevel 1 goto pullfail
)

echo [2/3] 실행 환경을 확인합니다...
set "VPY=.venv\Scripts\python.exe"
if exist "%VPY%" goto venvok
call "%~dp0tools\find_python.bat"
if not defined PY goto nopy
%PY% -m venv .venv
:venvok
"%VPY%" -m pip install -q --disable-pip-version-check -r requirements.txt

echo [3/3] 같은 기능을 모델별로 돌려 결과를 원문과 대조합니다...
"%VPY%" tools\verify_models.py --base-url http://localhost:11434/v1 --models %MODELS%
echo.
echo   결과 보고서: %CD%\verify_report.md  (구동안내서·제출물에 첨부하세요)
pause
exit /b 0

:pullfail
echo   [오류] 모델을 내려받지 못했습니다. 모델 이름과 인터넷 연결을 확인하세요.
pause
exit /b 1

:nopy
echo   [오류] Python 3.10 이상을 찾지 못했습니다. run.bat 을 먼저 실행해 보세요.
pause
exit /b 1
