"""Read-only host preflight for WB-LAB-01. Emits JSON and never provisions Docker."""

import http.client
import json
import os
import platform
import re
import shutil
import socket
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path("/mnt/data/stdu-wb-lab-01")
SOCKET = Path("/var/run/docker.sock")
MIB = 1024**2
GIB = 1024**3
ENGINE_VERSION = "29.9.2"
COMPOSE_VERSION = "5.6.1"
LABEL = "stdu.wb-lab-01.run"
ENGINE_LIMIT_FIELDS = (
    "MemoryLimit",
    "SwapLimit",
    "CpuCfsQuota",
    "CpuCfsPeriod",
    "PidsLimit",
)
ENGINE_INFO_MAX_BYTES = MIB
ENGINE_INFO_TIMEOUT = 5


class Blocked(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise Blocked(reason)


def call(*args):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    require(result.returncode == 0, f"COMMAND_FAILED:{args[0]}")
    return result.stdout.strip()


def docker(*args):
    return call("docker", "--host", f"unix://{SOCKET}", *args)


class LocalEngineConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(SOCKET))


def engine_info():
    connection = LocalEngineConnection("localhost", timeout=ENGINE_INFO_TIMEOUT)
    try:
        connection.request(
            "GET",
            "/info",
            headers={"Accept": "application/json", "Connection": "close"},
        )
        with connection.getresponse() as response:
            require(response.status == 200, "ENGINE_INFO_HTTP_STATUS")
            payload = response.read(ENGINE_INFO_MAX_BYTES + 1)
            require(len(payload) <= ENGINE_INFO_MAX_BYTES, "ENGINE_INFO_TOO_LARGE")
            info = json.loads(payload)
            require(isinstance(info, dict), "ENGINE_INFO_OBJECT_REQUIRED")
            return info
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise Blocked("ENGINE_INFO_UNAVAILABLE") from error
    finally:
        connection.close()


def mount(path):
    result = json.loads(
        call(
            "findmnt",
            "--json",
            "--target",
            str(path),
            "--output",
            "TARGET,SOURCE,FSTYPE,MAJ:MIN,OPTIONS",
        )
    )["filesystems"]
    require(len(result) == 1, "MOUNT_IDENTITY_AMBIGUOUS")
    return result[0]


def mem_available():
    match = re.search(
        r"^MemAvailable:\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.MULTILINE
    )
    require(match is not None, "MEMAVAILABLE_UNKNOWN")
    return int(match[1]) * 1024


def thresholds(available, disk_free):
    require(available >= 768 * MIB, "MEMORY_BELOW_768_MIB")
    require(disk_free >= 4 * GIB, "DISK_BELOW_4_GIB")


def verify_runtime(info, compose, controllers, expected_daemon):
    require(info["ID"] == expected_daemon, "DAEMON_ID_MISMATCH")
    require(
        info["OSType"] == "linux" and info["Architecture"] in {"aarch64", "arm64"},
        "ENGINE_PLATFORM",
    )
    require(info["ServerVersion"] == ENGINE_VERSION, "ENGINE_VERSION")
    require(compose.removeprefix("v") == COMPOSE_VERSION, "COMPOSE_VERSION")
    require(str(info["CgroupVersion"]) == "2", "CGROUP_V2_REQUIRED")
    require(
        {"cpu", "memory", "pids"} <= set(controllers), "CGROUP_CONTROLLERS_UNAVAILABLE"
    )
    require(
        all(info.get(key) is True for key in ENGINE_LIMIT_FIELDS),
        "CGROUP_LIMITS_UNAVAILABLE",
    )


def collect(expected_daemon):
    require(
        platform.system() == "Linux" and platform.machine() == "aarch64",
        "ARM64_LINUX_REQUIRED",
    )
    require(platform.release() == "6.8.0-wb162", "WB_KERNEL_MISMATCH")
    require(len(os.sched_getaffinity(0)) >= 2, "CPU_AFFINITY_BELOW_2")
    require(
        not any(
            os.environ.get(k)
            for k in (
                "DOCKER_HOST",
                "DOCKER_CONTEXT",
                "DOCKER_TLS_VERIFY",
            )
        ),
        "AMBIENT_DOCKER_TARGET",
    )
    require(stat.S_ISSOCK(SOCKET.stat().st_mode), "LOCAL_DOCKER_SOCKET_REQUIRED")
    info = engine_info()
    compose = docker("compose", "version", "--short")
    controllers = Path("/sys/fs/cgroup/cgroup.controllers").read_text().split()
    verify_runtime(info, compose, controllers, expected_daemon)
    require(
        not any(
            (
                docker("container", "ls", "-aq", "--filter", f"label={LABEL}"),
                docker("network", "ls", "-q", "--filter", f"label={LABEL}"),
                docker("volume", "ls", "-q", "--filter", f"label={LABEL}"),
            )
        ),
        "EXISTING_LAB_RESOURCES",
    )
    require(
        ROOT.is_dir() and ROOT.resolve(strict=True) == ROOT,
        "LAB_ROOT_MISSING_OR_SYMLINK",
    )
    root_stat = ROOT.stat()
    require(
        root_stat.st_uid == os.geteuid()
        and stat.S_IMODE(root_stat.st_mode) == 0o700
        and os.access(ROOT, os.W_OK | os.X_OK),
        "LAB_ROOT_OWNER_OR_MODE",
    )
    require(not any(ROOT.iterdir()), "LAB_ROOT_NOT_EMPTY")
    root, data, lab, engine = (
        mount(p) for p in ("/", "/mnt/data", ROOT, info["DockerRootDir"])
    )
    require(root["source"] == "/dev/mmcblk0p2", "ROOT_DEVICE_MISMATCH")
    require(
        all(
            m["fstype"] == "ext4" and m["maj:min"] == root["maj:min"]
            for m in (root, data, lab, engine)
        ),
        "SHARED_EXT4_IDENTITY_NOT_CONFIRMED",
    )
    require(
        all(
            "rw" in m["options"].split(",")
            and not (
                {"nobarrier", "barrier=0", "data=writeback"}
                & set(m["options"].split(","))
            )
            for m in (lab, engine)
        ),
        "UNSAFE_MOUNT_OPTIONS",
    )
    free = shutil.disk_usage(ROOT).free
    available = mem_available()
    thresholds(available, free)
    return {
        "status": "E0A_HOST_METADATA_PASS",
        "daemon_id": info["ID"],
        "engine_version": info["ServerVersion"],
        "storage_driver": info["Driver"],
        "docker_root": info["DockerRootDir"],
        "compose": compose,
        "cgroup_version": str(info["CgroupVersion"]),
        "cgroup_controllers": controllers,
        "cgroup_driver": info["CgroupDriver"],
        "engine_limits": {key: info[key] for key in ENGINE_LIMIT_FIELDS},
        "kernel": platform.release(),
        "cpu_affinity": len(os.sched_getaffinity(0)),
        "mem_available_bytes": available,
        "disk_free_bytes": free,
        "mounts": {
            "root": root,
            "data": data,
            "lab": lab,
            "docker": engine,
        },
        "resource_ownership": "NOT_RUN",
        "container_cgroup_limits": "NOT_RUN",
        "E0b": "NOT_RUN",
        "VDS_equivalence": "NOT_PROVEN",
    }


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2 and bool(sys.argv[1]), "EXPECTED_DAEMON_ID_REQUIRED")
        print(json.dumps(collect(sys.argv[1]), indent=2))
    except (Blocked, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, Blocked) else type(error).__name__
        print(json.dumps({"status": "BLOCKED", "reason": reason}))
        sys.exit(1)
