"""Bounded, identity-anchored Docker infrastructure context from host procfs."""

from pathlib import Path

from preflight import require
from runtime_e5a import process_sample, process_start, read_bounded


class Infrastructure:
    def __init__(self, proc=Path("/proc")):
        self.proc = proc
        self.anchors = {}

    def sample(self):
        result = []
        directories = list(self.proc.iterdir())
        require(len(directories) <= 8192, "E5A_PROC_SCAN_BUDGET")
        for directory in directories:
            if not directory.name.isdecimal():
                continue
            try:
                name = read_bounded(directory / "comm", 128).strip()
                role = {"dockerd": "docker", "containerd": "containerd"}.get(name)
                if name.startswith("containerd-shim"):
                    role = "shim"
                if role is None:
                    continue
                pid = int(directory.name)
                start = process_start(directory, pid)
                require(
                    pid not in self.anchors or self.anchors[pid] == start,
                    "E5A_INFRASTRUCTURE_PID_REUSED",
                )
                self.anchors[pid] = start
                process = process_sample(pid, start, proc=self.proc)
                fields = read_bounded(directory / "stat").rpartition(")")[2].split()
                process.update(
                    role=role,
                    cpu_user_ticks=int(fields[11]),
                    cpu_system_ticks=int(fields[12]),
                )
                require(
                    process_start(directory, pid) == start,
                    "E5A_INFRASTRUCTURE_PID_REUSED",
                )
                result.append(process)
            except FileNotFoundError:
                # Processes can finish between scans. No fabricated zero is recorded.
                continue
        require(len(result) <= 32, "E5A_INFRASTRUCTURE_BUDGET")
        require(
            any(row["role"] == "docker" for row in result),
            "E5A_DOCKER_PROCESS_UNAVAILABLE",
        )
        return {
            "status": "AVAILABLE",
            "processes": sorted(result, key=lambda row: row["pid"]),
        }
