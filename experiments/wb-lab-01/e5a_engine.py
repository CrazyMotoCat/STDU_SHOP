"""E5A controller create-intent recovery over the local Docker Engine socket."""

import http.client
import json
import os
import re
import select
import socket
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


class DeadlineSocket(socket.socket):
    """Reapply the same absolute deadline on each buffered HTTP read."""

    def __init__(self, deadline):
        super().__init__(socket.AF_UNIX, socket.SOCK_STREAM)
        self.deadline = deadline

    def arm(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        self.settimeout(remaining)

    def recv_into(self, buffer, nbytes=0, flags=0):
        self.arm()
        return super().recv_into(buffer, nbytes, flags)

    def sendall(self, data, flags=0):
        self.arm()
        return super().sendall(data, flags)


class LocalEngineConnection(http.client.HTTPConnection):
    def __init__(self, deadline):
        super().__init__("localhost")
        self.deadline = deadline
        self.stage = "CONNECT"

    def connect(self):
        self.sock = DeadlineSocket(self.deadline)
        self.sock.arm()
        self.sock.connect(str(SOCKET))
        self.stage = "WRITE"


class EngineTimeout(Blocked):
    def __init__(self, reason, stage, elapsed_ms, budget_ms):
        super().__init__(reason)
        self.details = {
            "stage": stage,
            "elapsed_ms": elapsed_ms,
            "budget_ms": budget_ms,
        }


class ExchangeTimeout(TimeoutError):
    def __init__(self, stage):
        self.stage = stage


def unix_request(method, path, body, deadline):
    """Only the local Unix socket, with no retry, process, redirect or idle timeout."""
    connection = LocalEngineConnection(deadline)
    try:
        headers = {"Connection": "close", "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(body).encode()
        connection.request(method, path, body=body, headers=headers)
        connection.stage = "HEADERS"
        with connection.getresponse() as response:
            connection.stage = "BODY"
            length = response.length
            require(length is None or 0 <= length <= 1024**2, "E5A_ENGINE_RESPONSE")
            raw = response.read(1024**2 + 1)
            require(
                len(raw) <= 1024**2 and (length is None or len(raw) == length),
                "E5A_ENGINE_RESPONSE",
            )
            return response.status, raw
    except TimeoutError:
        raise ExchangeTimeout(connection.stage) from None
    except (http.client.HTTPException, OSError):
        raise Blocked("E5A_ENGINE_TRANSPORT") from None
    finally:
        connection.close()


class Engine:
    def __init__(self, transport=unix_request):
        self.transport = transport

    def request(
        self, method, path, deadline, *, statuses=(200,), body=None, shape=dict
    ):
        started = time.monotonic()
        end = min(deadline, started + 5)
        require(started < end, "E5A_ENGINE_DEADLINE")
        try:
            code, raw = self.transport(method, path, body, end)
            if time.monotonic() >= end:
                raise ExchangeTimeout("RESPONSE")
        except (TimeoutError, subprocess.TimeoutExpired) as error:
            parts = path.partition("?")[0].strip("/").split("/")
            resource = {
                "info": "DAEMON",
                "images": "IMAGE",
                "containers": "CONTAINER",
                "volumes": "VOLUME",
                "networks": "NETWORK",
            }.get(parts[0], "OTHER")
            action = (
                parts[-1].upper()
                if parts[-1] in {"create", "start", "stop", "kill", "stats"}
                else "INSPECT"
                if (
                    len(parts) == 3 and parts[0] == "containers" and parts[-1] == "json"
                )
                or (len(parts) == 2 and parts[0] == "volumes" and method == "GET")
                else "LIST"
                if method == "GET"
                and parts in (["containers", "json"], ["volumes"], ["networks"])
                else method
                if method in {"GET", "POST", "DELETE"}
                else "OTHER"
            )
            raise EngineTimeout(
                f"E5A_ENGINE_TIMEOUT_{resource}_{action}",
                error.stage if isinstance(error, ExchangeTimeout) else "TRANSPORT",
                round((time.monotonic() - started) * 1000),
                round((end - started) * 1000),
            ) from None
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
