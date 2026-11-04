"""Host-side orchestrator. All decoding and fault injection run inside Docker."""
import argparse
import base64
from datetime import datetime, timezone
import json
import hashlib
from pathlib import Path
import platform
import subprocess
import uuid

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


def run(image, *command, data=None):
    name = "vis-cat-02b-" + uuid.uuid4().hex
    flags = [part for key, value in LIMITS.items() for part in (f"--{key}", value)]
    invocation = ["docker", "run", "--rm", "--pull=never", "--name", name, "-i",
                  "--network=none", "--read-only", "--user=65534:65534",
                  "--cap-drop=ALL", "--security-opt=no-new-privileges",
                  "--log-driver=none", "--tmpfs", SCRATCH, *flags,
                  image, "python", *command]
    try:
        result = subprocess.run(invocation, input=data or b"", capture_output=True,
                                timeout=TIMEOUT, check=True)
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr.decode(errors='replace')) from error
    except subprocess.TimeoutExpired:
        # The random name belongs exclusively to this invocation.
        subprocess.run(["docker", "kill", name], capture_output=True, timeout=10, check=False)
        raise


def codec(image, mode, *args, data=None):
    return run(image, "/bench/codec.py", mode, *args, data=data)


def probe(image, repetitions, warmup):
    versions = codec(image, "versions")["result"]
    boundary = codec(image, "boundary")["result"]
    assert boundary["interfaces"] == ["lo"] and boundary["egress_denied"]
    assert boundary["uid"] == 65534 and not boundary["private_mount_present"]
    assert not boundary["credential_env"]
    assert boundary["cgroups"] == {"cpu.max": "100000 100000",
                                  "memory.max": "268435456", "pids.max": "32"}
    manifest = codec(image, "fixtures")["result"]
    # Dedicated warm-up records no timings in the sample set.
    sample = manifest[0]
    sample_bytes = sample["data"]
    for _ in range(warmup):
        assert codec(image, "process", "2097152", data=base64.b64decode(sample["data"]))["status"] == "accepted"
    samples = []
    for case in manifest:
        encoded = case.pop("data")
        data = base64.b64decode(encoded) if encoded is not None else bytes(8 * 1024 * 1024 + 1)
        if encoded is None:
            case["submitted_bytes"] = len(data)
            case["submitted_sha256"] = hashlib.sha256(data).hexdigest()
        for repetition in range(repetitions):
            row = dict(case=case["id"], repetition=repetition)
            worker = codec(image, "process", str(case.get("output_cap", 2097152)), data=data)
            assert worker["status"] == case["expected"], (case["id"], worker["status"])
            if encoded is None:
                assert worker["budget"] == "source bytes", case["id"]
            if "output_cap" in case:
                assert worker["budget"] == "output bytes", case["id"]
            outputs = worker.pop("result", None)
            row["worker"] = worker
            if outputs is not None:
                request = dict(outputs=outputs, source_dimensions=[case["width"], case["height"]])
                verifier = codec(image, "verify", data=json.dumps(request).encode())
                assert verifier["status"] == "accepted", case["id"]
                row["verifier"] = verifier
                row["outputs"] = [{k: v for k, v in item.items() if k != "data"} for item in outputs]
            samples.append(row)
    sample = manifest[0]
    candidate = codec(image, "process", "2097152", data=base64.b64decode(sample_bytes))["result"]
    candidate[0]["sha256"] = "0" * 64
    tampered = codec(image, "verify", data=json.dumps(
        dict(outputs=candidate, source_dimensions=[sample["width"], sample["height"]])).encode())
    assert tampered["status"] == "rejected"
    return dict(versions=versions, boundary=boundary, manifest=manifest, samples=samples,
                tampered_verifier=tampered,
                storage=run(image, "/bench/storage.py"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--repetitions", type=int, choices=(1, 2, 3), default=2)
    args = parser.parse_args()
    image = docker("image", "inspect", args.image, "--format", "{{.Id}}")
    report = dict(schema=1, recorded_at=datetime.now(timezone.utc).isoformat(),
                  image_id=image, host=platform.platform(), docker=docker("version", "--format", "{{.Server.Version}}"),
                  container_limits=LIMITS, scratch=SCRATCH, timeout_s=TIMEOUT, warmup=1,
                  repetitions=args.repetitions, **probe(image, args.repetitions, 1))
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
