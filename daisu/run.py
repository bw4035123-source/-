"""다이수 실행: python run.py  →  브라우저에서 http://127.0.0.1:8770 접속

처음 실행하면 이 폴더 안에 전용 실행 환경(.venv)을 만들고 필요한 라이브러리를 설치합니다.
  1) 같은 폴더에 wheels/ 가 있으면 먼저 그것으로(인터넷 불필요) 설치하고
  2) 실패하면(파이썬 버전이 안 맞는 등) 인터넷으로 설치합니다.
진행 상황과 오류는 모두 run_log.txt 에 남습니다(문제가 생기면 이 파일을 보내 주세요).

옵션
  --port 8770          포트 변경(사용 중이면 다음 빈 포트를 자동 선택)
  --host 127.0.0.1     다른 PC에서 접속하게 하려면 0.0.0.0 (내부망에서만 권장)
  --model offline      사용할 AI 모델 프로필(config/settings.json 의 profiles 이름)
  --no-browser         브라우저 자동 열기 끄기
  --reinstall          실행 환경(.venv)을 지우고 처음부터 다시 설치
  --check              실행 환경만 점검하고 종료
"""
import argparse
import datetime
import hashlib
import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import threading
import traceback
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
VENV = os.path.join(HERE, ".venv")
LOG = os.path.join(HERE, "run_log.txt")
REQ = os.path.join(HERE, "requirements.txt")
WHEELS = os.path.join(HERE, "wheels")
MIN_PY = (3, 10)

# (import 이름 후보, pip 패키지 이름)
REQUIRED = [
    (("fastapi",), "fastapi"),
    (("uvicorn",), "uvicorn"),
    (("python_multipart", "multipart"), "python-multipart"),
    (("pypdf",), "pypdf"),
    (("openpyxl",), "openpyxl"),
    (("olefile",), "olefile"),
    (("docx",), "python-docx"),
    (("hwpx",), "python-hwpx"),
]


def _console_utf8():
    # 윈도우 명령창(cp949)에서 특수문자 출력 오류가 나지 않도록
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def log(msg="", screen=True):
    if screen:
        print(msg, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")
    except OSError:
        pass


def in_venv() -> bool:
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def venv_python() -> str:
    return os.path.join(VENV, "Scripts", "python.exe") if os.name == "nt" else os.path.join(VENV, "bin", "python")


def missing_packages():
    importlib.invalidate_caches()
    return [pip for names, pip in REQUIRED if not any(importlib.util.find_spec(n) for n in names)]


def _req_hash() -> str:
    with open(REQ, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _stamp_path():
    return os.path.join(sys.prefix, "daisu_requirements.stamp")


def _pip(extra: list, label: str) -> bool:
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", REQ] + extra
    if not in_venv():
        cmd.append("--user")  # 관리자 권한 없이
    log(f"  · {label}")
    log("    명령: " + " ".join(cmd), screen=False)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError as e:
        log(f"    pip 실행 실패: {e}")
        return False
    log((r.stdout or "")[-4000:], screen=False)
    log((r.stderr or "")[-4000:], screen=False)
    if r.returncode != 0:
        last = [ln for ln in (r.stderr or r.stdout or "").splitlines() if ln.strip()][-3:]
        log("    실패: " + " / ".join(last)[:400])
        return False
    return True


def ensure_pip() -> bool:
    r = subprocess.run([sys.executable, "-m", "pip", "--version"], capture_output=True, text=True)
    if r.returncode == 0:
        return True
    log("  · pip 가 없어 설치합니다(ensurepip)")
    r = subprocess.run([sys.executable, "-m", "ensurepip", "--upgrade"], capture_output=True, text=True)
    log((r.stdout or "") + (r.stderr or ""), screen=False)
    return r.returncode == 0


def install() -> bool:
    """wheels 폴더 → 인터넷 순서로 설치. 설치 기록(stamp)을 남겨 다음부터는 건너뛴다."""
    if not ensure_pip():
        log("  ✖ pip 를 준비하지 못했습니다(파이썬 설치가 불완전할 수 있음). python.org 설치판을 다시 설치해 보세요.")
        return False
    ok = False
    if os.path.isdir(WHEELS):
        ok = _pip(["--no-index", "--find-links", WHEELS], "wheels 폴더에서 설치합니다(인터넷 불필요)")
        if not ok:
            log("    → wheels 폴더 파일이 이 파이썬 버전과 맞지 않을 수 있어 인터넷 설치를 시도합니다")
    if not ok:
        ok = _pip(["--find-links", WHEELS] if os.path.isdir(WHEELS) else [], "인터넷에서 설치합니다(1~2분)")
    if ok and not missing_packages():
        try:
            with open(_stamp_path(), "w") as f:
                f.write(_req_hash())
        except OSError:
            pass
        return True
    return False


def installed_ok() -> bool:
    if missing_packages():
        return False
    try:
        with open(_stamp_path()) as f:
            return f.read().strip() == _req_hash()
    except OSError:
        return True  # 이미 다른 방법으로 설치된 환경


def make_venv() -> bool:
    py = venv_python()
    if os.path.exists(py):
        r = subprocess.run([py, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"], capture_output=True)
        if r.returncode == 0:
            return True
        log("  · 실행 환경이 손상되어 다시 만듭니다")
        shutil.rmtree(VENV, ignore_errors=True)
    log("  · 처음 실행: 이 폴더 안에 전용 실행 환경(.venv)을 만듭니다")
    r = subprocess.run([sys.executable, "-m", "venv", VENV], capture_output=True, text=True, encoding="utf-8", errors="replace")
    log((r.stdout or "") + (r.stderr or ""), screen=False)
    if r.returncode != 0 or not os.path.exists(py):
        log("    실행 환경을 만들지 못했습니다(백신·읽기 전용 폴더 등). 이 파이썬에 직접 설치를 시도합니다.")
        shutil.rmtree(VENV, ignore_errors=True)
        return False
    return True


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
    print(f"  [{'✔' if py >= MIN_PY else '✖'}] 파이썬 {py.major}.{py.minor}.{py.micro} ({sys.executable})")
    ok &= py >= MIN_PY
    miss = missing_packages()
    print(f"  [{'✔' if not miss else '✖'}] 필요 패키지" + (f" – 없음: {', '.join(miss)}" if miss else " 모두 설치됨"))
    ok &= not miss
    sample = os.path.join(HERE, "sample_data", "가상구시설관리공단_교육자료")
    print(f"  [{'✔' if os.path.isdir(sample) else '△'}] 모의데이터 폴더" + ("" if os.path.isdir(sample) else " 없음(샘플 체험 불가)"))
    print(f"  [{'✔' if os.path.isdir(WHEELS) else '·'}] wheels 폴더" + (" 있음(인터넷 없이 설치 가능)" if os.path.isdir(WHEELS) else " 없음(인터넷으로 설치)"))
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


def fail(msg: str):
    log("")
    log("  ✖ " + msg)
    log(f"    자세한 기록: {LOG}")
    log("    인터넷이 막힌 PC라면 ‘오프라인 설치파일 포함’ 압축파일을 쓰거나, 인터넷 되는 PC에서 오프라인_설치파일_만들기.bat 을 실행해 wheels 폴더를 옮기세요.")
    sys.exit(1)


def main():
    _console_utf8()
    ap = argparse.ArgumentParser(description="다이수 – 교육훈련 규정 해석·실적 보고 자동화")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--model", default=None, help="AI 모델 프로필 이름(예: offline, ollama-exaone)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-install", action="store_true")
    ap.add_argument("--no-venv", action="store_true", help="전용 실행 환경을 만들지 않고 지금 파이썬으로 실행")
    ap.add_argument("--reinstall", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--in-venv", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if not args.in_venv:
        log(f"===== 다이수 실행 (파이썬 {sys.version.split()[0]}, {sys.executable}, {sys.platform}) =====", screen=False)
        print("\n  다이수 – 교육훈련 규정 해석·실적 보고 자동화")
    if sys.version_info < MIN_PY:
        fail(f"파이썬 {MIN_PY[0]}.{MIN_PY[1]} 이상이 필요합니다(현재 {sys.version.split()[0]}). https://www.python.org 에서 최신 버전을 설치하세요.")
    if args.check:
        sys.exit(0 if check_env() else 1)

    # 1) 전용 실행 환경(.venv)에서 다시 실행
    if not in_venv() and not args.no_venv and not args.no_install:
        if args.reinstall:
            log("  · 실행 환경을 지우고 다시 만듭니다")
            shutil.rmtree(VENV, ignore_errors=True)
        if make_venv():
            argv = [a for a in sys.argv[1:] if a != "--reinstall"] + ["--in-venv"]
            try:
                r = subprocess.run([venv_python(), os.path.abspath(__file__)] + argv)
            except KeyboardInterrupt:
                sys.exit(0)
            sys.exit(r.returncode)

    # 2) 라이브러리 설치(필요할 때만)
    if not installed_ok():
        if args.no_install:
            fail("필요한 라이브러리가 없습니다: " + ", ".join(missing_packages()))
        log("\n  필요한 라이브러리를 설치합니다(처음 한 번, 1~2분)…")
        if not install():
            fail("라이브러리 설치에 실패했습니다. 인터넷(프록시) 연결을 확인하세요.")
        log("  ✔ 설치 완료")

    # 3) 실행
    if args.model:
        os.environ["DAISU_LLM"] = args.model
    sys.path.insert(0, HERE)
    os.chdir(HERE)
    port = free_port(args.host, args.port)
    if port is None:
        fail(f"{args.port}~{args.port + 19}번 포트가 모두 사용 중입니다. --port 로 다른 번호를 지정하세요.")
    if port != args.port:
        log(f"  · {args.port}번 포트가 사용 중이라 {port}번으로 실행합니다")
    try:
        import uvicorn

        from daisu.server import app
    except Exception:
        log(traceback.format_exc(), screen=False)
        fail("프로그램을 불러오지 못했습니다: " + traceback.format_exc().strip().splitlines()[-1])

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
    log(f"\n  ▶ 실행 중: {url}")
    print("    브라우저가 열리지 않으면 위 주소를 직접 입력하세요. (종료: Ctrl+C 또는 이 창 닫기)\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        uvicorn.run(app, host=args.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
    except Exception:
        log(traceback.format_exc(), screen=False)
        fail("실행 중 오류: " + traceback.format_exc().strip().splitlines()[-1])
    print("  다이수를 종료했습니다.")


if __name__ == "__main__":
    main()
