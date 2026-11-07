"""Prepared E0b only. Execution requires a separate explicit owner decision."""

import hashlib
import json
import multiprocessing
import os
import shutil
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

import runtime_e0a as base
from preflight import (
    LABEL,
    ROOT,
    SOCKET,
    Blocked,
    collect,
    mem_available,
    mount,
    require,
)

APPROVAL = "OWNER_E0B_RUNTIME_APPROVED"
IMAGE = "docker.io/library/postgres@sha256:d628bc2cef336ab1f527cd6e8de5f04827c069e5f24153b5e99d9bf64e5ff925"
CAPS = {"inspect": 3, "ls": 3, "create": 5, "start": 5, "exec": 5}
PG_LIMITS = {
    "memory.max": "201326592",
    "memory.swap.max": "0",
    "cpu.max": "50000 100000",
    "pids.max": "32",
}
ERRORS = (
    Blocked,
    OSError,
    ValueError,
    KeyError,
    TypeError,
    subprocess.TimeoutExpired,
    KeyboardInterrupt,
)
START = """set -eu
ulimit -f 65536
initdb -D /var/lib/postgresql/wbdata -U wb_bootstrap --locale=C --encoding=UTF8 --auth-local=trust --auth-host=reject --no-instructions >/dev/null
exec postgres -D /var/lib/postgresql/wbdata -c listen_addresses= -c unix_socket_directories=/var/run/postgresql -c max_connections=6 -c shared_buffers=24MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_wal_size=32MB -c min_wal_size=32MB -c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000
"""


def cli(deadline, trace, *args, input_text=None):
    """No arbitrary output/arguments in evidence. Late success never counts."""
    started = time.monotonic()
    remaining = deadline - started
    require(
        args[0] in {"container", "volume", "image"} and args[1] in CAPS, "E0B_OPERATION"
    )
    budget = min(remaining, CAPS[args[1]])
    require(budget > 0 and len(trace) < 56, "E0B_DEADLINE_OR_TRACE_LIMIT")
    row = {
        "operation": ".".join(args[:2]),
        "elapsed_ms": 0,
        "timeout_budget_ms": round(budget * 1000),
        "error_type": None,
    }
    trace.append(row)
    try:
        result = subprocess.run(
            ["docker", "--host", f"unix://{SOCKET}", *args],
            input=input_text,
            text=True,
            capture_output=True,
            check=False,
            timeout=budget,
        )
        require(
            time.monotonic() - started < budget and time.monotonic() < deadline,
            "E0B_LATE_COMMAND",
        )
        require(
            len(result.stdout) <= 65536 and len(result.stderr) <= 65536,
            "E0B_OUTPUT_BUDGET",
        )
        if result.returncode:
            row["error_type"] = "NonzeroExit"
        return result
    except ERRORS as error:
        row["error_type"] = type(error).__name__
        raise
    finally:
        row["elapsed_ms"] = round((time.monotonic() - started) * 1000)


def checked(deadline, trace, *args, input_text=None):
    result = cli(deadline, trace, *args, input_text=input_text)
    require(result.returncode == 0, "E0B_DOCKER_COMMAND_FAILED")
    return result.stdout.strip()


def validate_image(item):
    digest = IMAGE.split("@", 1)[1]
    refs = {
        f"{repo}@{digest}"
        for repo in (
            "postgres",
            "library/postgres",
            "docker.io/postgres",
            "docker.io/library/postgres",
            "index.docker.io/postgres",
            "index.docker.io/library/postgres",
        )
    }
    require(
        item.get("Os") == "linux"
        and item.get("Architecture") == "arm64"
        and item.get("Variant", "") in ("", "v8")
        and isinstance(item.get("RepoDigests"), list)
        and any(ref in refs for ref in item["RepoDigests"])
        and isinstance(item.get("Id"), str)
        and item["Id"].startswith("sha256:")
        and base.HEX_ID.fullmatch(item["Id"][7:]),
        "E0B_LOCAL_IMAGE_ID",
    )
    return item["Id"]


def volume_source(item, host, run_id, name):
    base.owned_volume(item, name, run_id)
    expected = Path(host["docker_root"]) / "volumes" / name / "_data"
    require(
        item["Mountpoint"] == str(expected)
        and expected.resolve(strict=True) == expected,
        "E0B_VOLUME_SOURCE",
    )
    require(
        mount(expected)["maj:min"] == host["mounts"]["root"]["maj:min"],
        "E0B_VOLUME_DEVICE",
    )
    require(mount(expected)["fstype"] == "ext4", "E0B_VOLUME_FS")
    return expected


def seed_volume(source, sentinel, pg):
    """Only a just-created, inspected, empty owned directory. Never recursive chown."""
    fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(not os.listdir(fd), "E0B_VOLUME_NOT_EMPTY")
        file_fd = os.open(
            "e0b.sentinel",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o444,
            dir_fd=fd,
        )
        try:
            os.write(file_fd, sentinel.encode("ascii"))
            os.fsync(file_fd)
        finally:
            os.close(file_fd)
        if pg:
            os.fchown(fd, 999, 999)
            os.fchmod(fd, 0o700)
        os.fsync(fd)
    finally:
        os.close(fd)


def sentinel_hash(source):
    fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        file_fd = os.open("e0b.sentinel", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            meta = os.fstat(file_fd)
            require(
                stat.S_ISREG(meta.st_mode) and meta.st_size == 64, "E0B_SENTINEL_FILE"
            )
            return hashlib.sha256(os.read(file_fd, 65)).hexdigest()
        finally:
            os.close(file_fd)
    finally:
        os.close(fd)


def validate_container(item, ledger, image_id, sources):
    base.owned_container(item, ledger["name"], ledger["run_id"], ledger["container_id"])
    h = item["HostConfig"]
    require(
        item["Image"] == image_id and item["Config"]["User"] == "999:999",
        "E0B_CONTAINER_IDENTITY",
    )
    require(
        h["NetworkMode"] == "none"
        and not h["PortBindings"]
        and not h["PublishAllPorts"]
        and not item["NetworkSettings"]["Ports"]
        and not h["Privileged"]
        and h["ReadonlyRootfs"]
        and h["CapDrop"] == ["ALL"]
        and not h.get("CapAdd")
        and h["SecurityOpt"] == ["no-new-privileges"]
        and h["CgroupnsMode"] == "private"
        and h["IpcMode"] == "private"
        and h["PidMode"] == ""
        and h["LogConfig"]["Type"] == "none",
        "E0B_CONTAINER_ISOLATION",
    )
    require(
        (h["Memory"], h["MemorySwap"], h["NanoCpus"], h["PidsLimit"])
        == (192 * 1024**2, 192 * 1024**2, 500_000_000, 32),
        "E0B_CONFIG_LIMITS",
    )
    require(
        h["ShmSize"] == 16 * 1024**2
        and h["Tmpfs"]
        == {
            "/tmp": "size=8m,mode=1777,nosuid,nodev,noexec",
            "/var/run/postgresql": "size=2m,mode=1777,nosuid,nodev,noexec",
        },
        "E0B_TMPFS_LIMITS",
    )
    attached = {m["Destination"]: m for m in item["Mounts"] if m["Type"] == "volume"}
    require(set(attached) == {"/var/lib/postgresql", "/media"}, "E0B_MOUNT_SET")
    for destination, role, writable in (
        ("/var/lib/postgresql", "pg", True),
        ("/media", "media", False),
    ):
        m = attached[destination]
        require(
            m["Name"] == ledger["volumes"][role]["name"]
            and m["Source"] == str(sources[role])
            and m["RW"] is writable,
            "E0B_MOUNT_IDENTITY",
        )
    require(
        all(m["Type"] in {"volume", "tmpfs"} for m in item["Mounts"]),
        "E0B_FOREIGN_MOUNT",
    )


def guard(deadline, ledger, stop, ready):
    """Independent observer; fail-closed removal only by validated exact identity."""
    try:
        while not stop.is_set():
            require(time.monotonic() < deadline, "E0B_WATCHDOG_DEADLINE")
            base.thresholds(mem_available(), shutil.disk_usage(ROOT).free)
            item = base.owned_container(
                base.inspect(deadline, "container", ledger["container_id"]),
                ledger["name"],
                ledger["run_id"],
                ledger["container_id"],
            )
            require(
                item["State"]["Status"] in {"created", "running"}
                and not item["State"]["OOMKilled"],
                "E0B_WATCHDOG_STATE",
            )
            for role, volume in ledger["volumes"].items():
                observed = base.owned_volume(
                    base.inspect(deadline, "volume", volume["name"]),
                    volume["name"],
                    ledger["run_id"],
                )
                require(
                    all(
                        observed[k] == volume["identity"][k]
                        for k in ("CreatedAt", "Mountpoint")
                    ),
                    "E0B_VOLUME_CHANGED",
                )
                start = time.monotonic()
                remaining = min(1, deadline - start)
                require(remaining > 0, "E0B_WATCHDOG_DEADLINE")
                du = subprocess.run(
                    ["du", "-s", "-B1", "--", observed["Mountpoint"]],
                    capture_output=True,
                    text=True,
                    timeout=remaining,
                    check=True,
                )
                require(time.monotonic() - start < remaining, "E0B_DU_LATE")
                fields = du.stdout.split()
                require(bool(fields), "E0B_DU_RESPONSE")
                size = int(fields[0])
                require(
                    size <= (128 * 1024**2 if role == "pg" else 1024**2),
                    "E0B_WRITE_WATERMARK",
                )
            ready.set()
            stop.wait(0.25)
    except (*ERRORS, subprocess.CalledProcessError):
        try:
            end = time.monotonic() + 4
            base.owned_container(
                base.inspect(end, "container", ledger["container_id"]),
                ledger["name"],
                ledger["run_id"],
                ledger["container_id"],
            )
            base.checked(end, "container", "rm", "--force", ledger["container_id"])
            require(
                base.inspect(end, "container", ledger["container_id"]) is None,
                "E0B_ABORT_UNCONFIRMED",
            )
        except ERRORS:
            sys.exit(2)
        sys.exit(1)


def ready(deadline, trace, cid, stop):
    # 32 records fit the bounded trace; the original workload deadline remains authoritative.
    for _ in range(32):
        require(not stop.is_set(), "E0B_WATCHDOG_STOP")
        result = cli(
            deadline,
            trace,
            "container",
            "exec",
            cid,
            "pg_isready",
            "-q",
            "-h",
            "/var/run/postgresql",
            "-U",
            "wb_bootstrap",
            "-d",
            "postgres",
        )
        require(result.returncode in {0, 1, 2}, "E0B_READINESS_CLI_FAILED")
        if result.returncode == 0:
            return
        require(deadline - time.monotonic() > 0.5, "E0B_READY_DEADLINE")
        stop.wait(0.5)
    raise Blocked("E0B_NOT_READY")


def sql(deadline, trace, cid, database, text, user="wb_bootstrap"):
    return checked(
        deadline,
        trace,
        "container",
        "exec",
        "-i",
        cid,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "/var/run/postgresql",
        "-U",
        user,
        "-d",
        database,
        "-At",
        input_text=text,
    )


def verify_database(deadline, trace, ledger):
    run_id = ledger["run_id"]
    require(
        len(run_id) == 32 and all(c in "0123456789abcdef" for c in run_id),
        "E0B_SQL_IDENTITY",
    )
    cid, db = ledger["container_id"], "wb_lab_" + run_id
    sql(
        deadline,
        trace,
        cid,
        "postgres",
        f"CREATE DATABASE {db};\n"
        "CREATE ROLE wb_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 1;\n",
    )
    sql(
        deadline,
        trace,
        cid,
        db,
        "BEGIN; CREATE SCHEMA e0b AUTHORIZATION wb_probe; "
        "REVOKE ALL ON SCHEMA public FROM PUBLIC; SET LOCAL ROLE wb_probe; "
        "CREATE TABLE e0b.sentinel (run_id text PRIMARY KEY, token text NOT NULL); "
        f"INSERT INTO e0b.sentinel VALUES ('{run_id}', '{ledger['db_sentinel']}'); COMMIT;",
    )
    result = json.loads(
        sql(
            deadline,
            trace,
            cid,
            db,
            "SELECT json_build_object('database',current_database(),'data_directory',current_setting('data_directory'),"
            "'system_identifier',(SELECT system_identifier::text FROM pg_control_system()));",
        )
    )
    require(
        result["database"] == db
        and result["data_directory"] == "/var/lib/postgresql/wbdata"
        and result["system_identifier"].isdigit(),
        "E0B_DATABASE_IDENTITY",
    )
    row = sql(
        deadline,
        trace,
        cid,
        db,
        "SELECT current_user||':'||run_id||':'||token FROM e0b.sentinel;",
        user="wb_probe",
    )
    require(
        row == f"wb_probe:{run_id}:{ledger['db_sentinel']}", "E0B_DATABASE_SENTINEL"
    )
    flags = sql(
        deadline,
        trace,
        cid,
        db,
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls "
        "FROM pg_roles WHERE rolname=current_user;",
        user="wb_probe",
    )
    require(flags == "f", "E0B_ROLE_PRIVILEGES")
    return result


def cleanup(deadline, ledger):
    # Remove the only writer first. Never remove a volume with unconfirmed writer state.
    base.cleanup(deadline, {**ledger, "volume_create_requested": False})
    for volume in ledger["volumes"].values():
        base.cleanup(
            deadline,
            {
                "name": volume["name"],
                "run_id": ledger["run_id"],
                "container_create_requested": False,
                "volume_create_requested": volume["requested"],
                **({"volume": volume["identity"]} if "identity" in volume else {}),
            },
        )


def run(host):
    run_id = uuid.uuid4().hex
    name = "wb-lab-01-e0b-" + run_id
    path = ROOT / run_id
    path.mkdir(mode=0o700)
    ledger = {
        "run_id": run_id,
        "name": name,
        "container_create_requested": False,
        "db_sentinel": uuid.uuid4().hex,
        "volumes": {
            role: {"name": name + "-" + role, "requested": False}
            for role in ("pg", "media")
        },
    }
    evidence = {
        "status": "NOT_RUN",
        "ledger": ledger,
        "operations": [],
        "cleanup": "NOT_RUN",
        "E1_to_E5": "NOT_RUN",
        "VDS_equivalence": "NOT_PROVEN",
    }
    record = path / "evidence.json"
    deadline = time.monotonic() + 30
    watcher, before = None, None
    ctx = multiprocessing.get_context("fork")
    stop, watching = ctx.Event(), ctx.Event()
    try:
        before = base.snapshot(deadline)
        require(
            base.inspect(deadline, "container", name) is None
            and all(
                v["name"] not in before["volume"] for v in ledger["volumes"].values()
            ),
            "E0B_NAME_COLLISION",
        )
        [image] = json.loads(
            checked(deadline, evidence["operations"], "image", "inspect", IMAGE)
        )
        image_id = validate_image(image)
        ledger["image_id"] = image_id
        sources, hashes = {}, {}
        for role, volume in ledger["volumes"].items():
            base.thresholds(mem_available(), shutil.disk_usage(ROOT).free)
            volume["requested"] = True
            base.save(record, evidence)
            require(
                checked(
                    deadline,
                    evidence["operations"],
                    "volume",
                    "create",
                    "--driver",
                    "local",
                    "--label",
                    f"{LABEL}={run_id}",
                    volume["name"],
                )
                == volume["name"],
                "E0B_VOLUME_CREATE_ID",
            )
            item = base.inspect(deadline, "volume", volume["name"])
            source = volume_source(item, host, run_id, volume["name"])
            volume["identity"] = {k: item[k] for k in ("CreatedAt", "Mountpoint")}
            base.save(record, evidence)
            token = uuid.uuid4().hex + uuid.uuid4().hex
            seed_volume(source, token, role == "pg")
            sources[role], hashes[role] = (
                source,
                hashlib.sha256(token.encode()).hexdigest(),
            )
        ledger["container_create_requested"] = True
        base.save(record, evidence)
        cid = checked(
            deadline,
            evidence["operations"],
            "container",
            "create",
            "--pull=never",
            "--name",
            name,
            "--label",
            f"{LABEL}={run_id}",
            "--user=999:999",
            "--network=none",
            "--ipc=private",
            "--cgroupns=private",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--log-driver=none",
            "--memory=192m",
            "--memory-swap=192m",
            "--cpus=0.5",
            "--pids-limit=32",
            "--shm-size=16m",
            "--tmpfs",
            "/tmp:size=8m,mode=1777,nosuid,nodev,noexec",
            "--tmpfs",
            "/var/run/postgresql:size=2m,mode=1777,nosuid,nodev,noexec",
            "--mount",
            f"type=volume,source={ledger['volumes']['pg']['name']},target=/var/lib/postgresql,volume-nocopy",
            "--mount",
            f"type=volume,source={ledger['volumes']['media']['name']},target=/media,readonly,volume-nocopy",
            "--entrypoint",
            "/bin/sh",
            image_id,
            "-ec",
            START,
        )
        require(base.HEX_ID.fullmatch(cid), "E0B_CONTAINER_ID")
        ledger["container_id"] = cid
        base.save(record, evidence)
        validate_container(
            base.inspect(deadline, "container", cid), ledger, image_id, sources
        )
        watcher = ctx.Process(target=guard, args=(deadline, ledger, stop, watching))
        watcher.start()
        require(watching.wait(4) and watcher.is_alive(), "E0B_WATCHDOG_NOT_READY")
        checked(deadline, evidence["operations"], "container", "start", cid)
        ready(deadline, evidence["operations"], cid, stop)
        evidence["database"] = verify_database(deadline, evidence["operations"], ledger)
        limits = checked(
            deadline,
            evidence["operations"],
            "container",
            "exec",
            cid,
            "/bin/sh",
            "-ec",
            "for f in memory.max memory.swap.max cpu.max pids.max; do cat /sys/fs/cgroup/$f; done",
        ).splitlines()
        require(
            dict(zip(PG_LIMITS, limits, strict=True)) == PG_LIMITS, "E0B_ACTUAL_LIMITS"
        )
        require(
            all(sentinel_hash(sources[k]) == hashes[k] for k in hashes),
            "E0B_SENTINEL_CHANGED",
        )
        mounted = checked(
            deadline,
            evidence["operations"],
            "container",
            "exec",
            cid,
            "sha256sum",
            "/var/lib/postgresql/e0b.sentinel",
            "/media/e0b.sentinel",
        ).splitlines()
        require(
            mounted
            == [
                hashes["pg"] + "  /var/lib/postgresql/e0b.sentinel",
                hashes["media"] + "  /media/e0b.sentinel",
            ],
            "E0B_MOUNTED_SENTINELS",
        )
        require(
            checked(
                deadline,
                evidence["operations"],
                "container",
                "exec",
                cid,
                "ls",
                "-1",
                "/sys/class/net",
            )
            == "lo",
            "E0B_ACTUAL_NETWORK",
        )
        require(
            time.monotonic() < deadline and watcher.is_alive(),
            "E0B_END_DEADLINE_OR_WATCHDOG",
        )
        evidence["observed"] = {"limits": PG_LIMITS, "sentinel_hashes": hashes}
        final = base.owned_container(
            base.inspect(deadline, "container", cid), name, run_id, cid
        )
        require(
            final["State"]["Status"] == "running" and not final["State"]["OOMKilled"],
            "E0B_FINAL_STATE",
        )
        require(time.monotonic() < deadline, "E0B_FINAL_DEADLINE")
        evidence["status"] = "PROBE_PASS"
    except ERRORS as error:
        evidence.update(
            status="BLOCKED",
            reason=str(error) if isinstance(error, Blocked) else type(error).__name__,
        )
    finally:
        stop.set()
        end = time.monotonic() + 10
        try:
            if watcher is not None and watcher.pid is not None:
                watcher.join(min(4, max(0, end - time.monotonic())))
                require(not watcher.is_alive(), "E0B_WATCHDOG_STOP_UNCONFIRMED")
                if watcher.exitcode != 0:
                    evidence.update(
                        status="BLOCKED", reason="E0B_WATCHDOG_STOP_CONDITION"
                    )
            cleanup(end, ledger)
            evidence["cleanup"] = "CONFIRMED"
            if before is not None:
                after = base.snapshot(end)
                require(
                    all(before[k] <= after[k] for k in before),
                    "E0B_FOREIGN_INVENTORY_CHANGED",
                )
                evidence["foreign_inventory"] = "PRESERVED"
            if evidence["status"] == "PROBE_PASS":
                evidence["status"] = "E0B_RUNTIME_PASS"
        except ERRORS as error:
            evidence.update(
                status="BLOCKED",
                cleanup="CLEANUP_UNCONFIRMED",
                cleanup_reason=str(error)
                if isinstance(error, Blocked)
                else type(error).__name__,
            )
        base.save(record, evidence)
    return evidence


def main():
    require(
        sys.argv[1:] == [APPROVAL] and sys.platform == "linux" and os.geteuid() == 0,
        "OWNER_E0B_RUNTIME_APPROVAL_REQUIRED",
    )
    import fcntl

    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host = collect(base.DAEMON)
        meta, locked = ROOT.stat(), os.fstat(fd)
        require(
            (meta.st_dev, meta.st_ino) == (locked.st_dev, locked.st_ino),
            "E0B_ROOT_REPLACED",
        )
        result = run(host)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "E0B_RUNTIME_PASS" else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ERRORS as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "reason": str(error)
                    if isinstance(error, Blocked)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
