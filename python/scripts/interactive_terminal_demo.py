#!/usr/bin/env python3
import json
import os
import sys


def ask_yes_no(prompt: str) -> bool:
    while True:
        answer = input(prompt).strip().lower()
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no", ""):
            return False
        print("Please answer with Y or N.")
        sys.stdout.flush()


def main():
    print("SEAF interactive terminal demo started.")
    print("This script runs in a real TTY-backed terminal session.")
    print("Type any text and press Enter.")
    print("Commands: help, env, page, exception, quit")
    print("")
    sys.stdout.flush()

    payload_json = os.environ.get("SEAF_PAYLOAD_JSON", "")
    payload = {}

    if payload_json:
        try:
            payload = json.loads(payload_json)
        except Exception:
            payload = {}

    current_page = payload.get("currentPage") or {}

    while True:
        try:
            user_input = input("seaf-demo> ").strip()
        except EOFError:
            print("")
            print("EOF received, exiting.")
            return 0
        except KeyboardInterrupt:
            print("")
            print("Keyboard interrupt received, exiting.")
            return 130

        if user_input in ("quit", "exit"):
            print("Interactive demo finished normally.")
            return 0
        elif user_input == "help":
            print("Available commands:")
            print("  help  - show this help")
            print("  env   - print injected SEAF env values")
            print("  page  - print current draw.io page info")
            print("  exception - ask Y/N and simulate exception")
            print("  quit  - exit the demo")
        elif user_input in ("exception", "error", "fail"):
            should_fail = ask_yes_no("Simulate exception and close terminal? (Y/N): ")
            if should_fail:
                raise RuntimeError("Simulated interactive exception requested by user")
            print("Exception simulation cancelled.")
        elif user_input == "env":
            print("SEAF env values:")
            env_json = os.environ.get("SEAF_RUNTIME_ENV_JSON", "{}")
            print(env_json)
        elif user_input == "page":
            if current_page:
                print("Current page:")
                print(json.dumps(current_page, ensure_ascii=False))
            else:
                print("No current page payload was provided.")
        elif user_input:
            print(f"Echo: {user_input}")
        else:
            print("Empty input received.")

        sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main())
