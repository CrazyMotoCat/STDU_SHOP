"""Offline E5A sequencing model. No real Docker or PostgreSQL backend is wired."""

import json
import time
from pathlib import Path
from subprocess import SubprocessError

from e5_plan import DISK_FLOOR, MEMORY_FLOOR, PHASE_BUDGET_MS, host_margins
from preflight import Blocked, require

INTERVAL = 0.250
FRESHNESS = 0.500
MAX_SAMPLES = 360
MAX_SAMPLE_BYTES = 1024**2
WORKLOAD_SECONDS = 30
CLEANUP_SECONDS = 10
CONTROLLER_LIMITS = {"memory": 64 * 1024**2, "swap": 0, "cpu": 25000, "pids": 16}
PG_LIMITS = {"memory": 192 * 1024**2, "swap": 0, "cpu": 50000, "pids": 32}
PHASE_LIMITS = {
    "baseline": {},
    "controller": {"controller": CONTROLLER_LIMITS},
    "postgres_controller": {"controller": CONTROLLER_LIMITS, "postgres": PG_LIMITS},
    "recovery": {},
}
CPU_COUNTERS = {
    "usage_usec",
    "user_usec",
    "system_usec",
    "nr_throttled",
    "throttled_usec",
}
IO_COUNTERS = {"rbytes", "wbytes", "rios", "wios"}
FAILURES = (
    Blocked,
    OSError,
    ValueError,
    TypeError,
    LookupError,
    SubprocessError,
    RuntimeError,
)


def read_bounded(path, limit=4096):
    with path.open(encoding="ascii") as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "E5A_COUNTER_BUDGET")
    return data


def process_start(directory, pid):
    # comm may contain spaces and parentheses. The last ')' ends the field.
    stat = read_bounded(directory / "stat")
    identity, _, fields = stat.rpartition(")")
    require(identity.startswith(f"{pid} ("), "E5A_PROCESS_ID")
    return int(fields.split()[19])


def process_sample(pid, expected_start, *, proc=Path("/proc")):
    require(type(pid) is int and pid > 0, "E5A_PROCESS_ID")
    directory = proc / str(pid)
    before = process_start(directory, pid)
    require(before == expected_start, "E5A_PROCESS_REPLACED")
    (rss,) = [
        line.split()[1:]
        for line in read_bounded(directory / "status", 16384).splitlines()
        if line.startswith("VmRSS:")
    ]
    amount, unit = rss
    require(unit == "kB" and amount.isdecimal(), "E5A_PROCESS_SAMPLE_INVALID")
    after = process_start(directory, pid)
    require(before == after, "E5A_PROCESS_REPLACED")
    return {
        "pid": pid,
        "start_before": before,
        "start_after": after,
        "rss_bytes": int(amount) * 1024,
    }


def counters_valid(counters, names):
    return counters.keys() == names and all(
        type(value) is int and value >= 0 for value in counters.values()
    )


def validate_observation(sample, *, phase, now, previous, daemon, limits, running):
    require(
        sample.keys()
        == {
            "phase",
            "monotonic_ms",
            "daemon",
            "memory_available",
            "disk_free",
            "ledger_verified",
            "containers",
            "processes",
            "telemetry",
        },
        "E5A_SAMPLE_FIELDS",
    )
    require(sample["phase"] == phase, "E5A_SAMPLE_PHASE")
    tick = sample["monotonic_ms"]
    require(
        type(tick) is int
        and 0 <= now - tick <= 500
        and (previous is None or 0 < tick - previous <= 500),
        "E5A_STALE_SAMPLE",
    )
    require(sample["daemon"] == daemon, "E5A_DAEMON_CHANGED")
    require(
        type(sample["memory_available"]) is int
        and sample["memory_available"] >= MEMORY_FLOOR,
        "E5A_MEMORY_FLOOR",
    )
    require(
        type(sample["disk_free"]) is int and sample["disk_free"] >= DISK_FLOOR,
        "E5A_DISK_FLOOR",
    )
    require(sample["ledger_verified"] is True, "E5A_LEDGER_UNVERIFIED")
    telemetry = sample["telemetry"]
    require(
        telemetry.keys() == {"source", "storage", "infrastructure"}
        and telemetry["source"] == "procfs+cgroupv2+statvfs"
        and telemetry["storage"].keys() == {"pg_bytes", "media_bytes"}
        and all(
            value is None or (type(value) is int and value >= 0)
            for value in telemetry["storage"].values()
        ),
        "E5A_TELEMETRY_FIELDS",
    )
    infrastructure = telemetry["infrastructure"]
    require(
        infrastructure.keys() == {"status", "processes"}
        and infrastructure["status"] == "AVAILABLE"
        and isinstance(infrastructure["processes"], list)
        and 1 <= len(infrastructure["processes"]) <= 32,
        "E5A_INFRASTRUCTURE_UNAVAILABLE",
    )
    for process in infrastructure["processes"]:
        require(
            process.keys()
            == {
                "role",
                "pid",
                "start_before",
                "start_after",
                "rss_bytes",
                "cpu_user_ticks",
                "cpu_system_ticks",
            }
            and process["role"] in {"docker", "containerd", "shim"}
            and all(
                type(value) is int and value >= 0
                for key, value in process.items()
                if key != "role"
            )
            and process["pid"] > 0
            and process["start_before"] == process["start_after"] > 0,
            "E5A_INFRASTRUCTURE_IDENTITY",
        )
    require(
        any(process["role"] == "docker" for process in infrastructure["processes"]),
        "E5A_DOCKER_PROCESS_UNAVAILABLE",
    )
    require(
        running <= limits.keys() and sample["containers"].keys() == running,
        "E5A_CONTAINER_SET",
    )
    for role, counters in sample["containers"].items():
        value = telemetry["storage"][
            "pg_bytes" if role == "postgres" else "media_bytes"
        ]
        require(
            type(value) is int
            and value < (128 * 1024**2 if role == "postgres" else 1024**2 + 1),
            "E5A_STORAGE_SAMPLE_MISSING_OR_LIMIT",
        )
        require(
            counters.keys()
            == {
                "limits",
                "cpu",
                "io",
                "oom",
                "oom_kill",
                "memory_current",
                "memory_peak",
                "pids_current",
                "attachments_verified",
                "container_id",
            },
            "E5A_CONTAINER_SAMPLE_FIELDS",
        )
        require(counters["limits"] == limits[role], "E5A_ACTUAL_LIMITS")
        require(
            isinstance(counters["container_id"], str)
            and len(counters["container_id"]) == 64
            and all(char in "0123456789abcdef" for char in counters["container_id"]),
            "E5A_SAMPLE_CONTAINER_ID",
        )
        require(
            all(
                type(counters[key]) is int
                for key in (
                    "oom",
                    "oom_kill",
                    "memory_current",
                    "memory_peak",
                    "pids_current",
                )
            ),
            "E5A_COUNTER_TYPE",
        )
        require(
            counters_valid(counters["cpu"], CPU_COUNTERS)
            and counters_valid(counters["io"], IO_COUNTERS),
            "E5A_CGROUP_COUNTERS",
        )
        require(counters["oom"] == counters["oom_kill"] == 0, "E5A_OOM")
        require(
            0
            <= counters["memory_current"]
            <= counters["memory_peak"]
            <= limits[role]["memory"]
            and 1 <= counters["pids_current"] <= limits[role]["pids"],
            "E5A_RESOURCE_LIMIT",
        )
        require(counters["attachments_verified"] is True, "E5A_ATTACHMENTS")
    require(
        sample["processes"].keys() == {"harness", "watchdog", *running},
        "E5A_PROCESS_SAMPLE_MISSING",
    )
    for process in sample["processes"].values():
        require(
            counters_valid(process, {"pid", "start_before", "start_after", "rss_bytes"})
            and process["pid"] > 0
            and process["start_before"] > 0,
            "E5A_PROCESS_SAMPLE_INVALID",
        )
        require(
            process["start_before"] == process["start_after"],
            "E5A_PROCESS_REPLACED",
        )


def run_campaign(backend, *, clock=time.monotonic, sleep=time.sleep):
    """Run one campaign against an already verified, exclusively held sandbox."""
    started = clock()
    deadline = started + 90
    evidence = {
        "status": "E5A_BLOCKED",
        "reason": None,
        "cleanup": "NOT_RUN",
        "watchdog": "NOT_STARTED",
        "phases": {},
        "samples": {},
    }
    before = None
    pending_cleanup = False
    sample_bytes = 0

    def check(end):
        require(clock() < end, "E5A_DEADLINE")
        backend.check_watchdog()

    def observe(phase, phase_start, end, *, until=None):
        nonlocal sample_bytes
        rows = evidence["samples"].setdefault(phase, [])
        while clock() < end:
            if until is None and rows and end - clock() <= INTERVAL:
                sleep(max(0, end - clock()))
                break
            next_sample = clock() + INTERVAL
            check(end)
            sample = backend.observe(phase, end)
            if sample is None and until is None and rows:
                require(
                    end - rows[-1]["monotonic_ms"] / 1000 <= FRESHNESS,
                    "E5A_FINAL_SAMPLE_STALE",
                )
                break
            check(end)
            require(sample is not None, "E5A_SAMPLE_MISSING")
            running = backend.attested_running_roles(end)
            validate_observation(
                sample,
                phase=phase,
                now=int(clock() * 1000),
                previous=rows[-1]["monotonic_ms"] if rows else None,
                daemon=backend.daemon,
                limits=PHASE_LIMITS[phase],
                running=running,
            )
            check(end)
            require(
                rows or 0 <= sample["monotonic_ms"] - int(phase_start * 1000) <= 500,
                "E5A_FIRST_SAMPLE_LATE",
            )
            sample_bytes += len(json.dumps(sample, separators=(",", ":")).encode()) + 1
            require(
                len(rows) < MAX_SAMPLES and sample_bytes <= MAX_SAMPLE_BYTES,
                "E5A_SAMPLE_BUDGET",
            )
            rows.append(sample)
            if until is not None and until() and len(rows) >= 2:
                require(
                    running == PHASE_LIMITS[phase].keys(), "E5A_WORKLOAD_ROLES_MISSING"
                )
                return
            sleep(max(0, min(next_sample, end) - clock()))
        require(until is None, "E5A_WORKLOAD_TIMEOUT")
        require(
            rows and end - rows[-1]["monotonic_ms"] / 1000 <= FRESHNESS,
            "E5A_FINAL_SAMPLE_STALE",
        )

    try:
        backend.start_watchdog(deadline)
        evidence["watchdog"] = "RUNNING"
        before = backend.inventory(min(deadline, clock() + 3))
        for phase, budget in PHASE_BUDGET_MS.items():
            phase_start = clock()
            end = min(deadline, phase_start + budget / 1000)
            check(end)
            if phase in {"baseline", "recovery"}:
                require(end >= phase_start + 5, "E5A_IDLE_WINDOW_BUDGET")
                observe(phase, phase_start, end)
            else:
                work_end = min(end - CLEANUP_SECONDS, phase_start + WORKLOAD_SECONDS)
                pending_cleanup = True
                evidence["cleanup"] = "PENDING"
                cleanup_end = end
                backend.begin_workload(phase, work_end)
                observe(phase, phase_start, work_end, until=backend.workload_finished)
                result = backend.workload_result(work_end)
                check(work_end)
                evidence["phases"][phase] = result
                pending_cleanup = False
                evidence["cleanup"] = "CLEANUP_UNCONFIRMED"
                backend.cleanup(min(end, clock() + CLEANUP_SECONDS))
                require(clock() < end, "E5A_CLEANUP_DEADLINE")
                evidence["cleanup"] = "CONFIRMED"
            evidence["phases"].setdefault(phase, {})["status"] = "COMPLETE"
        streams = {}
        for phase, rows in evidence["samples"].items():
            first = rows[0]["monotonic_ms"]
            streams[phase] = [
                (row["monotonic_ms"] - first, row["memory_available"], row["disk_free"])
                for row in rows
            ]
        try:
            evidence["host_margins"] = host_margins(streams)
        except ValueError as error:
            known = {
                "E5A_PHASES_INCOMPLETE",
                "E5A_SAMPLE_COUNT",
                "E5A_SAMPLE_TIME_OR_SHAPE",
                "E5A_HOST_WATERMARK",
                "E5A_IDLE_SAMPLE_WINDOW",
            }
            raise Blocked(
                str(error) if str(error) in known else "E5A_HOST_SAMPLE_INVALID"
            ) from error
        require(backend.inventory(deadline) == before, "E5A_FOREIGN_INVENTORY_CHANGED")
        evidence["foreign_inventory"] = "PRESERVED"
        require(clock() <= deadline, "E5A_DEADLINE")
        backend.stop_watchdog(deadline)
        evidence["watchdog"] = "STOPPED"
        require(clock() <= deadline, "E5A_DEADLINE")
        evidence["status"] = "E5A_CHECKS_PASS"
    except (*FAILURES, KeyboardInterrupt) as error:
        evidence["reason"] = (
            str(error) if isinstance(error, Blocked) else type(error).__name__
        )
    finally:
        if pending_cleanup:
            try:
                end = min(cleanup_end, clock() + CLEANUP_SECONDS)
                require(clock() < end, "E5A_CLEANUP_DEADLINE")
                backend.cleanup(end)
                require(clock() < end, "E5A_CLEANUP_DEADLINE")
                evidence["cleanup"] = "CONFIRMED"
            except FAILURES:
                evidence["cleanup"] = "CLEANUP_UNCONFIRMED"
        if evidence["status"] != "E5A_CHECKS_PASS":
            try:
                backend.stop_watchdog(deadline)
                evidence["watchdog"] = "STOPPED"
                if before is not None and backend.inventory(deadline) == before:
                    evidence["foreign_inventory"] = "PRESERVED"
            except FAILURES:
                evidence["watchdog"] = "FAILED"
    return evidence
