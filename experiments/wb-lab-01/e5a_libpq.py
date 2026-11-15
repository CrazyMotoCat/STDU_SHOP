"""Deadline-bounded libpq exchange with attestation of its actual Unix socket."""

import ctypes as c
import os
import select
import socket
import struct
import time
from dataclasses import dataclass

from preflight import Blocked, require
from runtime_e5a import process_start


class ConnectionLost(Blocked):
    """Connection lost before the SQL outcome could be observed."""


@dataclass(frozen=True)
class Peer:
    pid: int
    start: int


def attest_peer(fd, expected, *, proc=None):
    from pathlib import Path

    root = Path("/proc") if proc is None else proc
    require(fd >= 0 and expected.pid > 0 and expected.start > 0, "E5A_PG_PEER_IDENTITY")
    size = struct.calcsize("3i")
    with socket.socket(fileno=os.dup(fd)) as connection:
        require(connection.family == socket.AF_UNIX, "E5A_PG_PEER_FAMILY")
        pid, uid, gid = struct.unpack(
            "3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size)
        )
        require(
            (pid, uid, gid) == (expected.pid, 999, 999)
            and process_start(root / str(pid), pid) == expected.start,
            "E5A_PG_PEER_IDENTITY",
        )
        info = os.fstat(connection.fileno())
        return info.st_dev, info.st_ino


def load_libpq():
    try:
        lib = c.CDLL("libpq.so.5")
    except OSError as error:
        raise Blocked("E5A_LIBPQ_UNAVAILABLE") from error
    signatures = {
        "PQconnectStart": (c.c_void_p, c.c_char_p),
        "PQconnectPoll": (c.c_int, c.c_void_p),
        "PQstatus": (c.c_int, c.c_void_p),
        "PQsocket": (c.c_int, c.c_void_p),
        "PQsetnonblocking": (c.c_int, c.c_void_p, c.c_int),
        "PQsendQuery": (c.c_int, c.c_void_p, c.c_char_p),
        "PQflush": (c.c_int, c.c_void_p),
        "PQconsumeInput": (c.c_int, c.c_void_p),
        "PQisBusy": (c.c_int, c.c_void_p),
        "PQgetResult": (c.c_void_p, c.c_void_p),
        "PQresultStatus": (c.c_int, c.c_void_p),
        "PQntuples": (c.c_int, c.c_void_p),
        "PQnfields": (c.c_int, c.c_void_p),
        "PQgetlength": (c.c_int, c.c_void_p, c.c_int, c.c_int),
        "PQgetisnull": (c.c_int, c.c_void_p, c.c_int, c.c_int),
        "PQgetvalue": (c.c_void_p, c.c_void_p, c.c_int, c.c_int),
        "PQclear": (None, c.c_void_p),
        "PQfinish": (None, c.c_void_p),
    }
    for name, (result, *args) in signatures.items():
        function = getattr(lib, name)
        function.restype, function.argtypes = result, args
    return lib


def exchange(
    directory, identity, expected, sql, deadline, *, lib=None, attest=attest_peer
):
    """Only fixed, caller-authored SQL is accepted by this internal transport."""
    lib = load_libpq() if lib is None else lib

    def remaining():
        return deadline - time.monotonic()

    def wait(fd, *, write=False):
        timeout = remaining()
        require(fd >= 0 and timeout > 0, "E5A_SQL_DEADLINE")
        poll = select.poll()
        poll.register(fd, select.POLLOUT if write else select.POLLIN)
        if not poll.poll(max(1, int(timeout * 1000))):
            raise ConnectionLost("E5A_PG_RESPONSE_TIMEOUT")
        require(remaining() > 0, "E5A_SQL_DEADLINE")

    require(remaining() > 0, "E5A_SQL_DEADLINE")
    require(
        not any(name.startswith("PG") for name in os.environ),
        "E5A_LIBPQ_AMBIENT_CONFIGURATION",
    )
    identity.validate(identity.run)
    dsn = (
        f"host=/proc/self/fd/{directory} port=5432 dbname={identity.name} "
        "user=wb_bootstrap sslmode=disable gssencmode=disable "
        "require_auth=none passfile=/dev/null"
    )
    conn = lib.PQconnectStart(dsn.encode("ascii"))
    require(bool(conn), "E5A_LIBPQ_CONNECT")
    try:
        while True:
            require(remaining() > 0, "E5A_SQL_DEADLINE")
            stage = lib.PQconnectPoll(conn)
            if stage == 3:  # PGRES_POLLING_OK
                break
            require(stage in (1, 2), "E5A_LIBPQ_CONNECT")
            wait(lib.PQsocket(conn), write=stage == 2)
        require(lib.PQstatus(conn) == 0, "E5A_LIBPQ_CONNECT")
        fd = lib.PQsocket(conn)
        proof = attest(fd, expected)

        def pinned():
            require(
                lib.PQsocket(conn) == fd and attest(fd, expected) == proof,
                "E5A_PG_CONNECTED_PEER_CHANGED",
            )

        require(lib.PQsetnonblocking(conn, 1) == 0, "E5A_LIBPQ_NONBLOCKING")
        pinned()
        require(remaining() > 0, "E5A_SQL_DEADLINE")
        if lib.PQsendQuery(conn, sql.encode("ascii")) != 1:
            raise ConnectionLost("E5A_PG_SEND_FAILED")
        while True:
            flushed = lib.PQflush(conn)
            if flushed == 0:
                break
            if flushed != 1:
                raise ConnectionLost("E5A_PG_SEND_FAILED")
            wait(fd, write=True)
        rows = []
        while True:
            require(remaining() > 0, "E5A_SQL_DEADLINE")
            while lib.PQisBusy(conn):
                wait(fd)
                if lib.PQconsumeInput(conn) != 1:
                    raise ConnectionLost("E5A_PG_CONNECTION_LOST")
            result = lib.PQgetResult(conn)
            if not result:
                break
            try:
                status = lib.PQresultStatus(result)
                if lib.PQstatus(conn) != 0:
                    raise ConnectionLost("E5A_PG_CONNECTION_LOST")
                require(status in (1, 2), "E5A_SQL_FAILED")
                if status == 2:
                    count = lib.PQntuples(result)
                    require(
                        lib.PQnfields(result) == 1 and len(rows) + count <= 8,
                        "E5A_SQL_RESULT_SHAPE",
                    )
                    for row in range(count):
                        size = lib.PQgetlength(result, row, 0)
                        require(
                            0 <= size <= 128 and not lib.PQgetisnull(result, row, 0),
                            "E5A_SQL_RESULT_SHAPE",
                        )
                        rows.append(
                            c.string_at(lib.PQgetvalue(result, row, 0), size).decode(
                                "ascii"
                            )
                        )
            finally:
                lib.PQclear(result)
        if lib.PQstatus(conn) != 0:
            raise ConnectionLost("E5A_PG_CONNECTION_LOST")
        pinned()
        return rows
    finally:
        lib.PQfinish(conn)
