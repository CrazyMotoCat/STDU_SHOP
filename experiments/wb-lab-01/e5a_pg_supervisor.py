"""Process supervisor for the paired E5A SQL workload."""

import os
import select
import stat
import time
from subprocess import SubprocessError
from uuid import uuid4

from e5a_engine import HEX, verify_intent
from e5a_pg_engine import read_record, write_record
from e5a_pg_identity import SOCKET_NAME
from preflight import Blocked, require

INTERVAL = 0.250
FAILURES = (Blocked, OSError, ValueError, TypeError, LookupError, SubprocessError)


class PairedRecovery:
    def __init__(self, postgres, pg_intent, controller_intent, *, media=None):
        require(
            (pg_intent.run, pg_intent.daemon)
            == (controller_intent.run, controller_intent.daemon),
            "E5A_PAIRED_INTENT",
        )
        self.postgres = postgres
        self.pg_intent = pg_intent
        self.controller_intent = controller_intent
        require(media is None or media.intent == controller_intent, "E5A_PAIRED_INTENT")
        self.media = media

    def recover(self, directory, deadline):
        if self.media is not None:
            self.media.recover(directory, deadline)
            self.postgres.recover(directory, self.pg_intent, deadline)
            self.remove_socket_directory(directory)
            return
        engine, intent = self.postgres.engine, self.controller_intent
        verify_intent(directory, intent)
        engine.attest(intent, deadline)
        record = read_record(directory, "paired-controller.json", optional=True)
        current = engine.inspect(intent.name, deadline)
        if record is None:
            require(current is not None, "E5A_CONTROLLER_CREATE_UNKNOWN")
            cid = current["Id"]
        else:
            require(record.keys() == {"id"}, "E5A_CONTROLLER_LEDGER")
            cid = record["id"]
        require(HEX.fullmatch(cid), "E5A_CONTROLLER_LEDGER")
        if current is not None:
            engine.verify_controller(current, intent, cid)
            engine.verify_controller(engine.inspect(cid, deadline), intent, cid)
            if record is None:
                write_record(directory, "paired-controller.json", {"id": cid})
        else:
            require(engine.inspect(cid, deadline) is None, "E5A_CONTROLLER_REMAINS")
        # Validate the paired controller before mutating PostgreSQL resources.
        self.postgres.recover(directory, self.pg_intent, deadline)
        if current is not None:
            engine.attest(intent, deadline)
            engine.verify_controller(engine.inspect(cid, deadline), intent, cid)
            engine.request(
                "DELETE",
                f"/containers/{cid}?v=false&force=false",
                deadline,
                statuses=(204,),
            )
        engine.attest(intent, deadline)
        require(
            engine.inspect(cid, deadline) is None
            and engine.inspect(intent.name, deadline) is None,
            "E5A_CONTROLLER_REMAINS",
        )
        self.remove_socket_directory(directory)

    @staticmethod
    def remove_socket_directory(directory):
        record = read_record(directory, "pg-socket.json")
        require(record.keys() == {"identity"}, "E5A_PG_SOCKET_LEDGER")
        try:
            info = os.stat("pg-socket", dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            return
        require(
            stat.S_ISDIR(info.st_mode)
            and info.st_uid == 999
            and stat.S_IMODE(info.st_mode) == 0o700
            and [info.st_dev, info.st_ino] == record["identity"],
            "E5A_PG_SOCKET_DIRECTORY",
        )
        fd = os.open(
            "pg-socket", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
        )
        try:
            require(os.path.samestat(info, os.fstat(fd)), "E5A_PG_SOCKET_DIRECTORY")
            entries = (
                read_record(directory, "pg-socket-entries.json", optional=True) or {}
            )
            names = set(os.listdir(fd))
            require(
                entries.keys() <= {SOCKET_NAME, SOCKET_NAME + ".lock"}
                and names <= entries.keys(),
                "E5A_PG_SOCKET_RESIDUAL",
            )
            for name in names:
                entry = os.stat(name, dir_fd=fd, follow_symlinks=False)
                kind = stat.S_ISSOCK if name == SOCKET_NAME else stat.S_ISREG
                require(
                    kind(entry.st_mode)
                    and entry.st_uid == 999
                    and entry.st_nlink == 1
                    and [entry.st_dev, entry.st_ino] == entries[name],
                    "E5A_PG_SOCKET_RESIDUAL",
                )
            for name in names:
                os.unlink(name, dir_fd=fd)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rmdir("pg-socket", dir_fd=directory)
        os.fsync(directory)


def monitor_sql(
    directory,
    paired,
    runner_pidfd,
    work_end,
    cleanup_end,
    ready,
    result,
    *,
    finished=None,
):
    """Monitor an active SQL phase in a process independent of the runner."""
    report = {"status": "BLOCKED", "cleanup": "CLEANUP_UNCONFIRMED"}
    poll = select.poll()
    poll.register(runner_pidfd, select.POLLIN)
    try:
        while True:
            started = time.monotonic()
            require(started < work_end, "E5A_SQL_DEADLINE")
            if poll.poll(0):
                raise Blocked("E5A_RUNNER_EXITED")
            end = min(work_end, started + INTERVAL)
            paired.postgres.sample_data(directory, paired.pg_intent, end)
            require(time.monotonic() < end, "E5A_PG_DATA_SAMPLE_STALE")
            if ready is not None:
                ready.send(os.getpid())
                ready = None
            if finished is not None and finished.is_set():
                require(
                    read_record(directory, "paired-abort.json", optional=True) is None,
                    "E5A_PAIRED_ABORTED",
                )
                report["status"] = "SQL_PHASE_COMPLETE"
                break
            if poll.poll(max(0, int((end - time.monotonic()) * 1000))):
                raise Blocked("E5A_RUNNER_EXITED")
    except FAILURES as error:
        report["reason"] = (
            str(error) if isinstance(error, Blocked) else type(error).__name__
        )
        try:
            initial = read_record(directory, "paired-abort.json", optional=True)
            if initial is not None:
                require(
                    set(initial) == {"status", "reason", "cleanup"}
                    and initial["status"] == "BLOCKED"
                    and initial["cleanup"] == "CLEANUP_UNCONFIRMED"
                    and isinstance(initial["reason"], str),
                    "E5A_PAIRED_ABORT_LEDGER",
                )
                report["reason"] = initial["reason"]
        except FAILURES:
            report["reason"] = "E5A_PAIRED_ABORT_LEDGER"

    def record_abort():
        try:
            write_record(directory, "paired-abort.json", report)
        except FileExistsError:
            pass

    try:
        if report["status"] == "BLOCKED":
            record_abort()
    finally:
        try:
            paired.recover(directory, cleanup_end)
            require(time.monotonic() < cleanup_end, "E5A_CLEANUP_DEADLINE")
            report["cleanup"] = "CONFIRMED"
        except FAILURES:
            if report["status"] != "BLOCKED":
                report.update(status="BLOCKED", reason="E5A_PAIRED_CLEANUP")
                record_abort()
        try:
            write_record(directory, "paired-cleanup.json", report)
        except FileExistsError:
            write_record(directory, f"paired-cleanup-{uuid4().hex}.json", report)
        result.send(report)
