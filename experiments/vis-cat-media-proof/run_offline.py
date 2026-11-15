"""Run the synthetic offline profile and emit evidence bound to the tested source."""
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import subprocess
import sys
import time

from PIL import Image, features

from pipeline import LAB, POLICY, PROFILE, canonical, run_attempt, sha
from test_offline import attempt, fixture


def git(*args):
    return subprocess.check_output(["git", *args], cwd=LAB, text=True, timeout=10).strip()


def main():
    root = LAB.parent.parent
    sources = sorted(
        path for directory in (LAB, LAB.parent / "vis-cat-02b", LAB.parent / "vis-cat-02c")
        for path in directory.glob("*.py")
    )

    def source_record():
        return {path.relative_to(root).as_posix(): sha(path.read_bytes()) for path in sources}

    head = git("rev-parse", "HEAD")
    status = git("status", "--porcelain=v1", "--untracked-files=normal")
    source_hashes = source_record()
    v1_paths = ["docs/contracts/R1-002-staff.openapi.json", "docs/contracts/R1-004-catalog.openapi.json"]
    v1_blobs = {path: git("rev-parse", f"HEAD:{path}") for path in v1_paths}
    if any(git("hash-object", root / path) != blob for path, blob in v1_blobs.items()):
        raise RuntimeError("V1_WORKTREE_DRIFT")
    if any(git("rev-parse", f"661c742ff4c47b5adc93a0b646a09015482012b1:{path}") != blob
           for path, blob in v1_blobs.items()):
        raise RuntimeError("V1_BASELINE_DRIFT")
    metrics = []
    for fmt in ("JPEG", "PNG", "WEBP"):
        raw = fixture(fmt)
        started = time.perf_counter_ns()
        manifest, _ = run_attempt(raw, attempt(raw, fmt))
        metrics.append(dict(format=fmt, source_sha256=sha(raw), manifest=manifest,
                            manifest_sha256=sha(canonical(manifest)),
                            host_elapsed_ms=(time.perf_counter_ns() - started) / 1_000_000))
    suites = []
    success = True
    for directory, pattern in (
        (LAB, "test_offline.py"),
        (LAB.parent / "vis-cat-02b", "test_lifecycle.py"),
        (LAB.parent / "vis-cat-02c", "test_models.py"),
    ):
        result = subprocess.run(
            [sys.executable, "-B", "-m", "unittest", "discover", "-v", "-s", str(directory), "-p", pattern],
            capture_output=True, text=True, timeout=45, cwd=root, check=False,
        )
        print(result.stderr, file=sys.stderr, end="")
        match = re.search(r"^Ran (\d+) tests?", result.stderr, re.MULTILINE)
        count = int(match[1]) if match else 0
        passed = result.returncode == 0 and count > 0
        suites.append(dict(directory=directory.name, test=pattern, count=count, passed=passed))
        success &= passed
    if source_record() != source_hashes or git("rev-parse", "HEAD") != head or git("status", "--porcelain=v1", "--untracked-files=normal") != status:
        raise RuntimeError("SOURCE_CHANGED")
    print(json.dumps(dict(
        status="OFFLINE_PASS" if success else "OFFLINE_FAIL", head=head, clean=not status,
        profile=PROFILE, policy=POLICY, sources=source_hashes, synthetic=True,
        cd01="NARROW_EXCEPTION_SEMANTICS_SIMULATED", scanner="NOT_RUN",
        environment=dict(system=platform.system(), release=platform.release(), arch=platform.machine(),
                         python=platform.python_version(), pillow=Image.__version__,
                         sqlite=sqlite3.sqlite_version, directory_fsync=os.name == "posix",
                         codecs={key: features.version(key) for key in ("jpg", "zlib", "webp")}),
        suites=suites, frozen_v1_blobs=v1_blobs, host_process_samples=metrics,
        not_proven=["container isolation", "codec diversity", "cgroup performance",
                    "PostgreSQL/target volume durability", "power loss", "production HTTP/cache",
                    "real photo rights and marking readability", "antivirus"],
    ), ensure_ascii=True, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
