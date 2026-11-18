"""Independent E5A supervisor loop with a write-once failure result."""

import os
import time
from multiprocessing import get_context
from subprocess import TimeoutExpired

from preflight import Blocked
from runtime_e5a import INTERVAL

FAILURES = (Blocked, OSError, ValueError, KeyError, TypeError, TimeoutExpired)


def monitor_process(backend, deadline, stop, ready, result):
    """Watchdog child owns its result pipe and can outlive the runner."""
    try:
        ready.send(os.getpid())
        result.send(supervise(backend, deadline, stop))
    finally:
        ready.close()
        result.close()


def launch_monitor(backend, deadline):
    context = get_context("fork")
    stop = context.Event()
    ready, ready_writer = context.Pipe(duplex=False)
    result, result_writer = context.Pipe(duplex=False)
    child = context.Process(
        target=monitor_process,
        args=(backend, deadline, stop, ready_writer, result_writer),
    )
    child.start()
    ready_writer.close()
    result_writer.close()
    return child, stop, ready, result


def supervise(backend, deadline, stop, *, clock=time.monotonic, sleep=time.sleep):
    """Run in the watchdog process. The backend must bound all external calls."""
    while True:
        started = clock()
        try:
            if started >= deadline:
                raise Blocked("E5A_DEADLINE")
            state = backend.attested_state()
            end = min(deadline, state["deadline"])
            if started >= end:
                raise Blocked("E5A_PHASE_DEADLINE")
            backend.verify_owner_process(state)
            backend.verify_sample_and_resources(state, min(end, started + INTERVAL))
            if clock() >= end:
                raise Blocked("E5A_PHASE_DEADLINE")
            if stop.is_set():
                backend.verify_no_owned_resources(end)
                return {"status": "STOPPED"}
        except FAILURES as error:
            reason = str(error) if isinstance(error, Blocked) else type(error).__name__
            report = {
                "status": "BLOCKED",
                "reason": reason,
                "cleanup": "CLEANUP_UNCONFIRMED",
            }
            try:
                backend.record_abort(dict(report))
            finally:
                try:
                    cleanup_end = min(deadline, clock() + 10)
                    if clock() < cleanup_end:
                        backend.cleanup_attested_resources(cleanup_end)
                        if clock() < cleanup_end:
                            report["cleanup"] = "CONFIRMED"
                except FAILURES:
                    pass
            return report
        sleep(max(0, min(started + INTERVAL, end) - clock()))
