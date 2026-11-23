"""Offline Unix-socket Engine exchanges against an isolated fake peer."""

import json
import multiprocessing
import os
import socket
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from e5a_engine import Engine, EngineTimeout
from e5a_host import HostBackend
from preflight import Blocked


def serve(listener, behavior, seen, release):
    if behavior == "monitor":
        serve(listener, "identity", seen, release)
        behavior = "silent"
    peer, _ = listener.accept()
    with peer, peer.makefile("rb") as stream:
        seen.send(stream.readline(4096).decode("ascii").split()[:2])
        while stream.readline(4096) not in (b"\r\n", b""):
            pass
        if behavior == "drip":
            try:
                peer.sendall(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                for _ in range(60):
                    peer.sendall(b"1\r\nX\r\n")
                    time.sleep(0.025)
            except BrokenPipeError:
                pass
        elif behavior == "lost":
            return
        elif behavior == "identity":
            peer.sendall(
                b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 20\r\n\r\n"
                b'{"ID":"fake-daemon"}'
            )
        elif behavior == "success":
            peer.sendall(
                b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\n{}"
            )
        else:
            release.wait(5)


@unittest.skipUnless(os.name == "posix", "requires a local POSIX Unix socket")
class UnixEngineTests(unittest.TestCase):
    @contextmanager
    def fake_engine(self, behavior):
        context = multiprocessing.get_context("fork")
        with TemporaryDirectory() as temp, socket.socket(socket.AF_UNIX) as listener:
            path = Path(temp) / "engine.sock"
            listener.bind(str(path))
            listener.listen()
            inbox, outbox = context.Pipe(duplex=False)
            release = context.Event()
            process = context.Process(
                target=serve, args=(listener, behavior, outbox, release)
            )
            process.start()
            outbox.close()
            try:
                with patch("e5a_engine.SOCKET", path):
                    yield Engine(), inbox
            finally:
                inbox.close()
                release.set()
                process.join(2)
                if process.is_alive():
                    process.kill()
                    process.join(2)

    def test_hung_create_start_inspect_stats_and_daemon_report_exact_operations(self):
        routes = (
            ("POST", "/containers/create?name=private", "CONTAINER_CREATE"),
            ("POST", "/containers/private/start", "CONTAINER_START"),
            ("GET", "/containers/private/json", "CONTAINER_INSPECT"),
            ("GET", "/containers/private/stats?stream=false", "CONTAINER_STATS"),
            ("GET", "/info", "DAEMON_GET"),
        )
        for method, path, operation in routes:
            with (
                self.subTest(operation=operation),
                self.fake_engine("silent") as (engine, inbox),
            ):
                begin = time.monotonic()
                with self.assertRaises(EngineTimeout) as raised:
                    engine.request(method, path, begin + 0.15)
                self.assertEqual(
                    str(raised.exception), "E5A_ENGINE_TIMEOUT_" + operation
                )
                details = raised.exception.details
                self.assertEqual(details["stage"], "HEADERS")
                self.assertLessEqual(details["budget_ms"], 150)
                self.assertGreaterEqual(details["elapsed_ms"], details["budget_ms"] - 2)
                self.assertLess(time.monotonic() - begin, 2)
                self.assertTrue(inbox.poll(1))
                self.assertEqual(inbox.recv(), [method, path])
                self.assertFalse(inbox.poll(0))

    def test_slow_stream_cannot_reset_the_absolute_deadline(self):
        with self.fake_engine("drip") as (engine, _):
            with self.assertRaisesRegex(
                EngineTimeout, "E5A_ENGINE_TIMEOUT_CONTAINER_STATS"
            ) as raised:
                engine.request(
                    "GET", "/containers/private/stats", time.monotonic() + 0.15
                )
            self.assertEqual(raised.exception.details["stage"], "BODY")

    def test_lost_response_is_an_error_and_no_request_is_replayed(self):
        with self.fake_engine("lost") as (engine, inbox):
            with self.assertRaisesRegex(Blocked, "^E5A_ENGINE_TRANSPORT$"):
                engine.request(
                    "POST", "/containers/create?name=private", time.monotonic() + 1
                )
            self.assertTrue(inbox.poll(1))
            self.assertEqual(inbox.recv(), ["POST", "/containers/create?name=private"])

    def test_connection_close_supports_a_complete_reply(self):
        with self.fake_engine("success") as (engine, _):
            self.assertEqual(engine.request("GET", "/info", time.monotonic() + 1), {})

    def test_response_completed_after_deadline_is_rejected(self):
        def delayed(method, path, body, deadline):
            time.sleep(max(0, deadline - time.monotonic()))
            return 200, b"{}"

        with self.assertRaisesRegex(
            EngineTimeout, "E5A_ENGINE_TIMEOUT_DAEMON_GET"
        ) as raised:
            Engine(delayed).request("GET", "/info", time.monotonic() + 0.01)
        self.assertEqual(raised.exception.details["stage"], "RESPONSE")

    def test_independent_watchdog_records_daemon_silence_within_its_tick_budget(self):
        with (
            TemporaryDirectory() as directory,
            self.fake_engine("monitor") as (engine, _),
        ):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            backend = HostBackend(
                fd,
                "a" * 32,
                {"daemon_id": "fake-daemon", "nonce": "d" * 64},
                {"controller": "sha256:" + "a" * 64, "postgres": "sha256:" + "b" * 64},
                engine=engine,
            )
            infrastructure = {
                "status": "AVAILABLE",
                "processes": [
                    {
                        "role": "docker",
                        "pid": 42,
                        "start_before": 1,
                        "start_after": 1,
                        "rss_bytes": 1,
                        "cpu_user_ticks": 0,
                        "cpu_system_ticks": 0,
                    }
                ],
            }
            try:
                with (
                    patch("e5a_host.ROOT", Path(directory)),
                    patch("e5a_host.mem_available", return_value=1024**3),
                    patch(
                        "e5a_host.Infrastructure.sample", return_value=infrastructure
                    ),
                ):
                    backend.start_watchdog(time.monotonic() + 7)
                    backend.watch.join(2)
                self.assertFalse(backend.watch.is_alive())
                report = json.loads(
                    (Path(directory) / "watchdog-abort.json").read_bytes()
                )
                self.assertEqual(report["reason"], "E5A_ENGINE_TIMEOUT_DAEMON_GET")
                self.assertEqual(report["engine_timeout"]["stage"], "HEADERS")
                self.assertLessEqual(report["engine_timeout"]["budget_ms"], 240)
                self.assertTrue(backend.watchdog_cleanup_confirmed())
            finally:
                if backend.watch is not None and backend.watch.is_alive():
                    backend.watch.kill()
                    backend.watch.join(1)
                backend.close()
                os.close(fd)
