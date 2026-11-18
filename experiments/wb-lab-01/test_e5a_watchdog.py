"""Offline supervision failures keep the first cause and report cleanup."""

import os
import time
import unittest
from threading import Event

from e5a_watchdog import launch_monitor, supervise
from preflight import Blocked


class Backend:
    def __init__(self, *, cleanup_fails=False):
        self.cleanup_fails = cleanup_fails
        self.abort = None
        self.cleaned = False

    def attested_state(self):
        return {"deadline": time.monotonic() + 10}

    def verify_owner_process(self, state):
        raise Blocked("E5A_RUNNER_EXITED")

    def record_abort(self, report):
        self.abort = report

    def cleanup_attested_resources(self, deadline):
        if self.cleanup_fails:
            raise Blocked("E5A_RESOURCE_OWNERSHIP")
        self.cleaned = True


class WatchdogTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "fork-based laboratory watchdog")
    def test_monitor_reports_from_a_separate_process(self):
        child, stop, ready, result = launch_monitor(Backend(), time.monotonic() + 3)
        try:
            self.assertTrue(ready.poll(2))
            self.assertEqual(ready.recv(), child.pid)
            self.assertNotEqual(child.pid, os.getpid())
            self.assertTrue(result.poll(2))
            self.assertEqual(result.recv()["cleanup"], "CONFIRMED")
        finally:
            stop.set()
            child.join(1)
            if child.is_alive():
                child.kill()
                child.join(1)
            ready.close()
            result.close()

    def test_runner_exit_preserves_first_cause(self):
        backend = Backend()
        result = supervise(backend, 20, Event(), clock=lambda: 0)
        self.assertEqual(backend.abort["reason"], "E5A_RUNNER_EXITED")
        self.assertEqual(result["reason"], "E5A_RUNNER_EXITED")
        self.assertEqual(result["cleanup"], "CONFIRMED")
        self.assertTrue(backend.cleaned)

    def test_ambiguous_ownership_does_not_report_cleanup(self):
        backend = Backend(cleanup_fails=True)
        result = supervise(backend, 20, Event(), clock=lambda: 0)
        self.assertEqual(result["reason"], "E5A_RUNNER_EXITED")
        self.assertEqual(result["cleanup"], "CLEANUP_UNCONFIRMED")
        self.assertFalse(backend.cleaned)
