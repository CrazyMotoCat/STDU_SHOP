"""Exact verification of synthetic E5A transactions over an owned Unix socket."""

import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

from e5a_engine import RUN
from e5a_libpq import ConnectionLost, exchange
from e5a_pg_identity import socket_directory
from preflight import Blocked, require

SETTINGS = "SET lock_timeout='1s'; SET statement_timeout='2500ms';"


def query(run_fd, identity, expected_run, sql, deadline, *, peer=None):
    with socket_directory(run_fd, identity, expected_run) as directory:
        if peer is None:
            raise Blocked("E5A_PG_CONNECTED_PEER_UNPROVEN")
        require(sql.count("/* attest */") == 1, "E5A_PG_GUARD_REQUIRED")
        return exchange(
            directory,
            identity,
            peer,
            SETTINGS + "\n" + sql.replace("/* attest */", identity.guard_sql(), 1),
            deadline,
        )


def execute_psql(socket_fd, identity, sql, deadline):
    require(sql.count("/* attest */") == 1, "E5A_PG_GUARD_REQUIRED")
    remaining = deadline - time.monotonic()
    require(remaining > 0, "E5A_SQL_DEADLINE")
    result = subprocess.run(
        [
            "/usr/bin/psql",
            "-X",
            "-w",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            f"/proc/self/fd/{socket_fd}",
            "-p",
            "5432",
            "-U",
            "wb_bootstrap",
            "-d",
            identity.name,
        ],
        input=SETTINGS + "\n" + sql.replace("/* attest */", identity.guard_sql(), 1),
        text=True,
        encoding="ascii",
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env={"LANG": "C", "PGCONNECT_TIMEOUT": "2"},
        pass_fds=(socket_fd,),
        timeout=min(remaining, 3),
        check=False,
    )
    require(time.monotonic() < deadline, "E5A_SQL_DEADLINE")
    if result.returncode == 2:
        raise ConnectionLost("E5A_PG_CONNECTION_LOST")
    require(result.returncode == 0 and len(result.stdout) <= 1024, "E5A_SQL_FAILED")
    return result.stdout.splitlines()


def insert_and_verify(execute, sequence, *, discard_ack=False):
    """On a lost response, reconcile via a fresh read and never repeat the write."""
    require(type(sequence) is int and 1 <= sequence <= 3, "E5A_SQL_SEQUENCE")
    token = f"e5a-{sequence}"
    started = time.monotonic_ns()
    try:
        acknowledgment = execute(
            f"BEGIN; /* attest */ INSERT INTO public.e5a_measurement VALUES ({sequence}, '{token}');"
            f" SELECT payload FROM public.e5a_measurement WHERE id={sequence}; COMMIT;"
        )
        require(acknowledgment == [token], "E5A_SQL_READBACK")
        ack = not discard_ack
    except (ConnectionLost, subprocess.TimeoutExpired):
        ack = False
    rows = execute(
        "BEGIN READ ONLY; /* attest */ "
        f"SELECT payload FROM public.e5a_measurement WHERE id={sequence}; COMMIT;"
    )
    require(rows == [token], "E5A_COMMIT_OUTCOME_UNCONFIRMED")
    return {
        "sequence": sequence,
        "outcome": "COMMITTED" if ack else "COMMITTED_RECONCILED",
        "duration_us": (time.monotonic_ns() - started) // 1000,
    }


def row_lock(execute, run):
    """Wait for a server-observed lock holder, then require SQLSTATE 55P03."""
    require(RUN.fullmatch(run), "E5A_PG_LEDGER_IDENTITY")
    tag = f"e5a_lock_{run}"
    holder = (
        f"SET application_name='{tag}'; BEGIN; /* attest */ "
        "SELECT id FROM public.e5a_measurement WHERE id=1 FOR UPDATE;"
        "SELECT pg_sleep(2); ROLLBACK;"
    )
    contender = f"""
BEGIN; /* attest */
DO $lock$ DECLARE started timestamptz := clock_timestamp();
waiting timestamptz;
BEGIN
    LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE application_name = '{tag}' AND datname = current_database()
              AND wait_event = 'PgSleep'
        );
        IF clock_timestamp() - started >= interval '750 milliseconds'
        THEN RAISE EXCEPTION 'E5A_LOCK_BARRIER'; END IF;
        PERFORM pg_sleep(0.01);
    END LOOP;
    waiting := clock_timestamp();
    BEGIN
        PERFORM id FROM public.e5a_measurement WHERE id=1 FOR UPDATE;
        RAISE EXCEPTION 'E5A_LOCK_NOT_ENFORCED';
    EXCEPTION WHEN lock_not_available THEN
        PERFORM set_config('e5a.lock_us',
            ((extract(epoch FROM clock_timestamp()-waiting) * 1000000)::bigint)::text, true);
    END;
END $lock$;
SELECT current_setting('e5a.lock_us'); ROLLBACK;
"""
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(execute, holder)
        rows = execute(contender)
        require(pending.result() == ["1", ""], "E5A_LOCK_HOLDER_RESULT")
    require(
        len(rows) == 1 and rows[0].isascii() and rows[0].isdecimal(), "E5A_LOCK_RESULT"
    )
    elapsed = int(rows[0])
    require(900_000 <= elapsed <= 2_500_000, "E5A_LOCK_DURATION")
    return {"lock_timeout": True, "duration_us": elapsed}


def workload(execute, run):
    transactions = [
        insert_and_verify(execute, sequence, discard_ack=sequence == 3)
        for sequence in range(1, 4)
    ]
    return {"transactions": transactions, "row_lock": row_lock(execute, run)}
