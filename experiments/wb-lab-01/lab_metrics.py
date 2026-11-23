"""Bounded measurements. Missing kernel counters are NOT_AVAILABLE, never zero."""

import os
import resource
from pathlib import Path


def read_metrics():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    children = resource.getrusage(resource.RUSAGE_CHILDREN)
    result = {
        "rss_peak_kib": usage.ru_maxrss,
        "user_s": usage.ru_utime,
        "system_s": usage.ru_stime,
        "children_rss_peak_kib": children.ru_maxrss,
        "children_user_s": children.ru_utime,
        "children_system_s": children.ru_stime,
    }
    for key in ("memory.peak", "cpu.stat", "io.stat"):
        try:
            with (Path("/sys/fs/cgroup") / key).open() as stream:
                value = stream.read(4097)
            if len(value) > 4096:
                raise RuntimeError("METRICS_BUDGET")
            result[key] = value.strip()
        except FileNotFoundError:
            result[key] = "NOT_AVAILABLE"
    return result


def isolation(expected):
    cgroup = Path("/sys/fs/cgroup")
    root = Path("/media")
    dev = root.stat().st_dev
    actual = {
        "device": f"{os.major(dev)}:{os.minor(dev)}",
        "uid": os.getuid(),
        "interfaces": sorted(os.listdir("/sys/class/net")),
        "limits": {
            key: (cgroup / key).read_text().strip() for key in expected["limits"]
        },
    }
    if actual != expected:
        raise RuntimeError("ACTUAL_CONTROLLER_ISOLATION")
    return actual
