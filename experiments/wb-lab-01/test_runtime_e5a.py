"""Offline campaign tests with a deterministic clock and fake operations."""

import hashlib
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from e5_plan import DISK_FLOOR, MEMORY_FLOOR
from e5a_evidence import publish
from preflight import Blocked
from runtime_e5a import (
    CPU_COUNTERS,
    IO_COUNTERS,
    PHASE_LIMITS,
    process_sample,
    run_campaign,
)


class ProcessTests(unittest.TestCase):
    def test_rss_is_bound_to_pid_and_start_time(self):
        with TemporaryDirectory() as temp:
            proc = Path(temp)
            directory = proc / "42"
            directory.mkdir()
            stat = "42 (example ) name) " + " ".join(["S", *(["0"] * 18), "605"])
            (directory / "stat").write_text(stat, encoding="ascii")
            (directory / "status").write_text("VmRSS: 17 kB\n", encoding="ascii")
            self.assertEqual(process_sample(42, 605, proc=proc)["rss_bytes"], 17 * 1024)
            with self.assertRaisesRegex(Blocked, "E5A_PROCESS_REPLACED"):
                process_sample(42, 604, proc=proc)


class Sandbox:
    daemon = "test-daemon"

    def __init__(self, fault=None):
        self.now = 100.0
        self.fault = fault
        self.active_limits = {}
        self.workloads = []
        self.cleaned = 0
        self.watchdog = False

    def sleep(self, seconds):
        self.now += seconds

    def inventory(self, deadline):
        return {"container": {"unrelated"}, "volume": set(), "network": set()}

    def start_watchdog(self, deadline):
        self.watchdog = True

    def check_watchdog(self):
        if not self.watchdog:
            raise Blocked("E5A_WATCHDOG")

    def stop_watchdog(self, deadline):
        self.watchdog = False

    def begin_workload(self, phase, deadline):
        self.workloads.append(phase)
        self.started = self.now
        if self.fault == "create":
            raise Blocked("CREATE_FAILED")
        self.expected_limits = PHASE_LIMITS[phase]

    def refresh_running_roles(self):
        if (
            self.workloads
            and self.cleaned < len(self.workloads)
            and self.fault != "start_stuck"
            and self.now >= self.started + 0.75
        ):
            self.active_limits = self.expected_limits

    def workload_finished(self):
        return self.fault != "timeout" and self.now >= self.started + 1

    def attested_running_roles(self, deadline):
        return set(self.active_limits)

    def workload_result(self, deadline):
        if self.fault == "sql" and len(self.workloads) == 2:
            raise Blocked("SQL_FAILED")
        return {
            "fsync_us": [1, 2, 3],
            "sql": {}
            if len(self.workloads) == 1
            else {
                "transactions": [
                    {
                        "sequence": index,
                        "outcome": "COMMITTED" if index < 3 else "COMMITTED_RECONCILED",
                        "duration_us": 10,
                    }
                    for index in range(1, 4)
                ],
                "row_lock": {"lock_timeout": True, "duration_us": 1000000},
            },
        }

    def cleanup(self, deadline):
        if self.fault == "cleanup":
            raise Blocked("REMOVE_FAILED")
        self.cleaned += 1
        self.active_limits = {}

    def observe(self, phase, deadline):
        self.refresh_running_roles()
        sample = {
            "phase": phase,
            "monotonic_ms": round(self.now * 1000),
            "daemon": self.daemon,
            "memory_available": MEMORY_FLOOR + 1,
            "disk_free": DISK_FLOOR + 1,
            "ledger_verified": True,
            "telemetry": {
                "source": "procfs+cgroupv2+statvfs",
                "storage": {
                    "pg_bytes": 1 if "postgres" in self.active_limits else None,
                    "media_bytes": 1 if "controller" in self.active_limits else None,
                },
                "infrastructure": {
                    "status": "AVAILABLE",
                    "processes": [
                        {
                            "role": "docker",
                            "pid": 90,
                            "start_before": 1,
                            "start_after": 1,
                            "rss_bytes": 4096,
                            "cpu_user_ticks": 0,
                            "cpu_system_ticks": 0,
                        }
                    ],
                },
            },
            "processes": {
                role: {
                    "pid": pid,
                    "start_before": 1,
                    "start_after": 1,
                    "rss_bytes": 4096,
                }
                for pid, role in enumerate(
                    ("harness", "watchdog", *self.active_limits), 1
                )
            },
            "containers": {
                role: {
                    "container_id": (
                        "1"
                        if phase == "controller"
                        else "2"
                        if role == "controller"
                        else "3"
                    )
                    * 64,
                    "limits": dict(limits),
                    "oom": 0,
                    "oom_kill": 0,
                    "memory_current": 1,
                    "memory_peak": 2,
                    "pids_current": 1,
                    "attachments_verified": True,
                    "cpu": dict.fromkeys(CPU_COUNTERS, 0),
                    "io": dict.fromkeys(IO_COUNTERS, 0),
                }
                for role, limits in self.active_limits.items()
            },
        }
        if phase != "controller":
            return sample
        changes = {
            "stale": {"monotonic_ms": sample["monotonic_ms"] - 501},
            "memory": {"memory_available": MEMORY_FLOOR - 1},
            "disk": {"disk_free": DISK_FLOOR - 1},
            "daemon": {"daemon": "changed"},
            "ledger": {"ledger_verified": False},
            "unexpected_field": {"stdout": "arbitrary text"},
        }
        sample.update(changes.get(self.fault, {}))
        if self.fault == "missing":
            return None
        if self.fault == "pid":
            if not self.active_limits:
                return sample
            sample["processes"]["controller"]["start_after"] += 1
        if not self.active_limits:
            return sample
        container = sample["containers"]["controller"]
        container.update(
            {
                "oom": {"oom": 1},
                "pids": {"pids_current": 17},
                "attachment": {"attachments_verified": False},
            }.get(self.fault, {})
        )
        if self.fault == "memory_cap":
            container["limits"]["memory"] -= 1
        if self.fault == "cpu_cap":
            container["limits"]["cpu"] += 1
        if self.fault == "missing_cgroup":
            del container["cpu"]["usage_usec"]
        if self.fault == "deadline":
            self.now = deadline + 1
        return sample


class CampaignTests(unittest.TestCase):
    def run_case(self, fault=None):
        sandbox = Sandbox(fault)
        return run_campaign(
            sandbox, clock=lambda: sandbox.now, sleep=sandbox.sleep
        ), sandbox

    def test_complete(self):
        result, sandbox = self.run_case()
        self.assertEqual(result["status"], "E5A_CHECKS_PASS")
        self.assertEqual(result["foreign_inventory"], "PRESERVED")
        self.assertEqual(sandbox.cleaned, 2)
        self.assertFalse(sandbox.watchdog)
        rows = result["samples"]["controller"]
        self.assertFalse(rows[0]["containers"])
        self.assertIn("controller", rows[-1]["containers"])

    @unittest.skipUnless(hasattr(os, "O_DIRECTORY"), "requires POSIX directory FD")
    def test_complete_campaign_seals_and_rejects_missing_evidence(self):
        result, sandbox = self.run_case()
        envelope = {
            "revision": "a" * 40,
            "run_id": "b" * 32,
            "daemon": sandbox.daemon,
            "images": {
                role: "sha256:" + "c" * 64 for role in ("controller", "postgres")
            },
            "resources": {
                "controller": {"controller": "1" * 64},
                "postgres_controller": {"controller": "2" * 64, "postgres": "3" * 64},
            },
            "campaign": result,
        }
        with TemporaryDirectory() as directory:
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                recovery = result["samples"].pop("recovery")
                with self.assertRaisesRegex(Blocked, "E5A_EVIDENCE_PASS_UNPROVEN"):
                    publish(fd, envelope)
                self.assertEqual(os.listdir(fd), [])
                result["samples"]["recovery"] = recovery
                digest = publish(fd, envelope)
                self.assertEqual(
                    digest,
                    hashlib.sha256(
                        (Path(directory) / "evidence.json").read_bytes()
                    ).hexdigest(),
                )
            finally:
                os.close(fd)

    def test_controller_failures_prevent_later_phases(self):
        for fault, reason in {
            "create": "CREATE_FAILED",
            "missing": "E5A_SAMPLE_MISSING",
            "stale": "E5A_STALE_SAMPLE",
            "memory": "E5A_MEMORY_FLOOR",
            "disk": "E5A_DISK_FLOOR",
            "daemon": "E5A_DAEMON_CHANGED",
            "ledger": "E5A_LEDGER_UNVERIFIED",
            "unexpected_field": "E5A_SAMPLE_FIELDS",
            "pid": "E5A_PROCESS_REPLACED",
            "oom": "E5A_OOM",
            "pids": "E5A_RESOURCE_LIMIT",
            "memory_cap": "E5A_ACTUAL_LIMITS",
            "cpu_cap": "E5A_ACTUAL_LIMITS",
            "missing_cgroup": "E5A_CGROUP_COUNTERS",
            "attachment": "E5A_ATTACHMENTS",
            "timeout": "E5A_WORKLOAD_TIMEOUT",
            "start_stuck": "E5A_WORKLOAD_ROLES_MISSING",
            "deadline": "E5A_DEADLINE",
        }.items():
            with self.subTest(fault=fault):
                result, sandbox = self.run_case(fault)
                self.assertEqual(result["status"], "E5A_BLOCKED")
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["cleanup"], "CONFIRMED")
                self.assertEqual(sandbox.workloads, ["controller"])

    def test_sql_failure_prevents_recovery_observation(self):
        result, sandbox = self.run_case("sql")
        self.assertEqual(result["reason"], "SQL_FAILED")
        self.assertNotIn("recovery", result["samples"])
        self.assertEqual(sandbox.cleaned, 2)

    def test_cleanup_failure_is_explicit(self):
        result, sandbox = self.run_case("cleanup")
        self.assertEqual(result["status"], "E5A_BLOCKED")
        self.assertEqual(result["cleanup"], "CLEANUP_UNCONFIRMED")
        self.assertEqual(sandbox.workloads, ["controller"])
