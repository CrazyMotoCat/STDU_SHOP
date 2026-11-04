import json
import subprocess
import unittest
from unittest.mock import patch

import run

NAME = "vis-cat-02b-unit"
CID = "a" * 64


def reply(stdout=b"", code=0, stderr=b""):
    return subprocess.CompletedProcess([], code, stdout, stderr)


def owned(running=False, name=NAME, label=NAME):
    return reply(
        json.dumps(
            [
                {
                    "Id": CID,
                    "Name": "/" + name,
                    "Config": {"Labels": {run.OWNER_LABEL: label}},
                    "State": {"Running": running},
                }
            ]
        ).encode()
    )


def missing(reference=CID):
    return reply(
        code=1,
        stderr=f"Error response from daemon: No such container: {reference}".encode(),
    )


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(
            run.uuid, "uuid4", return_value=type("Id", (), {"hex": "unit"})()
        ).start()
        self.cli = patch.object(run.subprocess, "run").start()
        self.created = reply(CID.encode())
        self.started = reply(b'{"status":"accepted"}')

    def execute(self, *responses):
        self.cli.side_effect = responses
        return run.run("lab-image", "/bench/codec.py", "versions")

    def commands(self):
        return [call.args[0][1:] for call in self.cli.call_args_list]

    def assert_removed_by_id(self):
        self.assertEqual(
            self.commands()[-2:],
            [
                ["container", "rm", "--force", CID],
                ["container", "inspect", CID],
            ],
        )
        for call in self.cli.call_args_list[2:]:
            self.assertGreater(call.kwargs["timeout"], 0)
            self.assertLessEqual(call.kwargs["timeout"], 3)

    def test_success_removes_exited_container_and_confirms_absence(self):
        self.assertEqual(
            self.execute(self.created, self.started, owned(), reply(), missing()),
            {"status": "accepted"},
        )
        self.assertEqual(self.commands()[1], ["start", "-a", "-i", CID])
        self.assert_removed_by_id()

    def test_timeout_kills_running_container_then_confirms_absence(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            self.execute(
                self.created,
                subprocess.TimeoutExpired("start", 30),
                owned(True),
                reply(),
                reply(),
                missing(),
            )
        self.assertIn(["container", "kill", CID], self.commands())
        self.assert_removed_by_id()

    def test_kill_refused_but_concurrent_exit_is_confirmed(self):
        self.execute(
            self.created,
            self.started,
            owned(True),
            reply(code=1),
            owned(False),
            reply(),
            missing(),
        )
        self.assert_removed_by_id()

    def test_kill_and_remove_refused_reports_cleanup(self):
        with self.assertRaisesRegex(run.CleanupUnconfirmed, CID):
            self.execute(
                self.created,
                subprocess.TimeoutExpired("start", 30),
                owned(True),
                reply(code=1),
                owned(True),
                reply(code=1),
                owned(True),
            )

    def test_daemon_timeout_reports_cleanup_with_identity(self):
        with self.assertRaisesRegex(run.CleanupUnconfirmed, f"name={NAME} id={CID}"):
            self.execute(
                self.created, self.started, subprocess.TimeoutExpired("inspect", 3)
            )
        self.assertLessEqual(self.cli.call_args.kwargs["timeout"], 3)

    def test_keyboard_interrupt_cleans_up(self):
        with self.assertRaises(KeyboardInterrupt):
            self.execute(
                self.created,
                KeyboardInterrupt(),
                owned(True),
                reply(),
                reply(),
                missing(),
            )
        self.assert_removed_by_id()

    def test_create_interruption_recovers_owned_id(self):
        with self.assertRaises(KeyboardInterrupt):
            self.execute(KeyboardInterrupt(), owned(False), reply(), missing())
        self.assertEqual(self.commands()[1], ["container", "inspect", NAME])
        self.assert_removed_by_id()

    def test_create_error_with_no_id_surfaces_uncertain_outcome(self):
        create_error = subprocess.CalledProcessError(
            1, "create", stderr=b"daemon error"
        )
        with self.assertRaisesRegex(run.CleanupUnconfirmed, f"name={NAME} id=unknown"):
            self.execute(create_error, missing(NAME))
        self.assertEqual(self.commands()[1:], [["container", "inspect", NAME]])

    def test_foreign_container_is_never_stopped_or_removed(self):
        with self.assertRaisesRegex(run.CleanupUnconfirmed, "id=unknown"):
            self.execute(KeyboardInterrupt(), owned(label="another-process"))
        self.assertEqual(self.commands()[1:], [["container", "inspect", NAME]])

    def test_invalid_result_still_removes_container(self):
        with self.assertRaises(json.JSONDecodeError):
            self.execute(self.created, reply(b"invalid"), owned(), reply(), missing())
        self.assert_removed_by_id()

    def test_subprocess_failure_still_removes_container(self):
        error = subprocess.CalledProcessError(42, "start", stderr=b"fixture failed")
        with self.assertRaisesRegex(RuntimeError, "fixture failed"):
            self.execute(self.created, error, owned(), reply(), missing())
        self.assert_removed_by_id()

    def test_start_uses_remaining_workload_budget(self):
        with patch.object(run.time, "monotonic", side_effect=[0, 25, 25, 25, 25, 25]):
            self.execute(self.created, self.started, owned(), reply(), missing())
        self.assertEqual(self.cli.call_args_list[1].kwargs["timeout"], 5)

    def test_deadline_bounds_later_commands(self):
        with (
            patch.object(run.time, "monotonic", side_effect=[0, 0, 100, 100, 109, 110]),
            self.assertRaisesRegex(run.CleanupUnconfirmed, CID),
        ):
            self.execute(self.created, self.started, owned(True), reply())
        self.assertEqual(self.cli.call_args.kwargs["timeout"], 1)
        self.assertEqual(self.commands()[-1], ["container", "kill", CID])


if __name__ == "__main__":
    unittest.main()
