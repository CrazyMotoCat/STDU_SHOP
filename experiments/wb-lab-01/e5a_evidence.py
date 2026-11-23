"""Exclusive publication of a bounded evidence record inside an owned run directory."""

import hashlib
import json
import os
import re
import stat
from uuid import uuid4

from e5_plan import host_margins
from preflight import require
from runtime_e5a import (
    MAX_SAMPLE_BYTES,
    MAX_SAMPLES,
    PHASE_LIMITS,
    validate_observation,
)


def validate_campaign(evidence):
    """Validate the sealed offline campaign envelope before writing any files."""
    require(
        evidence.keys()
        == {"revision", "run_id", "daemon", "images", "resources", "campaign"},
        "E5A_EVIDENCE_FIELDS",
    )
    require(
        re.fullmatch(r"[a-f0-9]{40}", evidence["revision"])
        and re.fullmatch(r"[a-f0-9]{32}", evidence["run_id"])
        and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", evidence["daemon"]),
        "E5A_EVIDENCE_IDENTITY",
    )
    images = evidence["images"]
    require(
        images.keys() == {"controller", "postgres"}
        and all(
            re.fullmatch(r"sha256:[a-f0-9]{64}", value) for value in images.values()
        ),
        "E5A_EVIDENCE_IMAGES",
    )
    resources = evidence["resources"]
    require(resources.keys() <= PHASE_LIMITS.keys(), "E5A_EVIDENCE_RESOURCES")
    for phase, ids in resources.items():
        require(
            ids.keys() <= PHASE_LIMITS[phase].keys()
            and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in ids.values())
            and len(set(ids.values())) == len(ids),
            "E5A_EVIDENCE_RESOURCES",
        )
    result = evidence["campaign"]
    required = {"status", "reason", "cleanup", "watchdog", "phases", "samples"}
    require(
        required
        <= result.keys()
        <= required | {"foreign_inventory", "host_margins", "watchdog_reason"},
        "E5A_EVIDENCE_RESULT",
    )
    status, reason = result["status"], result["reason"]
    require(
        (
            status == "E5A_BLOCKED"
            and isinstance(reason, str)
            and re.fullmatch(r"[A-Za-z0-9_]{1,64}", reason)
        )
        or (status == "E5A_CHECKS_PASS" and reason is None),
        "E5A_EVIDENCE_RESULT",
    )
    require(
        result["cleanup"] in {"NOT_RUN", "CONFIRMED", "CLEANUP_UNCONFIRMED"}
        and result["watchdog"] in {"NOT_STARTED", "STOPPED", "FAILED"}
        and result.get("foreign_inventory") in {None, "PRESERVED"},
        "E5A_EVIDENCE_CLEANUP",
    )
    if "watchdog_reason" in result:
        watchdog_reason = result["watchdog_reason"]
        require(
            status == "E5A_BLOCKED"
            and result["watchdog"] == "FAILED"
            and isinstance(watchdog_reason, str)
            and re.fullmatch(
                r"E5A_ENGINE_TIMEOUT_(DAEMON|IMAGE|CONTAINER|VOLUME|NETWORK|OTHER)_"
                r"(GET|POST|DELETE|CREATE|START|STOP|KILL|INSPECT|STATS|LIST|OTHER)",
                watchdog_reason,
            ),
            "E5A_EVIDENCE_WATCHDOG_REASON",
        )
    phases = result["phases"]
    require(
        phases.keys() <= PHASE_LIMITS.keys(),
        "E5A_EVIDENCE_PHASES",
    )
    for phase, report in phases.items():
        if phase in {"baseline", "recovery"}:
            require(report == {"status": "COMPLETE"}, "E5A_EVIDENCE_PHASES")
            continue
        require(
            report.keys() == {"status", "fsync_us", "sql"}
            and report["status"] == "COMPLETE"
            and isinstance(report["fsync_us"], list)
            and len(report["fsync_us"]) == 3
            and all(
                type(value) is int and 0 <= value < 30_000_000
                for value in report["fsync_us"]
            ),
            "E5A_EVIDENCE_WORKLOAD",
        )
        sql = report["sql"]
        if phase == "controller":
            require(sql == {}, "E5A_EVIDENCE_WORKLOAD")
        else:
            require(
                sql.keys() == {"transactions", "row_lock"}
                and len(sql["transactions"]) == 3,
                "E5A_EVIDENCE_SQL",
            )
            for index, row in enumerate(sql["transactions"], 1):
                require(
                    row.keys() == {"sequence", "outcome", "duration_us"}
                    and type(row["sequence"]) is int
                    and row["sequence"] == index
                    and row["outcome"] in {"COMMITTED", "COMMITTED_RECONCILED"}
                    and type(row["duration_us"]) is int
                    and 0 <= row["duration_us"] < 30_000_000,
                    "E5A_EVIDENCE_SQL",
                )
            lock = sql["row_lock"]
            require(
                lock.keys() == {"lock_timeout", "duration_us"}
                and lock["lock_timeout"] is True
                and type(lock["duration_us"]) is int
                and 900000 <= lock["duration_us"] <= 2500000,
                "E5A_EVIDENCE_SQL",
            )
    samples = result["samples"]
    require(samples.keys() <= PHASE_LIMITS.keys(), "E5A_EVIDENCE_PHASES")
    previous = None
    identities = {}
    for phase in PHASE_LIMITS:
        phase_previous = None
        for row in samples.get(phase, ()):
            tick = row["monotonic_ms"]
            require(
                type(tick) is int
                and tick >= 0
                and (previous is None or tick >= previous),
                "E5A_EVIDENCE_TIME",
            )
            running = set(row["containers"])
            require(
                running <= resources.get(phase, {}).keys(), "E5A_EVIDENCE_RESOURCES"
            )
            require(
                all(
                    counters["container_id"] == resources[phase][role]
                    for role, counters in row["containers"].items()
                ),
                "E5A_EVIDENCE_RESOURCES",
            )
            validate_observation(
                row,
                phase=phase,
                now=tick,
                previous=phase_previous,
                daemon=evidence["daemon"],
                limits=PHASE_LIMITS[phase],
                running=running,
            )
            for role in running:
                cid = row["containers"][role]["container_id"]
                process = row["processes"][role]
                anchor = (process["pid"], process["start_before"])
                require(
                    cid not in identities or identities[cid] == anchor,
                    "E5A_EVIDENCE_PROCESS_CHANGED",
                )
                identities[cid] = anchor
            previous = phase_previous = tick
    margins = result.get("host_margins")
    if margins is not None:
        require(
            margins.keys()
            == {
                "minimum_available_bytes",
                "memory_margin_bytes",
                "minimum_disk_free_bytes",
                "disk_margin_bytes",
            }
            and all(type(value) is int and value >= 0 for value in margins.values()),
            "E5A_EVIDENCE_MARGINS",
        )
    if status == "E5A_CHECKS_PASS":
        require(
            phases.keys() == samples.keys() == PHASE_LIMITS.keys()
            and all(samples.values())
            and result["cleanup"] == "CONFIRMED"
            and result["watchdog"] == "STOPPED"
            and result.get("foreign_inventory") == "PRESERVED"
            and margins is not None,
            "E5A_EVIDENCE_PASS_UNPROVEN",
        )
        streams = {}
        for phase, rows in samples.items():
            start = rows[0]["monotonic_ms"]
            require(
                rows[-1]["containers"].keys() == PHASE_LIMITS[phase].keys(),
                "E5A_EVIDENCE_RESOURCE_COVERAGE",
            )
            streams[phase] = [
                (row["monotonic_ms"] - start, row["memory_available"], row["disk_free"])
                for row in rows
            ]
        require(host_margins(streams) == margins, "E5A_EVIDENCE_MARGINS")
    return samples


def encode(data):
    return json.dumps(
        data, allow_nan=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def publish(directory_fd, evidence):
    directory = os.fstat(directory_fd)
    require(
        stat.S_ISDIR(directory.st_mode)
        and directory.st_uid == os.geteuid()
        and stat.S_IMODE(directory.st_mode) == 0o700,
        "E5A_EVIDENCE_DIRECTORY",
    )
    samples = validate_campaign(evidence)
    require(
        all(
            isinstance(rows, list) and len(rows) <= MAX_SAMPLES
            for rows in samples.values()
        )
        and len(encode(samples)) <= MAX_SAMPLE_BYTES,
        "E5A_SAMPLE_BUDGET",
    )
    payload = encode(evidence) + b"\n"
    require(len(payload) <= MAX_SAMPLE_BYTES + 65536, "E5A_EVIDENCE_BUDGET")
    temporary = f".evidence-{uuid4().hex}.tmp"
    fd = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(
            temporary,
            "evidence.json",
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
    finally:
        os.unlink(temporary, dir_fd=directory_fd)
        os.fsync(directory_fd)
    fd = os.open("evidence.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
    with os.fdopen(fd, "rb") as stream:
        require(stream.read(len(payload) + 1) == payload, "E5A_EVIDENCE_READBACK")
    return hashlib.sha256(payload).hexdigest()
