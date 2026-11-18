"""E5A controller create-intent recovery over the local Docker Engine socket."""

import json
import os
import re
import select
import stat
import subprocess
import time
from dataclasses import asdict, dataclass

from preflight import LABEL, SOCKET, Blocked, require
from runtime_e0a import IMAGE, validate_image

HEX = re.compile(r"[a-f0-9]{64}")
RUN = re.compile(r"[a-f0-9]{32}")
FILE = "controller-create.json"
CONFIG = {
    "NetworkMode": "none",
    "IpcMode": "private",
    "CgroupnsMode": "private",
    "ReadonlyRootfs": True,
    "Memory": 64 * 1024**2,
    "MemorySwap": 64 * 1024**2,
    "NanoCpus": 250_000_000,
    "PidsLimit": 16,
    "CapDrop": ["ALL"],
    "SecurityOpt": ["no-new-privileges"],
    "LogConfig": {"Type": "none", "Config": {}},
}
COMMAND = ["-I", "-S", "-c", "import time; time.sleep(30)"]


@dataclass(frozen=True)
class Intent:
    run: str
    daemon: str
    image: str

    @property
    def name(self):
        return f"wb-lab-01-e5a-{self.run}-controller"

    def validate(self):
        require(
            RUN.fullmatch(self.run)
            and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", self.daemon)
            and self.image.startswith("sha256:")
            and HEX.fullmatch(self.image[7:]),
            "E5A_INTENT_IDENTITY",
        )


def payload(intent):
    intent.validate()
    return json.dumps(asdict(intent), sort_keys=True, separators=(",", ":")).encode(
        "ascii"
    )


def verify_directory(directory):
    info = os.fstat(directory)
    require(
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == os.geteuid()
        and stat.S_IMODE(info.st_mode) == 0o700,
        "E5A_INTENT_DIRECTORY",
    )


def save_intent(directory, intent):
    verify_directory(directory)
    data = payload(intent)
    fd = os.open(
        FILE,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    with os.fdopen(fd, "wb") as record:
        os.fchmod(record.fileno(), 0o600)
        record.write(data)
        record.flush()
        os.fsync(record.fileno())
    os.fsync(directory)


def verify_intent(directory, expected):
    verify_directory(directory)
    fd = os.open(FILE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, "rb") as record:
        info = os.fstat(record.fileno())
        require(
            stat.S_ISREG(info.st_mode)
            and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_nlink == 1,
            "E5A_INTENT_FILE",
        )
        require(record.read(1025) == payload(expected), "E5A_INTENT_CHANGED")


def unix_request(method, path, body, deadline):
    """Direct Engine API. curl enforces a total transfer deadline and response cap."""
    remaining = min(5, deadline - time.monotonic())
    require(remaining >= 0.001, "E5A_ENGINE_DEADLINE")
    args = [
        "/usr/bin/curl",
        "-q",
        "--silent",
        "--noproxy",
        "*",
        "--unix-socket",
        str(SOCKET),
        "--max-time",
        f"{remaining:.3f}",
        "--max-filesize",
        "1048576",
        "--request",
        method,
        "--write-out",
        "\\n%{http_code}",
    ]
    if body is not None:
        args += ["--header", "Content-Type: application/json", "--data-binary", "@-"]
    result = subprocess.run(
        [*args, "http://localhost" + path],
        input=json.dumps(body).encode() if body is not None else b"",
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=remaining,
        check=False,
        env={"LANG": "C"},
    )
    require(result.returncode == 0, "E5A_ENGINE_TRANSPORT")
    raw, _, status = result.stdout.rpartition(b"\n")
    return int(status), raw


class Engine:
    def __init__(self, transport=unix_request):
        self.transport = transport

    def request(
        self, method, path, deadline, *, statuses=(200,), body=None, shape=dict
    ):
        require(time.monotonic() < deadline, "E5A_ENGINE_DEADLINE")
        code, raw = self.transport(method, path, body, deadline)
        require(time.monotonic() < deadline, "E5A_ENGINE_DEADLINE")
        require(code in statuses and len(raw) <= 1024**2, "E5A_ENGINE_RESPONSE")
        if code in (204, 304, 404):
            return None
        result = json.loads(raw)
        require(isinstance(result, shape), "E5A_ENGINE_OBJECT")
        return result

    def attest(self, intent, deadline):
        info = self.request("GET", "/info", deadline)
        require(info["ID"] == intent.daemon, "E5A_DAEMON_CHANGED")

    def inspect(self, name, deadline):
        return self.request(
            "GET", f"/containers/{name}/json", deadline, statuses=(200, 404)
        )

    def create_controller(self, directory, intent, deadline):
        intent.validate()
        self.attest(intent, deadline)
        image = self.request("GET", f"/images/{IMAGE}/json", deadline)
        require(validate_image(image) == intent.image, "E5A_PINNED_IMAGE")
        require(not image["Config"].get("Volumes"), "E5A_IMAGE_VOLUMES")
        require(self.inspect(intent.name, deadline) is None, "E5A_NAME_COLLISION")
        save_intent(directory, intent)
        self.attest(intent, deadline)
        result = self.request(
            "POST",
            f"/containers/create?name={intent.name}",
            deadline,
            statuses=(201,),
            body={
                "Image": intent.image,
                "Labels": {LABEL: intent.run},
                "Entrypoint": ["/usr/local/bin/python"],
                "Cmd": COMMAND,
                "User": "65534:65534",
                "NetworkDisabled": True,
                "HostConfig": CONFIG,
            },
        )
        identifier = result["Id"]
        require(HEX.fullmatch(identifier), "E5A_CONTAINER_ID")
        return identifier

    def recover(self, directory, intent, deadline):
        verify_intent(directory, intent)
        self.attest(intent, deadline)
        candidate = self.inspect(intent.name, deadline)
        require(candidate is not None, "E5A_CREATE_OUTCOME_UNKNOWN")
        identifier = candidate["Id"]
        require(HEX.fullmatch(identifier), "E5A_CONTAINER_ID")
        self.verify_controller(candidate, intent, identifier)
        self.attest(intent, deadline)
        self.verify_controller(self.inspect(identifier, deadline), intent, identifier)
        verify_intent(directory, intent)
        # Slice 01 never starts this controller. Unexpected runtime state blocks removal.
        self.request(
            "DELETE",
            f"/containers/{identifier}?v=false&force=false",
            deadline,
            statuses=(204,),
        )
        self.attest(intent, deadline)
        require(
            self.inspect(identifier, deadline) is None
            and self.inspect(intent.name, deadline) is None,
            "E5A_CONTAINER_REMAINS",
        )

    @staticmethod
    def verify_controller(item, intent, identifier):
        require(item is not None, "E5A_CONTAINER_GONE")
        config = item["Config"]
        host = item["HostConfig"]
        require(
            item["Id"] == identifier
            and item["Name"] == "/" + intent.name
            and item["Image"] == config["Image"] == intent.image
            and config["Labels"].get(LABEL) == intent.run
            and config["Entrypoint"] == ["/usr/local/bin/python"]
            and config["Cmd"] == COMMAND
            and config["User"] == "65534:65534"
            and config["NetworkDisabled"] is True
            and all(host[key] == value for key, value in CONFIG.items())
            and host["Privileged"] is False
            and not any(
                host.get(key)
                for key in ("Binds", "Mounts", "VolumesFrom", "PortBindings", "Devices")
            )
            and item["Mounts"] == []
            and item["State"]["Status"] == "created"
            and item["State"]["Running"] is False,
            "E5A_CONTAINER_OWNERSHIP",
        )


def watchdog(directory, intent, runner_pidfd, engine, deadline, ready, result):
    """Standalone child target. A pidfd identifies the original runner after SIGKILL."""
    report = {"cleanup": "CLEANUP_UNCONFIRMED"}
    try:
        verify_directory(directory)
        poll = select.poll()
        poll.register(runner_pidfd, select.POLLIN)
        ready.send(os.getpid())
        expires = max(0, int((deadline - time.monotonic() - 5) * 1000))
        require(
            any(events & select.POLLIN for _, events in poll.poll(expires)),
            "E5A_RUNNER_WAIT",
        )
        engine.recover(directory, intent, deadline)
        report = {"cleanup": "CONFIRMED", "reason": "E5A_RUNNER_EXITED"}
    except (
        Blocked,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
    ) as error:
        report["reason"] = (
            str(error) if isinstance(error, Blocked) else type(error).__name__
        )
    finally:
        result.send(report)
