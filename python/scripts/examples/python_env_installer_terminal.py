#!/usr/bin/env python3
import os
import subprocess
import sys
from pathlib import Path


def tail_text(text: str, max_lines: int = 20) -> str:
    lines = [line for line in (text or "").splitlines() if line.strip()]
    return "\n".join(lines[-max_lines:])


def run_cmd(args, cwd):
    print(f"$ {' '.join(args)}")
    sys.stdout.flush()
    process = subprocess.run(args, cwd=str(cwd), text=True, capture_output=True)
    if process.stdout:
        print(process.stdout.rstrip())
    if process.stderr:
        print(process.stderr.rstrip())
    sys.stdout.flush()
    return process.returncode, process.stdout or "", process.stderr or ""


def ask_yes_no(prompt: str) -> bool:
    while True:
        answer = input(prompt).strip().lower()
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no", ""):
            return False
        print("Please answer with Y or N.")


def main() -> int:
    config_path = os.environ.get("SEAF_RUNTIME_CONFIG_PATH", "").strip()
    if not config_path:
        print("SEAF_RUNTIME_CONFIG_PATH is not set.")
        return 1

    conf_dir = Path(config_path).resolve().parent
    python_root = (conf_dir / ".." / "python").resolve()
    scripts_root = (python_root / "scripts").resolve()
    requirements_path = (python_root / "requirements.txt").resolve()
    venv_path = (python_root / ".venv").resolve()
    venv_python = venv_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    bootstrap_python = "python3"

    print("SEAF Python environment installer")
    print(f"Config: {config_path}")
    print(f"Python root: {python_root}")
    print(f"Scripts root: {scripts_root}")
    print(f"Venv path: {venv_path}")
    print("Mode: manual fallback installer")
    print("")

    if not scripts_root.exists():
        print("Scripts root does not exist. Runtime layout is broken.")
        return 1

    print("[phase] create-or-reuse-venv")
    if not venv_python.exists():
        if not ask_yes_no("Create local venv now? (Y/N): "):
            print("Cancelled by user.")
            return 1
        rc, _out, err = run_cmd([bootstrap_python, "-m", "venv", str(venv_path)], scripts_root)
        if rc != 0:
            print("Failed to create virtual environment.")
            print("---- error tail ----")
            print(tail_text(err))
            print("--------------------")
            return rc
    else:
        print("Local venv already exists, reuse it.")

    print("[phase] upgrade-pip")
    if ask_yes_no("Upgrade pip in local venv? (Y/N): "):
        rc, _out, err = run_cmd([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], scripts_root)
        if rc != 0:
            print("pip upgrade failed.")
            print("---- error tail ----")
            print(tail_text(err))
            print("--------------------")
            print("Hint: if you don't have sudo, use an existing interpreter from PyCharm and set python.useVenv=false.")
            return rc

    print("[phase] install-requirements")
    if requirements_path.exists():
        if ask_yes_no(f"Install dependencies from {requirements_path.name}? (Y/N): "):
            rc, _out, err = run_cmd(
                [str(venv_python), "-m", "pip", "install", "-r", str(requirements_path)],
                scripts_root
            )
            if rc != 0:
                print("Dependency installation failed.")
                print("---- error tail ----")
                print(tail_text(err))
                print("--------------------")
                return rc
    else:
        print("requirements.txt not found. Skip dependency installation.")

    print("[phase] preflight-import")
    env = os.environ.copy()
    current_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(scripts_root) + (os.pathsep + current_path if current_path else "")
    print("Running preflight import check for lib.io...")
    check = subprocess.run(
        [str(venv_python), "-c", "import lib.io; print('preflight ok')"],
        cwd=str(scripts_root),
        env=env,
        text=True,
        capture_output=True
    )
    if check.stdout:
        print(check.stdout.rstrip())
    if check.stderr:
        print(check.stderr.rstrip())
    if check.returncode != 0:
        print("Preflight import check failed.")
        print("---- error tail ----")
        print(tail_text(check.stderr))
        print("--------------------")
        return check.returncode

    print("")
    print("Python environment is ready.")
    print("You can close this terminal window.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
