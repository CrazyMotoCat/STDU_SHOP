"""Network-none canaries. All positive traffic stays on namespace loopback."""

import errno
import hashlib
import json
import os
import re
import selectors
import socket
import sys
import time
from pathlib import Path
from urllib.parse import quote_from_bytes

NEGATIVE = (
    ("ipv4_tcp", socket.AF_INET, socket.SOCK_STREAM, "192.0.2.1", 9),
    ("ipv6_tcp", socket.AF_INET6, socket.SOCK_STREAM, "2001:db8::1", 9),
    ("ipv4_udp", socket.AF_INET, socket.SOCK_DGRAM, "192.0.2.1", 9),
    ("ipv6_udp", socket.AF_INET6, socket.SOCK_DGRAM, "2001:db8::1", 9),
    ("dns_udp", socket.AF_INET, socket.SOCK_DGRAM, "192.0.2.53", 53),
)
DENIAL = {
    errno.ENETUNREACH,
    errno.EHOSTUNREACH,
    errno.EAFNOSUPPORT,
    errno.EPROTONOSUPPORT,
    errno.EADDRNOTAVAIL,
}

STAGES = {
    "isolation",
    "namespace",
    "positive_ipv4_tcp",
    "positive_ipv4_udp",
    "ipv4_tcp",
    "ipv6_tcp",
    "ipv4_udp",
    "ipv6_udp",
    "dns_udp",
    "metrics",
}
FAILURE_CODES = {
    "NON_LOOPBACK_INTERFACE",
    "IPV4_ROUTE",
    "IPV6_ROUTE",
    "UNEXPECTED_MOUNT",
    "MOUNTINFO_BUDGET",
    "MOUNTINFO_INVALID",
    "MEDIA_NOT_READ_ONLY",
    "POSITIVE_OBSERVER_TIMEOUT",
    "POSITIVE_OBSERVER_MISSING",
    "OBSERVER_EXIT",
    "OBSERVER_EXIT_TIMEOUT",
    "OBSERVER_CLEANUP_UNCONFIRMED",
    "UNPROVEN_EGRESS_DENIAL",
    "EGRESS_NOT_DENIED",
    "ACTUAL_CONTROLLER_ISOLATION",
    "METRICS_BUDGET",
    "RESOURCE_ERROR",
    "PROBE_TIMEOUT",
    "OS_ERROR",
    "UNEXPECTED_EXCEPTION",
}
CURRENT_STAGE = "isolation"


def failure_code(error):
    if isinstance(error, OSError) and error.errno in {
        errno.ENOMEM,
        errno.EAGAIN,
        errno.EMFILE,
        errno.ENFILE,
    }:
        return "RESOURCE_ERROR"
    if isinstance(error, TimeoutError):
        return "PROBE_TIMEOUT"
    if isinstance(error, RuntimeError) and str(error) in FAILURE_CODES:
        return str(error)
    return "OS_ERROR" if isinstance(error, OSError) else "UNEXPECTED_EXCEPTION"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def positive(kind):
    nonce = os.urandom(16)
    # Independent observer process owns receiver; it sends only a digest to parent.
    with socket.socket(socket.AF_INET, kind) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.settimeout(0.5)
        if kind == socket.SOCK_STREAM:
            listener.listen(1)
        reader, writer = os.pipe()
        pid = os.fork()
        if pid == 0:
            try:
                os.close(reader)
                if kind == socket.SOCK_STREAM:
                    connection, _ = listener.accept()
                    with connection:
                        connection.settimeout(0.5)
                        data = connection.recv(64)
                else:
                    data, _ = listener.recvfrom(64)
                os.write(writer, hashlib.sha256(data).digest())
            finally:
                os._exit(0)
        os.close(writer)
        reaped = False
        try:
            with socket.socket(socket.AF_INET, kind) as sender:
                sender.settimeout(0.5)
                if kind == socket.SOCK_STREAM:
                    sender.connect(listener.getsockname())
                    sender.sendall(nonce)
                else:
                    sender.sendto(nonce, listener.getsockname())
            with selectors.DefaultSelector() as selector:
                selector.register(reader, selectors.EVENT_READ)
                need(selector.select(1), "POSITIVE_OBSERVER_TIMEOUT")
                need(
                    os.read(reader, 32) == hashlib.sha256(nonce).digest(),
                    "POSITIVE_OBSERVER_MISSING",
                )
            end = time.monotonic() + 1
            while time.monotonic() < end:
                found, status = os.waitpid(pid, os.WNOHANG)
                if found:
                    reaped = True
                    need(
                        os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0,
                        "OBSERVER_EXIT",
                    )
                    break
                time.sleep(0.001)
            need(reaped, "OBSERVER_EXIT_TIMEOUT")
        finally:
            if not reaped:
                import signal

                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                # Only this freshly forked PID; hard bound, never wait forever.
                end = time.monotonic() + 1
                while time.monotonic() < end:
                    if os.waitpid(pid, os.WNOHANG)[0]:
                        reaped = True
                        break
                    time.sleep(0.001)
                need(reaped, "OBSERVER_CLEANUP_UNCONFIRMED")
            os.close(reader)
    return {"observed": True, "scope": "namespace_loopback"}


def negative(family, kind, destination, port):
    try:
        with socket.socket(family, kind) as sock:
            sock.settimeout(0.25)
            if kind == socket.SOCK_STREAM:
                sock.connect((destination, port))
            else:
                # DNS query has no real-domain lookup and goes only to TEST-NET.
                payload = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x07invalid\x00\x00\x01\x00\x01"
                sock.sendto(payload, (destination, port))
    except OSError as error:
        need(error.errno in DENIAL, "UNPROVEN_EGRESS_DENIAL")
        return {"errno": error.errno, "sent": False}
    raise RuntimeError("EGRESS_NOT_DENIED")


MOUNTINFO_BYTES = 64 * 1024
MAX_MOUNTS = 256
MAX_UNKNOWN_MOUNTS = 4
MAX_MOUNTPOINT_LENGTH = 384
SAFETY_FLAGS = ("nosuid", "nodev", "noexec")
FILESYSTEM = re.compile(r"[A-Za-z0-9_.+-]{1,48}")
ENCODED_MOUNTPOINT = re.compile(r"/(?:[A-Za-z0-9/_.~-]|%[0-9A-F]{2})*")
MOUNT_ESCAPES = {rb"\134": b"\\", rb"\040": b" ", rb"\011": b"\t", rb"\012": b"\n"}


class MountFailure(RuntimeError):
    def __init__(self, code, report):
        super().__init__(code)
        self.report = report


def mount_report(mount_count, unknown_count, entries, *, truncated):
    return {
        "mount_count": mount_count,
        "unknown_count": unknown_count,
        "unknown_mounts": entries,
        "truncated": truncated,
    }


def validate_mount_report(report):
    """Only copy bounded fields across the container/evidence boundary."""
    if not isinstance(report, dict) or type(report.get("truncated")) is not bool:
        return None
    count, unknown, rows = (
        report.get(k) for k in ("mount_count", "unknown_count", "unknown_mounts")
    )
    if not isinstance(rows, list) or len(rows) > MAX_UNKNOWN_MOUNTS:
        return None
    if count is None or unknown is None:
        if count is None and unknown is None and not rows and report["truncated"]:
            return mount_report(None, None, [], truncated=True)
        return None
    if not (
        type(count) is int
        and type(unknown) is int
        and 0 <= len(rows) <= unknown <= count <= MAX_MOUNTS
    ):
        return None
    if unknown == 0 or report["truncated"] != (len(rows) < unknown):
        return None
    safe = []
    for row in rows:
        if not isinstance(row, dict):
            return None
        point, fs, access = (row.get(k) for k in ("mountpoint", "filesystem", "access"))
        flags = row.get("flags")
        root_is_slash = row.get("root_is_slash")
        if not (
            isinstance(point, str)
            and len(point) <= MAX_MOUNTPOINT_LENGTH
            and ENCODED_MOUNTPOINT.fullmatch(point)
            and isinstance(fs, str)
            and FILESYSTEM.fullmatch(fs)
            and access in ("ro", "rw")
            and type(root_is_slash) is bool
            and isinstance(flags, list)
            and flags == [flag for flag in SAFETY_FLAGS if flag in flags]
        ):
            return None
        safe.append(
            {
                "mountpoint": point,
                "filesystem": fs,
                "access": access,
                "flags": flags,
                "root_is_slash": root_is_slash,
            }
        )
    return mount_report(count, unknown, safe, truncated=report["truncated"])


def read_mountinfo():
    with Path("/proc/self/mountinfo").open("rb") as stream:
        return stream.read(MOUNTINFO_BYTES + 1)


def verify_mounts(snapshot):
    if len(snapshot) > MOUNTINFO_BYTES:
        raise MountFailure(
            "MOUNTINFO_BUDGET", mount_report(None, None, [], truncated=True)
        )
    lines = snapshot.splitlines()
    if len(lines) > MAX_MOUNTS:
        raise MountFailure(
            "MOUNTINFO_BUDGET", mount_report(None, None, [], truncated=True)
        )
    # Engine-side inspect separately authenticates the only configured mount.
    allowed = {
        "/",
        "/proc",
        "/dev",
        "/dev/pts",
        "/sys",
        "/sys/fs/cgroup",
        "/dev/mqueue",
        "/dev/shm",
        "/etc/resolv.conf",
        "/etc/hostname",
        "/etc/hosts",
        "/media",
        "/proc/bus",
        "/proc/fs",
        "/proc/irq",
        "/proc/sys",
        "/proc/sysrq-trigger",
        "/proc/acpi",
        "/proc/interrupts",
        "/proc/kcore",
        "/proc/keys",
        "/proc/latency_stats",
        "/proc/timer_list",
        "/proc/scsi",
        "/sys/firmware",
        "/sys/devices/virtual/powercap",
    }
    media_access = []
    unknown = []
    unlisted = 0
    for line in lines:
        head, separator, tail = line.partition(b" - ")
        fields, details = head.split(b" "), tail.split(b" ")
        need(separator and len(fields) >= 6 and len(details) == 3, "MOUNTINFO_INVALID")
        raw_path = fields[4]
        need(raw_path.startswith(b"/"), "MOUNTINFO_INVALID")
        # Decode only Linux mountinfo's four escapes, once. Encode unsafe display bytes.
        pieces = re.split(rb"(\\[0-7]{3})", raw_path)
        need(
            all(part in MOUNT_ESCAPES for part in pieces[1::2])
            and all(b"\\" not in part for part in pieces[::2]),
            "MOUNTINFO_INVALID",
        )
        path = b"".join(MOUNT_ESCAPES.get(part, part) for part in pieces)
        flags = fields[5].split(b",")
        access = set(flags) & {b"ro", b"rw"}
        need(len(access) == 1, "MOUNTINFO_INVALID")
        mode = access.pop().decode("ascii")
        if path == b"/media":
            media_access.append(mode)
        if path.decode("ascii", errors="surrogateescape") in allowed:
            continue
        unlisted += 1
        point = quote_from_bytes(path, safe="/")
        fstype = details[0].decode("ascii", errors="surrogateescape")
        if (
            len(unknown) < MAX_UNKNOWN_MOUNTS
            and len(point) <= MAX_MOUNTPOINT_LENGTH
            and FILESYSTEM.fullmatch(fstype)
        ):
            unknown.append(
                {
                    "mountpoint": point,
                    "filesystem": fstype,
                    "access": mode,
                    "flags": [flag for flag in SAFETY_FLAGS if flag.encode() in flags],
                    "root_is_slash": fields[3] == b"/",
                }
            )

    if unlisted:
        raise MountFailure(
            "UNEXPECTED_MOUNT",
            mount_report(
                len(lines), unlisted, unknown, truncated=len(unknown) < unlisted
            ),
        )
    need(media_access == ["ro"], "MEDIA_NOT_READ_ONLY")
    return len(lines)


def namespace():
    need(sorted(os.listdir("/sys/class/net")) == ["lo"], "NON_LOOPBACK_INTERFACE")
    ipv4 = Path("/proc/net/route").read_text().splitlines()[1:]
    need(not any(line.strip() for line in ipv4), "IPV4_ROUTE")
    ipv6 = Path("/proc/net/ipv6_route").read_text().splitlines()
    need(all(line.split()[-1] == "lo" for line in ipv6 if line.strip()), "IPV6_ROUTE")
    mount_count = verify_mounts(read_mountinfo())
    return {
        "interfaces": ["lo"],
        "ipv4_routes": 0,
        "ipv6_non_loopback_routes": 0,
        "configured_mounts": ["/media"],
        "mount_count": mount_count,
        "media_read_only": True,
    }


def run():
    global CURRENT_STAGE
    CURRENT_STAGE = "namespace"
    # Establish route isolation before sending any probe, including the positives.
    topology = namespace()
    rows = []
    for name, kind in (
        ("positive_ipv4_tcp", socket.SOCK_STREAM),
        ("positive_ipv4_udp", socket.SOCK_DGRAM),
    ):
        CURRENT_STAGE = name
        start = time.monotonic()
        rows.append(
            {
                "case": name,
                **positive(kind),
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
    for name, family, kind, address, port in NEGATIVE:
        CURRENT_STAGE = name
        start = time.monotonic()
        rows.append(
            {
                "case": name,
                **negative(family, kind, address, port),
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
    rows.append({"case": "namespace_routes_mounts", **topology})
    return rows


def main():
    global CURRENT_STAGE
    CURRENT_STAGE = "isolation"
    actual = isolation(json.loads(sys.argv[1]))  # noqa: F821
    trials = run()
    CURRENT_STAGE = "metrics"
    print(json.dumps({"trials": trials, **actual, "metrics": read_metrics()}))  # noqa: F821


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:  # noqa: BLE001 -- bounded fail-closed process boundary
        failure = {
            "probe_status": "FAILED",
            "code": failure_code(error),
            "stage": CURRENT_STAGE,
        }
        if isinstance(error, MountFailure):
            failure["mount_report"] = error.report
        print(json.dumps(failure))
        sys.exit(73)
