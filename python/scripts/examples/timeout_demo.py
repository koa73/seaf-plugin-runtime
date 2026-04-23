#!/usr/bin/env python3
import time
from lib.io import get_arguments, read_request, write_response


def main() -> int:
    req = read_request()
    args = get_arguments(req)
    sleep_sec = int(args.get("sleepSec", 120))
    time.sleep(max(0, sleep_sec))
    return write_response(
        status="success",
        message="Completed after sleep",
        payload={"sleepSec": sleep_sec},
        commands=[],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
