@echo off
rem 실제 동작하는 Python 3.10 이상을 찾아 PY 변수에 넣는다. (call 로 불러 쓰는 공용 스크립트)
rem  - Microsoft Store 바로가기 python.exe(실행하면 스토어가 열리는 가짜)는 실행 시험으로 걸러낸다
rem  - 순서: PATH의 python → py 런처(3.13~3.10) → 기본 설치 폴더
set "PY="
set "PYCHK=import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"

python -c "%PYCHK%" >nul 2>nul && set "PY=python"
if defined PY goto :eof

for %%v in (3.13 3.12 3.11 3.10 3) do if not defined PY py -%%v -c "%PYCHK%" >nul 2>nul && set "PY=py -%%v"
if defined PY goto :eof

for /d %%d in ("%LocalAppData%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%ProgramFiles(x86)%\Python3*") do if not defined PY if exist "%%~fd\python.exe" "%%~fd\python.exe" -c "%PYCHK%" >nul 2>nul && set PY="%%~fd\python.exe"
goto :eof
