"""다이수 실행: python run.py  →  브라우저에서 http://127.0.0.1:8770 접속

처음 실행하면 필요한 패키지를 자동으로 설치합니다(같은 폴더에 wheels/ 가 있으면 인터넷 없이 설치).

옵션
  --port 8770          포트 변경(사용 중이면 다음 빈 포트를 자동 선택)
  --host 127.0.0.1     다른 PC에서 접속하게 하려면 0.0.0.0 (내부망에서만 권장)
  --model offline      사용할 AI 모델 프로필(config/settings.json 의 profiles 이름)
  --no-browser         브라우저 자동 열기 끄기
  --no-install         패키지 자동 설치 끄기
  --check              실행 환경만 점검하고 종료
"""
import argparse
import importlib.util
import os
import socket
import subprocess
import sys
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_PY = (3, 10)
LAST_ERROR = ""

# (import 이름 후보, pip 패키지 이름)
REQUIRED = [
    (("fastapi",), "fastapi>=0.110"),
    (("uvicorn",), "uvicorn>=0.27"),
    (("python_multipart", "multipart"), "python-multipart>=0.0.9"),
    (("pypdf",), "pypdf>=4.0"),
    (("openpyxl",), "openpyxl>=3.1"),
    (("olefile",), "olefile>=0.46"),
    (("docx",), "python-docx>=1.1"),
    (("hwpx",), "python-hwpx==6.8.0"),
]


def _console_utf8():
    # 윈도우 명령창(cp949)에서 특수문자 출력 오류가 나지 않도록
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def missing_packages():
    return [pip for names, pip in REQUIRED if not any(importlib.util.find_spec(n) for n in names)]


def install(packages):
    wheels = os.path.join(HERE, "wheels")
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q"]
    if os.path.isdir(wheels):
        cmd += ["--no-index", "--find-links", wheels]
        print("  · wheels 폴더에서 설치합니다(인터넷 불필요)")
    if sys.prefix == sys.base_prefix and not os.environ.get("VIRTUAL_ENV"):
        cmd.append("--user")  # 관리자 권한 없이 설치
    print("  · 설치:", ", ".join(packages))
    global LAST_ERROR
    r = subprocess.run(cmd + packages, capture_output=True, text=True)
    if r.returncode != 0 and "--user" in cmd:  # 일부 환경은 --user 불가 → 한 번 더
        r = subprocess.run([c for c in cmd if c != "--user"] + packages, capture_output=True, text=True)
    LAST_ERROR = (r.stderr or r.stdout or "").strip()[-600:]
    if r.returncode == 0:  # 방금 만든 사용자 패키지 폴더를 이번 실행에도 반영
        import site
        user_site = site.getusersitepackages()
        if os.path.isdir(user_site) and user_site not in sys.path:
            sys.path.append(user_site)
    importlib.invalidate_caches()
    return r.returncode == 0 and not missing_packages()


def relaunch_in_venv():
    venv = os.path.join(HERE, ".venv")
    py = os.path.join(venv, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv, "bin", "python")
    print("  · 시스템 파이썬에 설치할 수 없어 전용 가상환경(.venv)을 만듭니다")
    if not os.path.exists(py):
        import venv as _venv
        try:
            _venv.create(venv, with_pip=True)
        except Exception as e:
            print("  ✖ 가상환경 생성 실패:", e)
            return
    r = subprocess.run([py, os.path.abspath(__file__)] + sys.argv[1:])
    sys.exit(r.returncode)


def free_port(host, port, tries=20):
    for p in range(port, port + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host if host not in ("0.0.0.0", "::") else "", p))
                return p
            except OSError:
                continue
    return None


def check_env():
    ok = True
    py = sys.version_info
    print(f"  [{'✔' if py >= MIN_PY else '✖'}] 파이썬 {py.major}.{py.minor}.{py.micro} (필요: {MIN_PY[0]}.{MIN_PY[1]} 이상)")
    ok &= py >= MIN_PY
    miss = missing_packages()
    print(f"  [{'✔' if not miss else '✖'}] 필요 패키지" + (f" – 없음: {', '.join(miss)}" if miss else " 모두 설치됨"))
    ok &= not miss
    sample = os.path.join(HERE, "sample_data", "가상구시설관리공단_교육자료")
    print(f"  [{'✔' if os.path.isdir(sample) else '△'}] 모의데이터 폴더" + ("" if os.path.isdir(sample) else " 없음(샘플 체험 불가)"))
    try:
        ws = os.environ.get("DAISU_WORKSPACE", os.path.join(HERE, "workspace"))
        os.makedirs(ws, exist_ok=True)
        open(os.path.join(ws, ".write_test"), "w").close()
        os.remove(os.path.join(ws, ".write_test"))
        print(f"  [✔] 작업 폴더 쓰기 가능: {ws}")
    except OSError as e:
        print(f"  [✖] 작업 폴더에 쓸 수 없음: {e}")
        ok = False
    return ok


def main():
    _console_utf8()
    ap = argparse.ArgumentParser(description="다이수 – 법정의무교육 비서")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--model", default=None, help="AI 모델 프로필 이름(예: offline, ollama-exaone)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-install", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    print("\n  다이수 – 법정의무교육 비서")
    if sys.version_info < MIN_PY:
        print(f"\n  ✖ 파이썬 {MIN_PY[0]}.{MIN_PY[1]} 이상이 필요합니다(현재 {sys.version.split()[0]}).")
        print("    https://www.python.org 에서 최신 버전을 설치한 뒤 다시 실행하세요.")
        sys.exit(1)
    if args.check:
        sys.exit(0 if check_env() else 1)

    miss = missing_packages()
    if miss:
        if args.no_install:
            print("\n  ✖ 필요한 패키지가 없습니다:", ", ".join(miss))
            print(f"    {sys.executable} -m pip install -r requirements.txt")
            sys.exit(1)
        print("\n  처음 실행이라 필요한 패키지를 설치합니다(1~2분)…")
        ok = install(miss)
        if not ok and sys.prefix == sys.base_prefix:
            relaunch_in_venv()  # 시스템 파이썬에 설치가 막힌 경우: 전용 .venv 를 만들어 다시 실행
        if not ok:
            print("\n  ✖ 자동 설치에 실패했습니다.")
            if LAST_ERROR:
                print("    pip 메시지:", LAST_ERROR.replace("\n", "\n    "))
            print("    아래 명령을 직접 실행해 보세요:")
            print(f"    {sys.executable} -m pip install -r \"{os.path.join(HERE, 'requirements.txt')}\"")
            print("    (폐쇄망이면 인터넷 PC에서 'pip download -r requirements.txt -d wheels' 후 wheels 폴더를 함께 옮기세요)")
            sys.exit(1)
        print("  ✔ 설치 완료")

    if args.model:
        os.environ["DAISU_LLM"] = args.model
    sys.path.insert(0, HERE)
    os.chdir(HERE)

    port = free_port(args.host, args.port)
    if port is None:
        print(f"\n  ✖ {args.port}~{args.port + 19}번 포트가 모두 사용 중입니다. --port 로 다른 번호를 지정하세요.")
        sys.exit(1)
    if port != args.port:
        print(f"  · {args.port}번 포트가 사용 중이라 {port}번으로 실행합니다")

    import uvicorn

    from daisu.server import app

    if args.host not in ("127.0.0.1", "localhost"):
        # 내부망 공유: 이 PC 이름·주소로 들어오는 접속을 허용(그 밖의 Host 는 DNS 리바인딩 방지를 위해 거부)
        names = {socket.gethostname().lower(), socket.getfqdn().lower()}
        try:
            names |= {a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None)}
        except OSError:
            pass
        if args.host not in ("0.0.0.0", "::"):
            names.add(args.host)
        os.environ["DAISU_ALLOWED_HOSTS"] = ",".join(sorted({n for n in names if n} | set(filter(None, os.environ.get("DAISU_ALLOWED_HOSTS", "").split(",")))))
    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{port}"
    print(f"\n  ▶ 실행 중: {url}")
    print("    브라우저가 열리지 않으면 위 주소를 직접 입력하세요. (종료: Ctrl+C)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        uvicorn.run(app, host=args.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    print("  다이수를 종료했습니다.")


if __name__ == "__main__":
    main()
