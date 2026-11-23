"""Single-job target probe. Invoke only on an approved dedicated Docker daemon."""
import argparse
import base64
import importlib.util
import json
import re
import subprocess

from PIL import Image, features

from pipeline import LAB, canonical, manifest_for, sha
from test_offline import attempt, fixture


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--image-id", required=True, help="approved local sha256 image ID")
    args = cli.parse_args()
    if not re.fullmatch("sha256:[a-f0-9]{64}", args.image_id):
        cli.error("--image-id requires the exact local image ID")
    backend = importlib.util.spec_from_file_location("vis_cat_02b_runner", LAB.parent / "vis-cat-02b" / "run.py")
    runner = importlib.util.module_from_spec(backend)
    backend.loader.exec_module(runner)

    def invoke(mode, request):
        report = runner.run(args.image_id, "/proof/vis-cat-media-proof/container_child.py",
                            mode, data=canonical(request))
        boundary = report["boundary"]
        if (boundary["uid"] != 65534 or boundary["interfaces"] != ["lo"]
                or not boundary["egress_denied"] or boundary["private_mount_present"]
                or boundary["credential_env"]):
            raise RuntimeError("BOUNDARY_MISMATCH")
        expected = {"cpu.max": "100000 100000", "memory.max": "268435456", "pids.max": "32"}
        if boundary["cgroups"] != expected or any(value is None for value in report["cgroup"].values()):
            raise RuntimeError("CGROUP_EVIDENCE_INCOMPLETE")
        return report

    raw = fixture()
    expected = attempt(raw).wire()
    worker = invoke("worker", dict(attempt=expected, source=base64.b64encode(raw).decode("ascii")))
    response = worker.pop("result")
    manifest, _ = manifest_for(expected, response)
    manifest_hash = sha(canonical(manifest))
    verifier = invoke("verifier", dict(attempt=expected, response=response, manifest_sha256=manifest_hash))
    if verifier.pop("result") != dict(attempt=expected, manifest_sha256=manifest_hash,
                                    digests=[item["sha256"] for item in manifest["variants"]],
                                    verdict="VERIFIED_MEDIA_POLICY"):
        raise RuntimeError("VERIFIER_MISMATCH")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=LAB, text=True, timeout=10).strip()
    print(json.dumps(dict(
        head=head, image_id=args.image_id, source_sha256=sha(raw), manifest_sha256=manifest_hash,
        fixture_generator=dict(pillow=Image.__version__, zlib=features.version("zlib")),
        worker=worker, verifier=verifier, scope="SINGLE_SYNTHETIC_CONTAINER_PROBE",
    ), indent=2))


if __name__ == "__main__":
    main()
