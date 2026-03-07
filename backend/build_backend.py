import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "bin"
BUILD_DIR = ROOT / "build"
SPEC_DIR = ROOT
ENTRYPOINT = ROOT / "run_backend.py"


def main() -> None:
    if not ENTRYPOINT.exists():
        raise FileNotFoundError(f"Backend entrypoint not found: {ENTRYPOINT}")
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "ib_backend",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(SPEC_DIR),
        "--collect-all",
        "ib_async",
        "--collect-all",
        "websockets",
        str(ENTRYPOINT)
    ]
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
