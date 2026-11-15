"""Target-only subprocess probe, run inside the existing disposable Docker profile."""
import json
from pathlib import Path
import resource
import sys
import time

from pipeline import CHILD_ERRORS, Refused, WIRE_CAP, parse, render, verify
from codec import boundary


def main():
    start = time.monotonic()
    try:
        operation = {"worker": render, "verifier": verify}[sys.argv[1]]
        result = operation(parse(sys.stdin.buffer.read(WIRE_CAP + 1)))
    except Refused as exc:
        result = {"error": str(exc) if str(exc) in CHILD_ERRORS else "CHILD_INVALID"}
    system = Path("/sys/fs/cgroup")
    counters = {}
    for name in ("memory.peak", "memory.events", "cpu.stat", "pids.peak", "io.stat"):
        try:
            counters[name] = (system / name).read_text().strip()
        except FileNotFoundError:
            counters[name] = None
    usage = resource.getrusage(resource.RUSAGE_SELF)
    print(json.dumps(dict(result=result, boundary=boundary(), cgroup=counters,
                          elapsed_ms=(time.monotonic() - start) * 1000, rss_kib=usage.ru_maxrss)))


if __name__ == "__main__":
    main()
