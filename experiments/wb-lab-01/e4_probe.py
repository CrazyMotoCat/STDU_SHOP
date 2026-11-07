"""Network-none canaries. All positive traffic stays on namespace loopback."""

import errno
import hashlib
import json
import os
import selectors
import socket
import sys
import time
from pathlib import Path

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


def namespace():
    need(sorted(os.listdir("/sys/class/net")) == ["lo"], "NON_LOOPBACK_INTERFACE")
    ipv4 = Path("/proc/net/route").read_text().splitlines()[1:]
    need(not any(line.strip() for line in ipv4), "IPV4_ROUTE")
    ipv6 = Path("/proc/net/ipv6_route").read_text().splitlines()
    need(all(line.split()[-1] == "lo" for line in ipv6 if line.strip()), "IPV6_ROUTE")
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
    points = [
        line.split()[4]
        for line in Path("/proc/self/mountinfo").read_text().splitlines()
    ]
    need(set(points) <= allowed and points.count("/media") == 1, "UNEXPECTED_MOUNT")
    return {
        "interfaces": ["lo"],
        "ipv4_routes": 0,
        "ipv6_non_loopback_routes": 0,
        "configured_mounts": ["/media"],
        "mount_count": len(points),
    }


def run():
    # Establish route isolation before sending any probe, including the positives.
    topology = namespace()
    rows = []
    for name, kind in (
        ("positive_ipv4_tcp", socket.SOCK_STREAM),
        ("positive_ipv4_udp", socket.SOCK_DGRAM),
    ):
        start = time.monotonic()
        rows.append(
            {
                "case": name,
                **positive(kind),
                "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
            }
        )
    for name, family, kind, address, port in NEGATIVE:
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
    actual = isolation(json.loads(sys.argv[1]))  # noqa: F821
    print(json.dumps({"trials": run(), **actual, "metrics": read_metrics()}))  # noqa: F821


if __name__ == "__main__":
    main()
