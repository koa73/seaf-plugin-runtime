#!/usr/bin/env python3
import time
from lib.io import emit_progress, get_arguments, read_request, write_response


def main() -> int:
    req = read_request()
    args = get_arguments(req)
    duration = max(1, int(args.get("simulateDurationSec", 2)))
    for step in range(duration):
        progress = int(((step + 1) * 100) / duration)
        phase = f"step {step + 1} of {duration}"
        emit_progress(progress, phase=phase)
        time.sleep(1)

    return write_response(
        status="success",
        message="Background task completed",
        payload={"durationSec": duration},
        commands=[
            {
                "name": "showMessage",
                "args": {"level": "info", "text": "Async background task finished"},
            },
            {"name": "refreshGraph", "args": {}},
        ],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
