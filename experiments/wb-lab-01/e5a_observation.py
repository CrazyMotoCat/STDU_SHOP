"""Linux cgroup v2 readings for an independently attested container process."""

from pathlib import Path, PurePosixPath

from preflight import require
from runtime_e5a import CPU_COUNTERS, IO_COUNTERS, process_sample, read_bounded


def numeric(token):
    require(token.isascii() and token.isdecimal(), "E5A_COUNTER_INVALID")
    return int(token)


def counters(payload):
    result = {}
    for line in payload.splitlines():
        key, value = line.split()
        require(key not in result, "E5A_COUNTER_DUPLICATE")
        result[key] = numeric(value)
    return result


def io_totals(payload):
    totals = dict.fromkeys(IO_COUNTERS, 0)
    devices = set()
    for line in payload.splitlines():
        device, *fields = line.split()
        major, minor = device.split(":")
        numeric(major)
        numeric(minor)
        require(device not in devices, "E5A_COUNTER_DUPLICATE")
        devices.add(device)
        values = counters("\n".join(field.replace("=", " ", 1) for field in fields))
        for key in totals:
            totals[key] += values[key]
    return totals


def container_reading(
    pid, start, container_id, *, proc=Path("/proc"), cgroups=Path("/sys/fs/cgroup")
):
    process_sample(pid, start, proc=proc)
    membership = proc / str(pid) / "cgroup"
    entry = read_bounded(membership).strip()
    require(entry.startswith("0::/") and "\n" not in entry, "E5A_CGROUP_MEMBERSHIP")
    relative = PurePosixPath(entry[4:])
    require(
        not relative.is_absolute()
        and ".." not in relative.parts
        and len(container_id) == 64
        and all(char in "0123456789abcdef" for char in container_id)
        and relative.name in (container_id, f"docker-{container_id}.scope"),
        "E5A_CGROUP_IDENTITY",
    )
    root = (cgroups / relative).resolve(strict=True)
    require(root == cgroups.resolve(strict=True) / relative, "E5A_CGROUP_PATH")

    def read(name):
        return read_bounded(root / name)

    quota, period = read("cpu.max").split()
    require(numeric(period) == 100000, "E5A_CPU_PERIOD")
    events = counters(read("memory.events"))
    cpu = counters(read("cpu.stat"))
    result = {
        "limits": {
            "memory": numeric(read("memory.max").strip()),
            "swap": numeric(read("memory.swap.max").strip()),
            "cpu": numeric(quota),
            "pids": numeric(read("pids.max").strip()),
        },
        "memory_current": numeric(read("memory.current").strip()),
        "memory_peak": numeric(read("memory.peak").strip()),
        "memory_events": events,
        "oom": events["oom"],
        "oom_kill": events["oom_kill"],
        "cpu": {key: cpu[key] for key in sorted(CPU_COUNTERS)},
        "io": io_totals(read("io.stat")),
        "pids_current": numeric(read("pids.current").strip()),
    }
    process = process_sample(pid, start, proc=proc)
    require(read_bounded(membership).strip() == entry, "E5A_CGROUP_MEMBERSHIP_CHANGED")
    return result, process
