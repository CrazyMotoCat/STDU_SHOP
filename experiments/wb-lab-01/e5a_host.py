"""Concrete Linux E5A backend. Construction never creates Docker resources."""

import hashlib
import json
import multiprocessing
import os
import re
import select
import shutil
import signal
import time
from dataclasses import asdict
from pathlib import Path

from e5a_engine import Engine, Intent
from e5a_infrastructure import Infrastructure
from e5a_media import MediaController
from e5a_observation import container_reading
from e5a_pg_engine import PostgresEngine, PostgresIntent, read_record, write_record
from e5a_pg_supervisor import PairedRecovery
from e5a_sql import workload
from preflight import ROOT, Blocked, mem_available, require
from runtime_e0a import snapshot
from runtime_e5a import (
    FAILURES,
    PHASE_LIMITS,
    process_sample,
    process_start,
    validate_observation,
)

PHASES = tuple(PHASE_LIMITS)


class HostBackend:
    def __init__(self, directory, run, host, images, *, engine=None):
        self.directory, self.run, self.host = directory, run, host
        self.daemon = host["daemon_id"]
        self.engine = Engine() if engine is None else engine
        self.images = images
        self.ctx = multiprocessing.get_context("fork")
        self.phase = self.ctx.Value("i", 0)
        self.phase_end = self.ctx.Value("d", 0)
        self.heartbeat = self.ctx.Value("d", time.monotonic())
        self.abort = self.ctx.Event()
        self.stopped = self.ctx.Event()
        self.last = None
        self.latest = self.ctx.Array("B", 16384)
        self.latest_size = self.ctx.RawValue("i", 0)
        self.worker = None
        self.watch = None
        self.pending_result = None
        self.owner = os.getpid()
        self.owner_start = process_start(Path("/proc") / str(self.owner), self.owner)
        self.children = {}
        self.resources = {}
        self.process_anchors = {}
        self.container_anchors = {}
        for phase in ("controller", "postgres_controller"):
            os.mkdir(phase, 0o700, dir_fd=directory)
            fd = os.open(
                phase, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
            )
            write_record(fd, "phase.json", {"phase": phase, "run": run})
            self.children[phase] = fd
        write_record(
            directory,
            "campaign.json",
            {"run": run, "daemon": self.daemon, "images": images},
        )

    def intents(self, phase):
        fd = self.children[phase]
        scope = hashlib.sha256(f"{self.run}:{phase}".encode("ascii")).hexdigest()[:32]
        controller = Intent(scope, self.daemon, self.images["controller"])
        pg = PostgresIntent(
            scope,
            self.daemon,
            self.images["postgres"],
            str(Path(f"/proc/self/fd/{fd}").resolve() / "pg-socket"),
            self.host["nonce"],
        )
        return MediaController(self.engine, controller), pg

    def verify_root(self):
        require(
            read_record(self.directory, "campaign.json")
            == {"run": self.run, "daemon": self.daemon, "images": self.images},
            "E5A_CAMPAIGN_LEDGER",
        )

    def inventory(self, deadline):
        self.verify_root()
        return snapshot(deadline)

    def start_watchdog(self, deadline):
        self.global_end = deadline
        self.phase_end.value = min(deadline, time.monotonic() + 5)
        self.watch = self.ctx.Process(target=self.monitor, args=(deadline,))
        self.watch.start()
        ready_end = min(deadline, time.monotonic() + 0.5)
        while self.latest_size.value == 0 and time.monotonic() < ready_end:
            time.sleep(0.005)
        self.last = self.latest_sample()
        require(self.last is not None, "E5A_WATCHDOG_READY")
        require("sample" in self.last, "E5A_WATCHDOG_READY")

    def latest_sample(self):
        require(self.latest.get_lock().acquire(timeout=0.05), "E5A_SAMPLE_IPC_BUSY")
        try:
            size = self.latest_size.value
            require(0 <= size <= len(self.latest), "E5A_SAMPLE_IPC_SIZE")
            return json.loads(bytes(self.latest[:size])) if size else None
        finally:
            self.latest.get_lock().release()

    def check_watchdog(self):
        self.heartbeat.value = time.monotonic()
        if self.abort.is_set():
            raise Blocked(self.failure_reason("E5A_WORKLOAD_ABORT"))
        require(
            self.watch is not None
            and self.watch.is_alive()
            and not self.abort.is_set(),
            "E5A_WATCHDOG_FAILED",
        )

    def failure_reason(self, fallback):
        first = read_record(self.directory, "watchdog-abort.json", optional=True)
        if first is None:
            for fd in self.children.values():
                first = read_record(fd, "workload-error.json", optional=True)
                if first is not None:
                    break
        if first is not None:
            reason = first.get("reason")
            require(
                isinstance(reason, str) and re.fullmatch(r"[A-Za-z0-9_]{1,64}", reason),
                "E5A_FAILURE_LEDGER",
            )
            return reason
        return fallback

    def begin_workload(self, phase, deadline):
        self.check_watchdog()
        self.phase.value = PHASES.index(phase)
        self.phase_end.value = deadline
        self.pending_result = None
        self.answer, outgoing = self.ctx.Pipe(duplex=False)
        released = self.ctx.Event()
        self.worker = self.ctx.Process(
            target=self.provision, args=(phase, deadline, outgoing, released)
        )
        self.worker.start()
        pid = self.worker.pid
        write_record(
            self.children[phase],
            "worker.json",
            {
                "pid": pid,
                "start": process_start(Path("/proc") / str(pid), pid),
            },
        )
        released.set()
        outgoing.close()

    def provision(self, phase, deadline, outgoing, released):
        try:
            require(
                released.wait(max(0, deadline - time.monotonic()))
                and not self.abort.is_set(),
                "E5A_WORKER_GATE",
            )
            fd = self.children[phase]
            media, pg_intent = self.intents(phase)
            media.create(
                fd,
                deadline,
                lambda volume: media.prepare(fd, self.host, volume, deadline),
            )
            report = {}
            if phase == "postgres_controller":
                write_record(fd, "socket-create.json", {"requested": True})
                os.mkdir("pg-socket", 0o700, dir_fd=fd)
                os.chown("pg-socket", 999, 999, dir_fd=fd, follow_symlinks=False)
                state = os.stat("pg-socket", dir_fd=fd, follow_symlinks=False)
                write_record(
                    fd, "pg-socket.json", {"identity": [state.st_dev, state.st_ino]}
                )
                pg = PostgresEngine.for_preflight(self.engine, self.host)
                pg.create(fd, pg_intent, deadline)
                while True:
                    require(
                        time.monotonic() < deadline and not self.abort.is_set(),
                        "E5A_PG_READY_TIMEOUT",
                    )
                    # Wait for the actual socket; every connected query still attests peer and marker.
                    if Path(pg_intent.socket_source, ".s.PGSQL.5432").exists():
                        break
                    time.sleep(0.05)
                pg.ready(fd, pg_intent, deadline)
                report = workload(
                    lambda sql: pg.query(fd, pg_intent, sql, deadline), pg_intent.run
                )
            while True:
                require(
                    time.monotonic() < deadline and not self.abort.is_set(),
                    "E5A_MEDIA_TIMEOUT",
                )
                fsync = media.measurement(fd, deadline)
                if fsync is not None:
                    break
                time.sleep(0.05)
            write_record(fd, "workload.json", {"sql": report, "fsync_us": fsync})
            outgoing.send({"ok": True})
        except FAILURES as error:
            reason = str(error) if isinstance(error, Blocked) else type(error).__name__
            write_record(
                self.children[phase], "workload-error.json", {"reason": reason}
            )
            self.abort.set()
            outgoing.send({"error": reason})
        finally:
            outgoing.close()

    def observe(self, phase, deadline):
        self.check_watchdog()
        index = PHASES.index(phase)
        if phase in ("baseline", "recovery"):
            self.phase_end.value = deadline
        if index != self.phase.value:
            require(phase in ("baseline", "recovery"), "E5A_PHASE_TRANSITION")
            self.phase.value = index
            self.phase_end.value = deadline
        end = min(deadline, time.monotonic() + 0.45)
        while time.monotonic() < end:
            if self.abort.is_set():
                self.check_watchdog()
            result = self.latest_sample()
            if result is not None:
                require("sample" in result, "E5A_WATCHDOG_FAILED")
                row = result["sample"]
                if (
                    row["phase"] == phase
                    and (
                        self.last is None
                        or row["monotonic_ms"] > self.last["sample"]["monotonic_ms"]
                    )
                    and (
                        phase not in ("baseline", "recovery")
                        or row["monotonic_ms"] >= int((deadline - 5) * 1000)
                    )
                ):
                    self.last = result
                    for role, identifier in result["resources"].items():
                        self.resources.setdefault(phase, {})[role] = identifier
                    return row
            time.sleep(0.005)
        if phase in ("baseline", "recovery"):
            return None
        self.check_watchdog()
        raise Blocked("E5A_SAMPLE_MISSING")

    def attested_running_roles(self, deadline):
        require(time.monotonic() < deadline, "E5A_DEADLINE")
        return set(self.last["sample"]["containers"])

    def workload_finished(self):
        if self.pending_result is None and self.answer.poll():
            self.pending_result = self.answer.recv()
        if self.pending_result is not None:
            require(self.pending_result == {"ok": True}, "E5A_WORKLOAD_FAILED")
            return True
        require(self.worker.is_alive(), "E5A_WORKER_CRASH")
        return False

    def workload_result(self, deadline):
        require(self.workload_finished(), "E5A_WORKLOAD_INCOMPLETE")
        self.worker.join(max(0, deadline - time.monotonic()))
        require(
            not self.worker.is_alive() and self.worker.exitcode == 0, "E5A_WORKER_STOP"
        )
        self.answer.close()
        phase = PHASES[self.phase.value]
        return read_record(self.children[phase], "workload.json")

    def recover_phase(self, phase, deadline):
        import fcntl

        fd = self.children[phase]
        lock = os.open(
            ".cleanup-lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=fd
        )
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.recover_locked(phase, deadline)
        finally:
            os.close(lock)

    def recover_locked(self, phase, deadline):
        fd = self.children[phase]
        worker = read_record(fd, "worker.json", optional=True)
        if worker is not None:
            require(worker.keys() == {"pid", "start"}, "E5A_WORKER_LEDGER")
            try:
                start = process_start(Path("/proc") / str(worker["pid"]), worker["pid"])
            except FileNotFoundError:
                start = None
            if start is not None:
                require(start == worker["start"], "E5A_WORKER_REPLACED")
                pidfd = os.pidfd_open(worker["pid"])
                try:
                    require(
                        process_start(Path("/proc") / str(worker["pid"]), worker["pid"])
                        == start,
                        "E5A_WORKER_REPLACED",
                    )
                    signal.pidfd_send_signal(pidfd, signal.SIGKILL)
                    poll = select.poll()
                    poll.register(pidfd, select.POLLIN)
                    require(
                        poll.poll(max(0, int((deadline - time.monotonic()) * 1000))),
                        "E5A_WORKER_STOP",
                    )
                finally:
                    os.close(pidfd)
        media, pg_intent = self.intents(phase)
        # Absence of an intent means the corresponding create operation never started.
        if read_record(fd, "media-intent.json", optional=True) is not None:
            media.recover(fd, deadline)
        if (
            phase == "postgres_controller"
            and read_record(fd, "pg-intent.json", optional=True) is not None
        ):
            pg = PostgresEngine.for_preflight(self.engine, self.host)
            pg.recover(fd, pg_intent, deadline)
            PairedRecovery.remove_socket_directory(fd)
        elif (
            phase == "postgres_controller"
            and read_record(fd, "socket-create.json", optional=True) is not None
        ):
            PairedRecovery.remove_socket_directory(fd)

    def cleanup(self, deadline):
        self.phase.value = 4
        self.phase_end.value = deadline
        if self.worker is not None and self.worker.is_alive():
            self.worker.kill()
            self.worker.join(max(0, min(1, deadline - time.monotonic())))
            require(not self.worker.is_alive(), "E5A_WORKER_STOP")
        for phase in ("controller", "postgres_controller"):
            self.recover_phase(phase, deadline)
        require(time.monotonic() < deadline, "E5A_CLEANUP_DEADLINE")

    def stop_watchdog(self, deadline):
        if self.watch is None:
            return
        self.stopped.set()
        self.watch.join(max(0, deadline - time.monotonic()))
        require(
            not self.watch.is_alive() and self.watch.exitcode == 0, "E5A_WATCHDOG_STOP"
        )
        if (
            self.abort.is_set()
            or read_record(self.directory, "watchdog-abort.json", optional=True)
            is not None
        ):
            raise Blocked(self.failure_reason("E5A_WATCHDOG_ABORTED"))
        self.watch = None

    def watchdog_cleanup_confirmed(self):
        if self.watch is None or self.watch.exitcode != 0:
            return False
        self.verify_root()
        first = read_record(self.directory, "watchdog-abort.json", optional=True)
        result = read_record(self.directory, "watchdog-cleanup.json", optional=True)
        return (
            first is not None
            and first
            == {
                "reason": self.failure_reason("E5A_WATCHDOG_ABORTED"),
                "cleanup": "CLEANUP_UNCONFIRMED",
            }
            and result == {**first, "cleanup": "CONFIRMED"}
        )

    def read_sample(self, phase, deadline):
        self.verify_root()
        self.engine.attest(
            Intent(self.run, self.daemon, self.images["controller"]), deadline
        )
        process = {
            "harness": process_sample(self.owner, self.owner_start),
            "watchdog": process_sample(
                os.getpid(),
                process_start(Path("/proc") / str(os.getpid()), os.getpid()),
            ),
        }
        containers, resources = {}, {}
        storage = {"pg_bytes": None, "media_bytes": None}
        if phase in self.children:
            fd = self.children[phase]
            media, pg_intent = self.intents(phase)
            for role, intent in (("controller", media.intent), ("postgres", pg_intent)):
                if role == "postgres" and phase != "postgres_controller":
                    continue
                item = self.engine.inspect(intent.name, deadline)
                if item is None:
                    continue
                cid = item["Id"]
                key = (phase, role)
                require(
                    key not in self.container_anchors
                    or self.container_anchors[key] == cid,
                    "E5A_CONTAINER_REPLACED",
                )
                self.container_anchors[key] = cid
                if role == "controller":
                    volume = read_record(fd, "media-volume.json")
                    media.verify(item, cid, volume)
                    # usage rechecks the live volume and the recorded directory inode.
                    storage["media_bytes"] = media.usage(fd, deadline)
                else:
                    pg = PostgresEngine.for_preflight(self.engine, self.host)
                    require(
                        read_record(fd, "pg-intent.json") == asdict(pg_intent),
                        "E5A_PG_INTENT_CHANGED",
                    )
                    pg.verify(item, pg_intent, cid)
                    storage["pg_bytes"] = pg.sample_data(fd, pg_intent, deadline)
                resources[role] = cid
                if not item["State"]["Running"]:
                    require(
                        item["State"]["Status"] == "created", "E5A_CONTAINER_STOPPED"
                    )
                    continue
                pid = item["State"]["Pid"]
                start = process_start(Path("/proc") / str(pid), pid)
                require(
                    cid not in self.process_anchors
                    or self.process_anchors[cid] == (pid, start),
                    "E5A_PROCESS_REPLACED",
                )
                self.process_anchors[cid] = (pid, start)
                counters, rss = container_reading(pid, start, cid)
                counters.pop("memory_events")
                counters["attachments_verified"] = True
                counters["container_id"] = cid
                containers[role], process[role] = counters, rss
        sample = {
            "phase": phase,
            "monotonic_ms": int(time.monotonic() * 1000),
            "daemon": self.daemon,
            "memory_available": mem_available(),
            "disk_free": shutil.disk_usage(ROOT).free,
            "ledger_verified": True,
            "containers": containers,
            "processes": process,
            "telemetry": {
                "source": "procfs+cgroupv2+statvfs",
                "storage": storage,
                "infrastructure": self.infrastructure.sample(),
            },
        }
        return sample, resources

    def monitor(self, deadline):
        self.infrastructure = Infrastructure()
        ownerfd = os.pidfd_open(self.owner)
        poll = select.poll()
        poll.register(ownerfd, select.POLLIN)
        try:
            previous, last_phase = None, None
            while not self.stopped.is_set():
                started = time.monotonic()
                require(started < deadline, "E5A_DEADLINE")
                require(not poll.poll(0), "E5A_RUNNER_EXITED")
                require(started - self.heartbeat.value <= 3, "E5A_RUNNER_HEARTBEAT")
                index = self.phase.value
                require(started <= self.phase_end.value + 0.5, "E5A_PHASE_DEADLINE")
                if self.abort.is_set():
                    raise Blocked(self.failure_reason("E5A_WORKLOAD_ABORT"))
                if index == 4:
                    # Main process owns cleanup while alive. Keep host/daemon checks active.
                    sample, resources = self.read_sample(
                        "recovery", min(deadline, started + 0.24)
                    )
                    validate_observation(
                        sample,
                        phase="recovery",
                        now=int(time.monotonic() * 1000),
                        previous=None,
                        daemon=self.daemon,
                        limits={},
                        running=set(),
                    )
                else:
                    phase = PHASES[index]
                    sample, resources = self.read_sample(
                        phase, min(deadline, started + 0.24)
                    )
                    validate_observation(
                        sample,
                        phase=phase,
                        now=int(time.monotonic() * 1000),
                        previous=previous if last_phase == phase else None,
                        daemon=self.daemon,
                        limits=PHASE_LIMITS[phase],
                        running=set(sample["containers"]),
                    )
                    payload = json.dumps(
                        {"sample": sample, "resources": resources}
                    ).encode("ascii")
                    require(len(payload) <= len(self.latest), "E5A_SAMPLE_IPC_SIZE")
                    require(
                        self.latest.get_lock().acquire(timeout=0.05),
                        "E5A_SAMPLE_IPC_BUSY",
                    )
                    try:
                        self.latest[: len(payload)] = payload
                        self.latest_size.value = len(payload)
                    finally:
                        self.latest.get_lock().release()
                    previous, last_phase = sample["monotonic_ms"], phase
                time.sleep(max(0, started + 0.25 - time.monotonic()))
        except FAILURES as error:
            self.abort.set()
            report = {
                "reason": str(error)
                if isinstance(error, Blocked)
                else type(error).__name__,
                "cleanup": "CLEANUP_UNCONFIRMED",
            }
            try:
                write_record(self.directory, "watchdog-abort.json", report)
                end = min(deadline, time.monotonic() + 10)
                for phase in self.children:
                    self.recover_phase(phase, end)
                report["cleanup"] = "CONFIRMED"
            except FAILURES:
                pass
            finally:
                write_record(self.directory, "watchdog-cleanup.json", report)
        finally:
            os.close(ownerfd)

    def close(self):
        for fd in self.children.values():
            os.close(fd)
