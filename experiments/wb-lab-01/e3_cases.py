"""Ten bounded storage/SQL fault cases in one disposable database and owned volume."""

import hashlib
import json
import os
import stat
import time
from contextlib import ExitStack
from pathlib import Path

from e2_cases import Session, wait_for
from e3_probe import CASES, FOREIGN, PAYLOAD
from preflight import require


def schema(session):
    source = Path(__file__).with_name("e2_schema.sql").read_text()
    session.query(source.replace("SCHEMA e2", "SCHEMA e3").replace("e2.", "e3."))
    digest = hashlib.sha256(PAYLOAD).hexdigest()
    session.query(
        f"INSERT INTO e3.intent(id,digest,size) SELECT n,'{digest}',{len(PAYLOAD)} FROM generate_series(1,10) n;"
    )


def final(session, target):
    digest = hashlib.sha256(PAYLOAD).hexdigest()
    return json.loads(
        session.scalar(
            f"SELECT e3.finalize({target},1,'writer_a','{digest}',{len(PAYLOAD)},'command_{target}');"
        )
    )["outcome"]


def file_state(root, *, expected_uid=65532):
    require(root.resolve(strict=True) == root, "E3_STORAGE_PATH")
    rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(set(os.listdir(rootfd)) == {"stage", "final"}, "E3_STORAGE_DIRECTORIES")
        result = {}
        for directory in ("stage", "final"):
            fd = os.open(
                directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=rootfd
            )
            try:
                names = set(os.listdir(fd))
                allowed = (
                    ({f"object_{n}" for n in range(1, 11)} | {"foreign"})
                    if directory == "final"
                    else {
                        f"object_{n}{suffix}"
                        for n in range(1, 8)
                        for suffix in ("", ".retry")
                    }
                )
                require(names <= allowed, "E3_UNKNOWN_OBJECT")
                if directory == "final":
                    require(names == allowed, "E3_FINAL_SET")
                for name in names:
                    file = os.open(
                        name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd
                    )
                    try:
                        meta = os.fstat(file)
                        require(
                            stat.S_ISREG(meta.st_mode)
                            and meta.st_uid == expected_uid
                            and 0 < meta.st_size <= len(PAYLOAD),
                            "E3_FILE_IDENTITY",
                        )
                        data = os.read(file, len(PAYLOAD) + 1)
                        if directory == "final":
                            result[name] = {
                                "identity": [meta.st_dev, meta.st_ino],
                                "sha256": hashlib.sha256(data).hexdigest(),
                                "size": len(data),
                            }
                    finally:
                        os.close(file)
            finally:
                os.close(fd)
        return result
    finally:
        os.close(rootfd)


def run_sql(factory, deadline, storage, files, *, prepared=False, report=None):
    report = {} if report is None else report
    rows = report.setdefault("trials", [])
    expected = hashlib.sha256(PAYLOAD).hexdigest()
    with ExitStack() as stack:

        def client():
            value = factory(deadline)
            stack.callback(value.close)
            value.query("SET statement_timeout='2500ms'; SET lock_timeout='1000ms';")
            return value

        observer, writer = client(), client()
        if not prepared:
            schema(observer)

        def check():
            refs = [
                int(line)
                for line in observer.query(
                    "SELECT intent_id FROM e3.reference ORDER BY intent_id;"
                )
            ]
            bad = observer.scalar(
                "SELECT EXISTS(SELECT 1 FROM e3.intent i LEFT JOIN e3.reference r ON r.intent_id=i.id WHERE (i.state='COMMITTED')<>(r.intent_id IS NOT NULL) OR i.applications<>CASE WHEN r.intent_id IS NULL THEN 0 ELSE 1 END OR (r.intent_id IS NOT NULL AND (r.digest<>i.digest OR r.size<>i.size OR r.generation<>i.generation)));"
            )
            require(bad == "f", "E3_SQL_INVARIANT")
            for n in refs:
                data = files()["object_" + str(n)]
                require(
                    data["sha256"] == expected and data["size"] == len(PAYLOAD),
                    "E3_INVALID_FILE_REFERENCE",
                )
            require(7 not in refs, "E3_FOREIGN_REFERENCED")
            require(time.monotonic() < deadline, "E3_DEADLINE")

        manifest = files()
        require(len(storage["trials"]) == 7, "E3_STORAGE_CASE_COUNT")
        for n, (row, case) in enumerate(zip(storage["trials"], CASES, strict=True), 1):
            require(
                row["case"] == case and row["key"] == f"object_{n}", "E3_STORAGE_CASE"
            )
            require(
                all(
                    row[key] == manifest[row["key"]][key]
                    for key in ("sha256", "identity", "size")
                ),
                "E3_STORAGE_MANIFEST",
            )
            if n == 7:
                require(
                    manifest[row["key"]]["sha256"]
                    == hashlib.sha256(FOREIGN).hexdigest(),
                    "E3_FOREIGN_HASH",
                )
                # Controller refuses this known collision; never invoke a DB finalizer for it.
                outcome = "REFUSED"
            else:
                require(
                    manifest[row["key"]]["sha256"] == expected, "E3_RECOVERY_DIGEST"
                )
                require(
                    final(writer, n) == "COMMITTED" and final(writer, n) == "REPLAY",
                    "E3_STORAGE_COMMIT",
                )
                outcome = "COMMITTED"
            check()
            rows.append({**row, "database": outcome})
        require(
            manifest["foreign"]["identity"] == storage["foreign_identity"]
            and manifest["foreign"]["sha256"] == storage["foreign_sha256"],
            "E3_FOREIGN_CHANGED",
        )
        start = time.monotonic()
        # Application-side connection loss is injected, not a database-service outage.
        writer.close()
        require(writer.process.poll() is not None, "E3_CLIENT_EXIT")
        require(
            observer.scalar("SELECT count(*) FROM e3.reference WHERE intent_id=8;")
            == "0",
            "E3_OUTAGE_REFERENCE",
        )
        writer = client()
        require(
            final(writer, 8) == "COMMITTED" and final(writer, 8) == "REPLAY",
            "E3_OUTAGE_RECOVERY",
        )
        check()
        rows.append(
            {
                "case": "client_disconnect_recovery",
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
        start = time.monotonic()
        writer.query("SET application_name='wb_e3_owned_transaction'; BEGIN;")
        pid = int(writer.scalar("SELECT pg_backend_pid();"))
        require(final(writer, 9) == "COMMITTED", "E3_PRECOMMIT")
        # Authenticate exact backend before terminating this synthetic transaction only.
        require(
            observer.scalar(
                f"SELECT count(*) FROM pg_stat_activity WHERE pid={pid} AND datname=current_database() AND application_name='wb_e3_owned_transaction' AND usename=current_user;"
            )
            == "1",
            "E3_BACKEND_OWNERSHIP",
        )
        require(
            observer.scalar(f"SELECT pg_terminate_backend({pid});") == "t",
            "E3_BACKEND_TERMINATION",
        )
        wait_for(
            observer,
            f"SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid={pid});",
            deadline,
        )
        writer.close()
        require(
            observer.scalar("SELECT count(*) FROM e3.reference WHERE intent_id=9;")
            == "0",
            "E3_ABORT_NOT_ROLLED_BACK",
        )
        writer = client()
        require(
            final(writer, 9) == "COMMITTED" and final(writer, 9) == "REPLAY",
            "E3_ABORT_RECOVERY",
        )
        check()
        rows.append(
            {
                "case": "owned_backend_abort_rollback",
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
        start = time.monotonic()
        writer.query("BEGIN;")
        require(final(writer, 10) == "COMMITTED", "E3_COMMIT_PREPARE")
        writer.lost_commit_response()
        wait_for(
            observer,
            "SELECT EXISTS(SELECT 1 FROM e3.reference WHERE intent_id=10);",
            deadline,
        )
        writer.close()
        writer = client()
        require(
            final(writer, 10) == "REPLAY" and final(writer, 10) == "REPLAY",
            "E3_UNKNOWN_COMMIT_REPLAY",
        )
        check()
        rows.append(
            {
                "case": "unknown_commit_reconciliation",
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
        require(
            observer.scalar("SELECT count(*) FROM e3.reference;") == "9",
            "E3_REFERENCE_COUNT",
        )
        report.update(
            reference_count=9,
            database_version=observer.scalar("SHOW server_version;"),
            fault_scope="synthetic EIO / owned clients and backend only; no service outage",
        )
        return report


def scenario(deadline, ledger, evidence):
    import e3_controller
    import runtime_e0b as pg

    record = pg.ROOT / ledger["run_id"] / "evidence.json"
    report = {"trials": []}
    evidence["scenario"] = report
    database = "wb_lab_" + ledger["run_id"]

    def factory(end):
        return Session(
            [
                "docker",
                "--host",
                f"unix://{pg.SOCKET}",
                "container",
                "exec",
                "-i",
                ledger["container_id"],
                "psql",
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-h",
                "/var/run/postgresql",
                "-U",
                "wb_bootstrap",
                "-d",
                database,
            ],
            end,
        )

    with ExitStack() as stack:
        setup = factory(deadline)
        stack.callback(setup.close)
        setup.query("SET statement_timeout='2500ms'; SET lock_timeout='1000ms';")
        schema(setup)  # Intent committed before any staged file is written.
        setup.close()
        storage = e3_controller.run(deadline, ledger, evidence, record)
        report["controller_metrics"] = storage["metrics"]
        root = (
            Path(ledger["volumes"]["media"]["identity"]["Mountpoint"])
            / "e3-work"
            / "objects"
        )
        result = run_sql(
            factory,
            deadline,
            storage,
            lambda: file_state(root),
            prepared=True,
            report=report,
        )
        # PG counters collected under the same deadline. Each counter reports absence explicitly.
        pg_metrics = pg.checked(
            deadline,
            evidence["operations"],
            "container",
            "exec",
            ledger["container_id"],
            "/bin/sh",
            "-ec",
            "for n in memory.peak cpu.stat io.stat; do if test -f /sys/fs/cgroup/$n; then echo $n; head -c 2048 /sys/fs/cgroup/$n; else echo NOT_AVAILABLE; fi; done",
        )
        require(len(pg_metrics) <= 6500, "E3_PG_METRICS_BUDGET")
        result["postgres_cgroup_counters"] = pg_metrics
        return result


def cleanup_tree(ledger):
    """No recursive deletion: unknown objects prevent volume removal after writers stop."""
    volume = ledger["volumes"]["media"]
    root = Path(volume["identity"]["Mountpoint"])
    require(root.resolve(strict=True) == root, "E3_CLEANUP_VOLUME_PATH")
    rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        dev = os.fstat(rootfd).st_dev
        require(
            f"{os.major(dev)}:{os.minor(dev)}" == ledger["media_device"],
            "E3_CLEANUP_DEVICE",
        )
        require(
            set(os.listdir(rootfd)) <= {"e0b.sentinel", "e3-work"},
            "E3_CLEANUP_UNKNOWN_ROOT",
        )

        def walk(fd, depth):
            names = set(os.listdir(fd))
            allowed = (
                {"objects"}
                if depth == 0
                else {"stage", "final"}
                if depth == 1
                else {
                    f"object_{n}{suffix}"
                    for n in range(1, 8)
                    for suffix in ("", ".retry")
                }
                if depth == 2
                else {f"object_{n}" for n in range(1, 11)} | {"foreign"}
            )
            require(names <= allowed, "E3_CLEANUP_UNKNOWN_OBJECT")
            for name in names:
                child = os.open(
                    name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd
                )
                try:
                    meta = os.fstat(child)
                    require(
                        meta.st_uid == 65532 and meta.st_dev == os.fstat(rootfd).st_dev,
                        "E3_CLEANUP_OWNER_OR_DEVICE",
                    )
                    if depth < 2:
                        require(stat.S_ISDIR(meta.st_mode), "E3_CLEANUP_DIRECTORY")
                        if depth == 1:
                            walk(child, 2 if name == "stage" else 3)
                        else:
                            walk(child, 1)
                    else:
                        require(
                            stat.S_ISREG(meta.st_mode) and meta.st_size <= len(PAYLOAD),
                            "E3_CLEANUP_FILE",
                        )
                finally:
                    os.close(child)

        if "e3-work" in os.listdir(rootfd):
            fd = os.open(
                "e3-work", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=rootfd
            )
            try:
                require(os.fstat(fd).st_uid == 65532, "E3_CLEANUP_WORK_OWNER")
                walk(fd, 0)
            finally:
                os.close(fd)
    finally:
        os.close(rootfd)
