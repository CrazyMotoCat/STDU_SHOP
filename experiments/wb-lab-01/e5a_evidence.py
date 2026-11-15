"""Exclusive publication of a bounded evidence record inside an owned run directory."""

import hashlib
import json
import os
import stat
from uuid import uuid4

from preflight import require
from runtime_e5a import MAX_SAMPLE_BYTES, MAX_SAMPLES


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
    samples = evidence["samples"]
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
