"""Six deterministic PostgreSQL experiments. No provisioning on import."""

import hashlib
import json
import os
import selectors
import subprocess
import time
import uuid
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path

from preflight import Blocked, require

DIGEST = hashlib.sha256(b"synthetic E2 original").hexdigest()
SIZE = len(b"synthetic E2 original")


class Session:
    """Bounded psql client with explicit barriers and private synthetic responses."""

    def __init__(self, argv, deadline):
        self.deadline = deadline
        self.pending = None
        self.buffer = b""
        self.selector = selectors.DefaultSelector()
        self.process = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def send(self, sql):
        require(self.pending is None, "E2_QUERY_ALREADY_PENDING")
        self.sent_at = time.monotonic()
        self.pending = "e2_" + uuid.uuid4().hex
        self.process.stdin.write((sql + "\nSELECT '" + self.pending + "';\n").encode())
        self.process.stdin.flush()

    def receive(self):
        require(self.pending is not None, "E2_NO_PENDING_QUERY")
        lines = []
        started = self.sent_at
        while True:
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                if line.strip() == self.pending.encode():
                    require(
                        time.monotonic() < min(self.deadline, started + 3),
                        "E2_LATE_QUERY",
                    )
                    self.pending = None
                    return lines, round((time.monotonic() - started) * 1000, 3)
                if line.strip():
                    lines.append(line.decode())
            require(
                sum(map(len, lines)) + len(self.buffer) <= 65536, "E2_RESPONSE_LIMIT"
            )
            budget = min(
                self.deadline - time.monotonic(), 3 - (time.monotonic() - started)
            )
            require(budget > 0, "E2_QUERY_DEADLINE")
            require(self.selector.select(budget), "E2_QUERY_TIMEOUT")
            data = os.read(self.process.stdout.fileno(), 4096)
            require(bool(data), "E2_QUERY_FAILED")
            self.buffer += data

    def query(self, sql):
        self.send(sql)
        return self.receive()[0]

    def scalar(self, sql):
        lines = self.query(sql)
        require(len(lines) == 1, "E2_SCALAR_SHAPE")
        return lines[0]

    def lost_commit_response(self):
        # No receive is performed for COMMIT. A separate connection determines outcome.
        require(self.pending is None, "E2_QUERY_ALREADY_PENDING")
        self.process.stdin.write(b"COMMIT;\n\\q\n")
        self.process.stdin.flush()

    def close(self):
        self.selector.close()
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=1)
        self.process.stdin.close()
        self.process.stdout.close()


def outcome(
    session, target, generation=1, owner="writer_a", key=None, digest=DIGEST, size=SIZE
):
    key = key or f"command_{target}"
    # Inputs are fixed synthetic cases, not request data.
    return json.loads(
        session.scalar(
            f"SELECT e2.finalize({target},{generation},'{owner}','{digest}',{size},'{key}');"
        )
    )


def wait_for(observer, predicate, deadline):
    polls = 0
    while time.monotonic() < deadline and polls < 40:
        polls += 1
        if observer.scalar(predicate) == "t":
            return polls
    raise Blocked("E2_BARRIER_TIMEOUT")


def run_cases(factory, deadline, *, digest=DIGEST, size=SIZE, report=None):
    report = {} if report is None else report
    report["trials"] = []
    require(
        len(digest) == 64
        and all(c in "0123456789abcdef" for c in digest)
        and isinstance(size, int)
        and size > 0,
        "E2_SYNTHETIC_PAYLOAD",
    )

    def finish(session, target, **kwargs):
        return outcome(
            session,
            target,
            size=kwargs.pop("size", size),
            digest=kwargs.pop("digest", digest),
            **kwargs,
        )

    with ExitStack() as stack:
        clients = []
        for _ in range(3):
            client = factory(deadline)
            stack.callback(client.close)
            clients.append(client)
            client.query("SET statement_timeout='2500ms'; SET lock_timeout='1000ms';")
        holder, contender, observer = clients
        holder.query(Path(__file__).with_name("e2_schema.sql").read_text())
        holder.query(
            f"INSERT INTO e2.intent(id,digest,size) SELECT n,'{digest}',{size} FROM generate_series(1,6) n;"
        )
        results = report["trials"]

        def record(case, started, details):
            require(time.monotonic() < deadline, "E2_SERIES_DEADLINE")
            bad = observer.scalar(
                "SELECT EXISTS(SELECT 1 FROM e2.intent i LEFT JOIN e2.reference r ON r.intent_id=i.id "
                "WHERE (i.state='COMMITTED') <> (r.intent_id IS NOT NULL) "
                "OR i.applications <> CASE WHEN r.intent_id IS NULL THEN 0 ELSE 1 END "
                "OR (r.intent_id IS NOT NULL AND (r.generation<>i.generation OR r.digest<>i.digest OR r.size<>i.size)));"
            )
            require(bad == "f", "E2_SQL_INVARIANT")
            results.append(
                {
                    "case": case,
                    "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
                    **details,
                }
            )

        t = time.monotonic()
        holder.query("BEGIN;")
        count = holder.scalar(
            "WITH changed AS (UPDATE e2.intent SET generation=generation+1 WHERE id=1 AND generation=1 RETURNING id) SELECT count(*) FROM changed;"
        )
        contender.query("SET application_name='wb_e2_cas';")
        contender.send(
            "WITH changed AS (UPDATE e2.intent SET generation=generation+1 WHERE id=1 AND generation=1 RETURNING id) SELECT count(*) FROM changed;"
        )
        wait_for(
            observer,
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='wb_e2_cas' AND wait_event_type='Lock');",
            deadline,
        )
        holder.query("COMMIT;")
        rows, blocked_ms = contender.receive()
        require(len(rows) == 1, "E2_CAS_SHAPE")
        stale = rows[0]
        require(count == "1" and stale == "0", "E2_CAS")
        require(
            finish(holder, 1, generation=2, digest="0" * 64)["outcome"]
            == "HASH_OR_SIZE_MISMATCH",
            "E2_HASH_DENIAL",
        )
        require(
            finish(holder, 1, generation=2, size=size + 1)["outcome"]
            == "HASH_OR_SIZE_MISMATCH",
            "E2_SIZE_DENIAL",
        )
        record(
            "cas_and_hash",
            t,
            {"winner_rows": 1, "stale_rows": 0, "blocked_query_ms": blocked_ms},
        )

        t = time.monotonic()
        holder.query("BEGIN; SELECT id FROM e2.intent WHERE id=2 FOR UPDATE;")
        contender.query("BEGIN; SET LOCAL application_name='wb_e2_waiter';")
        contender.send(
            f"SELECT e2.finalize(2,1,'writer_a','{digest}',{size},'command_2');"
        )
        polls = wait_for(
            observer,
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='wb_e2_waiter' AND wait_event_type='Lock');",
            deadline,
        )
        holder.query(
            "UPDATE e2.intent SET expires_at=clock_timestamp() WHERE id=2; COMMIT;"
        )
        lines, wait_ms = contender.receive()
        require(len(lines) == 1, "E2_EXPIRY_SHAPE")
        expired = json.loads(lines[0])
        contender.query("COMMIT;")
        require(
            expired["outcome"] == "EXPIRED"
            and datetime.fromisoformat(expired["transaction_time"])
            < datetime.fromisoformat(expired["expires_at"])
            <= datetime.fromisoformat(expired["decision_time"]),
            "E2_EXPIRY_AFTER_LOCK",
        )
        record(
            "expiry_after_row_lock",
            t,
            {"barrier_polls": polls, "wait_ms": wait_ms, **expired},
        )

        t = time.monotonic()
        holder.query(
            "UPDATE e2.intent SET generation=2,owner='writer_b' WHERE id=3 AND generation=1;"
        )
        require(finish(contender, 3)["outcome"] == "STALE", "E2_OLD_OWNER")
        require(
            finish(holder, 3, generation=2, owner="writer_b")["outcome"] == "COMMITTED",
            "E2_NEW_OWNER",
        )
        require(finish(contender, 3)["outcome"] == "CONFLICT", "E2_OLD_OWNER_REPLAY")
        record(
            "generation_owner_fencing",
            t,
            {"old_owner": "STALE", "new_owner": "COMMITTED"},
        )

        t = time.monotonic()
        holder.query("BEGIN;")
        require(finish(holder, 4)["outcome"] == "COMMITTED", "E2_PRECOMMIT")
        holder.lost_commit_response()
        wait_for(
            observer,
            "SELECT EXISTS(SELECT 1 FROM e2.reference WHERE intent_id=4);",
            deadline,
        )
        holder.close()
        holder = factory(deadline)
        stack.callback(holder.close)
        holder.query("SET statement_timeout='2500ms'; SET lock_timeout='1000ms';")
        replay = finish(holder, 4)
        require(
            replay["outcome"] == "REPLAY"
            and finish(contender, 4, key="different")["outcome"] == "CONFLICT"
            and finish(contender, 4, digest="0" * 64)["outcome"] == "CONFLICT",
            "E2_REPLAY",
        )
        record(
            "lost_commit_response", t, {"status_lookup": "COMMITTED", "retry": "REPLAY"}
        )

        t = time.monotonic()
        holder.query(
            f"DO $$ BEGIN BEGIN PERFORM e2.finalize(5,1,'writer_a','{digest}',{size},'rollback_5'); "
            "UPDATE e2.intent SET generation=0 WHERE id=5; "
            "RAISE EXCEPTION 'E2_EXPECTED_CONSTRAINT'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;"
        )
        require(
            holder.scalar(
                "SELECT generation=1 AND state='WRITING' AND applications=0 "
                "AND NOT EXISTS(SELECT 1 FROM e2.reference WHERE intent_id=5) "
                "FROM e2.intent WHERE id=5;"
            )
            == "t",
            "E2_ROLLBACK",
        )
        require(finish(holder, 5)["outcome"] == "COMMITTED", "E2_RECOVERY")
        record("constraint_rollback_recovery", t, {"recovered": True})

        t = time.monotonic()
        holder.query(
            "BEGIN; UPDATE e2.intent SET expires_at=clock_timestamp()+interval '1 second' WHERE id=6;"
        )
        decided = finish(holder, 6)
        require(decided["outcome"] == "COMMITTED", "E2_DECISION_BEFORE_EXPIRY")
        holder.query("SELECT pg_sleep(1.05);")
        require(
            holder.scalar(
                "SELECT clock_timestamp()>expires_at FROM e2.intent WHERE id=6;"
            )
            == "t",
            "E2_COMMIT_DELAY",
        )
        holder.query("COMMIT;")
        require(finish(contender, 6)["outcome"] == "REPLAY", "E2_DELAYED_COMMIT_REPLAY")
        record(
            "decision_then_delayed_commit",
            t,
            {"decision_before_expiry": True, "expiry_before_commit": True},
        )
        count = int(observer.scalar("SELECT count(*) FROM e2.reference;"))
        require(count == 4, "E2_REFERENCE_COUNT")
        report.update(
            database_version=observer.scalar("SHOW server_version;"),
            reference_count=count,
            digest=digest,
            expiry_boundary="under-row-lock decision",
        )
        return report
