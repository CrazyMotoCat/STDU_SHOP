import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import random
import resource
import socket
import struct
import subprocess
import sys
import time
import warnings

from PIL import Image, features

SOURCE_CAP = 8 * 1024 * 1024
OUTPUT_CAP = 2 * 1024 * 1024
PIXELS = 5_000_000
VARIANTS = (160, 320, 640, 1200)
FORMATS = ("JPEG", "PNG", "WEBP")
Image.MAX_IMAGE_PIXELS = PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)


class BudgetExceeded(ValueError):
    """A bounded benchmark input or rendition exceeded its test cap."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pack(data):
    return base64.b64encode(data).decode("ascii")


def fixtures():
    cases = []
    for width, height in ((64, 48), (800, 600), (2048, 1536), (4096, 16), (2400, 2200)):
        seed = width * 10000 + height
        pixels = random.Random(seed).randbytes(width * height * 3)
        image = Image.frombytes("RGB", (width, height), pixels)
        for fmt in FORMATS:
            encoded = io.BytesIO()
            image.save(encoded, format=fmt)
            data = encoded.getvalue()
            expected = "rejected" if width * height > PIXELS or len(data) > SOURCE_CAP else "accepted"
            cases.append(dict(id=f"{fmt}-{width}x{height}", format=fmt, seed=seed,
                              width=width, height=height, sha256=digest(data),
                              source_bytes=len(data), expected=expected,
                              # An over-cap source needs only its measured length and digest here.
                              data=pack(data) if len(data) <= SOURCE_CAP else None))
            if width == 64:
                cases.append(dict(id=f"{fmt}-truncated", data=pack(data[:len(data)//2]), expected="rejected"))
    gif = io.BytesIO()
    Image.new("RGB", (2, 2)).save(gif, format="GIF")
    cases += [
        dict(id="damaged", data=pack(b"\x89PNG\r\n\x1a\ninvalid"), expected="rejected"),
        dict(id="unsupported", data=pack(gif.getvalue()), expected="rejected"),
        dict(id="input-cap", data=None, expected="rejected"),
        dict(id="output-cap", data=cases[0]["data"], output_cap=1, expected="rejected"),
    ]
    for case in cases:
        if case["data"] is not None:
            data = base64.b64decode(case["data"])
            case.update(source_bytes=len(data), sha256=digest(data))
    return cases


def checked_image(data, formats):
    with Image.open(io.BytesIO(data), formats=formats) as image:
        if image.width * image.height > PIXELS or getattr(image, "n_frames", 1) != 1:
            raise ValueError("image budget")
        if image.format == "JPEG" and not data.endswith(b"\xff\xd9"):
            raise ValueError("JPEG terminator")
        if image.format == "PNG" and not data.endswith(bytes.fromhex("0000000049454e44ae426082")):
            raise ValueError("PNG terminator")
        if image.format == "WEBP" and int.from_bytes(data[4:8], "little") + 8 != len(data):
            raise ValueError("WebP length")
        image.verify()
    with Image.open(io.BytesIO(data), formats=formats) as image:
        image.load()
        return image.convert("RGB")


def dimensions(width, height, size):
    scale = min(1, size / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def process(cap):
    data = sys.stdin.buffer.read(SOURCE_CAP + 1)
    if len(data) > SOURCE_CAP:
        raise BudgetExceeded("source bytes")
    image = checked_image(data, FORMATS)
    outputs = []
    for size in VARIANTS:
        out = io.BytesIO()
        resized = image.resize(dimensions(*image.size, size), Image.Resampling.LANCZOS)
        resized.info.clear()
        resized.save(out, format="WEBP", quality=80)
        data = out.getvalue()
        if len(data) > cap:
            raise BudgetExceeded("output bytes")
        outputs.append(dict(size=size, width=resized.width, height=resized.height,
                            bytes=len(data), sha256=digest(data), data=pack(data)))
    return outputs


def verify():
    payload = json.loads(sys.stdin.buffer.read(12 * 1024 * 1024 + 1))
    outputs = payload["outputs"]
    if [item["size"] for item in outputs] != list(VARIANTS):
        raise ValueError("variant set")
    for item in outputs:
        data = base64.b64decode(item["data"], validate=True)
        if len(data) != item["bytes"] or len(data) > OUTPUT_CAP or digest(data) != item["sha256"]:
            raise ValueError("bytes or digest")
        if set(webp_chunks(data)) - {b"VP8 ", b"VP8L", b"VP8X", b"ALPH"}:
            raise ValueError("forbidden metadata")
        image = checked_image(data, ("WEBP",))
        if image.size != dimensions(*payload["source_dimensions"], item["size"]) or image.size != (item["width"], item["height"]):
            raise ValueError("dimensions")
    return True


def webp_chunks(data):
    offset = 12
    while offset + 8 <= len(data):
        tag, size = struct.unpack_from("<4sI", data, offset)
        offset += 8 + size + size % 2
        if offset > len(data):
            raise ValueError("invalid WebP chunk")
        yield tag
    if offset != len(data):
        raise ValueError("invalid WebP trailer")


def boundary():
    try:
        with socket.create_connection(("192.0.2.1", 5432), timeout=0.5):
            denied = False
    except OSError:
        denied = True
    return dict(uid=os.getuid(), interfaces=sorted(os.listdir("/sys/class/net")),
                egress_denied=denied, private_mount_present=Path("/data/files").exists(),
                credential_env=sorted(key for key in os.environ if
                                      any(word in key for word in ("SECRET", "TOKEN", "PASSWORD", "DATABASE"))),
                cgroups={name: Path("/sys/fs/cgroup", name).read_text().strip()
                         for name in ("cpu.max", "memory.max", "pids.max")})


def stats(start):
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return dict(wall_ms=round((time.monotonic()-start)*1000, 3),
                user_cpu_s=usage.ru_utime, system_cpu_s=usage.ru_stime, peak_rss_kib=usage.ru_maxrss,
                scratch_bytes=sum(p.stat().st_size for p in Path("/scratch").glob("**/*") if p.is_file()),
                block_reads=usage.ru_inblock, block_writes=usage.ru_oublock)


if __name__ == "__main__":
    mode = sys.argv[1]
    start = time.monotonic()
    try:
        if mode == "fixtures":
            result = fixtures()
        elif mode == "process":
            result = process(int(sys.argv[2]))
        elif mode == "verify":
            result = verify()
        elif mode == "boundary":
            result = boundary()
        elif mode == "versions":
            result = dict(python=platform.python_version(), kernel=platform.release(),
                          codecs={name: features.version(name) for name in ("jpg", "zlib", "webp")},
                          pillow=Image.__version__,
                          scratch_mount=next(line for line in Path("/proc/mounts").read_text().splitlines()
                                             if line.split()[1] == "/scratch"))
        else:
            raise RuntimeError("unknown mode")
        print(json.dumps(dict(status="accepted", result=result, metrics=stats(start))))
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        print(json.dumps(dict(status="rejected", reason=type(error).__name__,
                              budget=str(error) if isinstance(error, BudgetExceeded) else None,
                              metrics=stats(start))))
