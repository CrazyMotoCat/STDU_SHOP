"""Host-side orchestrator. All decoding and fault injection run inside Docker."""

import argparse
import base64
import hashlib
import json
import platform
import re
import subprocess
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

LIMITS = {
    "cpus": "1",
    "memory": "256m",
    "pids-limit": "32",
    "memory-swap": "256m",
}
SCRATCH = "/scratch:rw,noexec,nosuid,nodev,size=32m,mode=1777"
TIMEOUT = 30


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=15).strip()


CLEANUP_TIMEOUT = 10
OWNER_LABEL = "stdu.vis-cat-02b.owner"
CONTAINER_ID = re.compile(r"[a-f0-9]{64}")


class CleanupUnconfirmed(RuntimeError):
    pass


def cleanup(identity, container_id, create_uncertain):
    deadline = time.monotonic() + CLEANUP_TIMEOUT

    def call(*args):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("cleanup deadline")
        return subprocess.run(
            ["docker", *args],
            capture_output=True,
            timeout=min(remaining, 3),
            check=False,
        )

    def inspect(reference):
        result = call("container", "inspect", reference)
        if result.returncode:
            error = result.stderr.decode(errors="replace").strip()
            if error in {
                f"Error: No such container: {reference}",
                f"Error: No such object: {reference}",
                f"Error response from daemon: No such container: {reference}",
            }:
                return None
            raise RuntimeError("Docker inspect failed")
        [container] = json.loads(result.stdout)
        if (
            container["Name"] != f"/{identity}"
            or container["Config"]["Labels"].get(OWNER_LABEL) != identity
            or not CONTAINER_ID.fullmatch(container["Id"])
            or (container_id is not None and container["Id"] != container_id)
        ):
            raise RuntimeError("container ownership mismatch")
        return container

    exact_id = container_id
    try:
        container = inspect(container_id or identity)
        if container is None:
            if create_uncertain:
                # A disconnected create request could still complete on the daemon.
                raise RuntimeError("interrupted create has no confirmed container")
            return
        exact_id = container["Id"]
        if container["State"]["Running"]:
            stopped = call("container", "kill", exact_id)
            if stopped.returncode:
                # A concurrent exit can make kill fail. Inspect again before removal.
                container = inspect(exact_id)
                if container is None:
                    return
        removed = call("container", "rm", "--force", exact_id)
        if inspect(exact_id) is None:
            return
        if removed.returncode:
            raise RuntimeError("Docker removal failed")
        raise RuntimeError("container still exists after removal")
    except (Exception, KeyboardInterrupt) as error:
        raise CleanupUnconfirmed(
            f"CLEANUP_UNCONFIRMED name={identity} id={exact_id or 'unknown'}"
        ) from error


def run(image, *command, data=None):
    name = "vis-cat-02b-" + uuid.uuid4().hex
    flags = [part for key, value in LIMITS.items() for part in (f"--{key}", value)]
    invocation = [
        "docker",
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        f"{OWNER_LABEL}={name}",
        "-i",
        "--network=none",
        "--read-only",
        "--user=65534:65534",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--log-driver=none",
        "--tmpfs",
        SCRATCH,
        *flags,
        image,
        "python",
        *command,
    ]
    deadline = time.monotonic() + TIMEOUT
    container_id = None
    create_uncertain = True
    try:
        created = subprocess.run(
            invocation, capture_output=True, timeout=TIMEOUT, check=True
        )
        candidate = created.stdout.decode("ascii").strip()
        if not CONTAINER_ID.fullmatch(candidate):
            raise RuntimeError("Docker create returned an invalid container ID")
        container_id = candidate
        create_uncertain = False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired("docker start", TIMEOUT)
        result = subprocess.run(
            ["docker", "start", "-a", "-i", container_id],
            input=data or b"",
            capture_output=True,
            timeout=remaining,
            check=True,
        )
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr.decode(errors="replace")) from error
    finally:
        cleanup(name, container_id, create_uncertain)


def codec(image, mode, *args, data=None):
    return run(image, "/bench/codec.py", mode, *args, data=data)


def probe(image, repetitions, warmup):
    versions = codec(image, "versions")["result"]
    boundary = codec(image, "boundary")["result"]
    assert boundary["interfaces"] == ["lo"] and boundary["egress_denied"]
    assert boundary["uid"] == 65534 and not boundary["private_mount_present"]
    assert not boundary["credential_env"]
    assert boundary["cgroups"] == {
        "cpu.max": "100000 100000",
        "memory.max": "268435456",
        "pids.max": "32",
    }
    manifest = codec(image, "fixtures")["result"]
    # Dedicated warm-up records no timings in the sample set.
    sample = manifest[0]
    sample_bytes = sample["data"]
    for _ in range(warmup):
        assert (
            codec(image, "process", "2097152", data=base64.b64decode(sample["data"]))[
                "status"
            ]
            == "accepted"
        )
    samples = []
    for case in manifest:
        encoded = case.pop("data")
        data = (
            base64.b64decode(encoded)
            if encoded is not None
            else bytes(8 * 1024 * 1024 + 1)
        )
        if encoded is None:
            case["submitted_bytes"] = len(data)
            case["submitted_sha256"] = hashlib.sha256(data).hexdigest()
        for repetition in range(repetitions):
            row = {"case": case["id"], "repetition": repetition}
            worker = codec(
                image, "process", str(case.get("output_cap", 2097152)), data=data
            )
            assert worker["status"] == case["expected"], (case["id"], worker["status"])
            if encoded is None:
                assert worker["budget"] == "source bytes", case["id"]
            if "output_cap" in case:
                assert worker["budget"] == "output bytes", case["id"]
            outputs = worker.pop("result", None)
            row["worker"] = worker
            if outputs is not None:
                request = {
                    "outputs": outputs,
                    "source_dimensions": [case["width"], case["height"]],
                }
                verifier = codec(image, "verify", data=json.dumps(request).encode())
                assert verifier["status"] == "accepted", case["id"]
                row["verifier"] = verifier
                row["outputs"] = [
                    {k: v for k, v in item.items() if k != "data"} for item in outputs
                ]
            samples.append(row)
    sample = manifest[0]
    candidate = codec(image, "process", "2097152", data=base64.b64decode(sample_bytes))[
        "result"
    ]
    candidate[0]["sha256"] = "0" * 64
    tampered = codec(
        image,
        "verify",
        data=json.dumps(
            {
                "outputs": candidate,
                "source_dimensions": [sample["width"], sample["height"]],
            }
        ).encode(),
    )
    assert tampered["status"] == "rejected"
    return {
        "versions": versions,
        "boundary": boundary,
        "manifest": manifest,
        "samples": samples,
        "tampered_verifier": tampered,
        "storage": run(image, "/bench/storage.py"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repetitions", type=int, choices=(1, 2, 3), default=2)
    args = parser.parse_args()
    image = docker("image", "inspect", args.image, "--format", "{{.Id}}")
    report = dict(
        schema=1,
        recorded_at=datetime.now(UTC).isoformat(),
        image_id=image,
        host=platform.platform(),
        docker=docker("version", "--format", "{{.Server.Version}}"),
        container_limits=LIMITS,
        scratch=SCRATCH,
        timeout_s=TIMEOUT,
        warmup=1,
        repetitions=args.repetitions,
        **probe(image, args.repetitions, 1),
    )
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
