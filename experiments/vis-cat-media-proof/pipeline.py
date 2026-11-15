"""Finite synthetic-only protocol for the offline VIS-CAT proof."""

import asyncio
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
from dataclasses import dataclass

from PIL import Image, PngImagePlugin

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB.parent / "vis-cat-02b"))
from codec import FORMATS, OUTPUT_CAP, PIXELS, SOURCE_CAP, VARIANTS, checked_image, dimensions

PROFILE = "vis-cat-02b-geometry/offline-v1"
POLICY = "single-frame-webp/offline-v1"
WIRE_CAP = 12 * 1024 * 1024
TIMEOUT = 12
# Child-local cap on decompressed PNG text. The encoded source has its own cap.
PngImagePlugin.MAX_TEXT_CHUNK = 64 * 1024
PngImagePlugin.MAX_TEXT_MEMORY = 256 * 1024


class Refused(ValueError):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Refused("WIRE_INVALID")
        value[key] = item
    return value


def parse(raw):
    if len(raw) > WIRE_CAP:
        raise Refused("WIRE_LIMIT")
    try:
        value = json.loads(raw, object_pairs_hook=unique_pairs)
        if canonical(value) != raw:
            raise Refused("WIRE_INVALID")
        return value
    except (TypeError, ValueError, RecursionError) as exc:
        raise Refused("WIRE_INVALID") from exc


def exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise Refused("WIRE_INVALID")


@dataclass(frozen=True)
class Attempt:
    job: str
    number: int
    nonce: str
    source_sha256: str
    source_bytes: int
    source_format: str
    width: int
    height: int

    def wire(self):
        return dict(job=self.job, attempt=self.number, nonce=self.nonce,
                    source_sha256=self.source_sha256, source_bytes=self.source_bytes,
                    source_format=self.source_format, width=self.width, height=self.height,
                    profile=PROFILE, policy=POLICY)


def source_image(raw, attempt):
    if len(raw) > SOURCE_CAP:
        raise Refused("SOURCE_LIMIT")
    if sha(raw) != attempt["source_sha256"] or len(raw) != attempt["source_bytes"]:
        raise Refused("SOURCE_MISMATCH")
    kind = attempt["source_format"]
    if kind not in FORMATS:
        raise Refused("SOURCE_FORMAT")
    try:
        source_framing(raw, kind)
        image = checked_image(raw, (kind,), normalize=True)
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise Refused("SOURCE_INVALID") from exc
    if image.size != (attempt["width"], attempt["height"]):
        raise Refused("SOURCE_GEOMETRY")
    return image


def source_framing(raw, kind):
    if kind == "PNG":
        offset = 8
        while offset + 12 <= len(raw):
            size = int.from_bytes(raw[offset:offset + 4], "big")
            tag = raw[offset + 4:offset + 8]
            offset += 12 + size
            if tag == b"IEND" and size == 0 and offset == len(raw):
                return
            if tag == b"IEND":
                break
    elif kind == "JPEG":
        if raw[:2] != b"\xff\xd8":
            raise ValueError("JPEG header")
        offset, in_scan = 2, False
        while offset < len(raw):
            marker = raw.find(b"\xff", offset) if in_scan else offset
            if marker < 0 or raw[marker] != 255:
                break
            while marker < len(raw) and raw[marker] == 255:
                marker += 1
            if marker == len(raw):
                break
            tag, offset = raw[marker], marker + 1
            if in_scan and (tag == 0 or 0xD0 <= tag <= 0xD7):
                continue
            if tag == 0xD9:
                if offset == len(raw):
                    return
                break
            if tag in (0, 1, 0xD8) or 0xD0 <= tag <= 0xD7 or offset + 2 > len(raw):
                break
            size = int.from_bytes(raw[offset:offset + 2], "big")
            if size < 2:
                break
            offset += size
            in_scan = tag == 0xDA
    else:
        # The shared decoder checks the exact RIFF length and fully decodes WebP.
        return
    raise ValueError("truncated or trailing image bytes")


def validate_attempt(attempt):
    exact(attempt, ("job", "attempt", "nonce", "source_sha256", "source_bytes",
                    "source_format", "width", "height", "profile", "policy"))
    for key in ("attempt", "source_bytes", "width", "height"):
        if type(attempt[key]) is not int or attempt[key] < 1:
            raise Refused("WIRE_INVALID")
    for key, pattern in (("job", r"[a-z0-9-]{1,48}"), ("nonce", r"[a-z0-9-]{1,64}"),
                         ("source_sha256", r"[a-f0-9]{64}")):
        if type(attempt[key]) is not str or not re.fullmatch(pattern, attempt[key]):
            raise Refused("WIRE_INVALID")
    if attempt["source_bytes"] > SOURCE_CAP or attempt["width"] * attempt["height"] > PIXELS:
        raise Refused("SOURCE_LIMIT")
    if attempt["profile"] != PROFILE or attempt["policy"] != POLICY:
        raise Refused("ATTEMPT_MISMATCH")


def render(request):
    exact(request, ("attempt", "source"))
    attempt = request["attempt"]
    validate_attempt(attempt)
    raw = base64.b64decode(request["source"], validate=True)
    image = source_image(raw, attempt)
    items = []
    for size in VARIANTS:
        resized = image.resize(dimensions(*image.size, size), Image.Resampling.LANCZOS)
        resized.info.clear()
        out = io.BytesIO()
        resized.save(out, format="WEBP", quality=80)
        data = out.getvalue()
        if len(data) > OUTPUT_CAP:
            raise Refused("OUTPUT_LIMIT")
        items.append(dict(variant=size, width=resized.width, height=resized.height,
                          size=len(data), sha256=sha(data), data=base64.b64encode(data).decode("ascii")))
    return dict(attempt=attempt, items=items)


def manifest_for(expected, response):
    validate_attempt(expected)
    exact(response, ("attempt", "items"))
    if canonical(response["attempt"]) != canonical(expected):
        raise Refused("ATTEMPT_MISMATCH")
    items = response["items"]
    if type(items) is not list or len(items) != len(VARIANTS):
        raise Refused("VARIANT_SET")
    records = []
    payloads = {}
    for variant, item in zip(VARIANTS, items, strict=True):
        exact(item, ("variant", "width", "height", "size", "sha256", "data"))
        if any(type(item[key]) is not int for key in ("variant", "width", "height", "size")):
            raise Refused("VARIANT_FIELDS")
        if item["variant"] != variant:
            raise Refused("VARIANT_SET")
        if (item["width"], item["height"]) != dimensions(expected["width"], expected["height"], variant):
            raise Refused("VARIANT_GEOMETRY")
        try:
            data = base64.b64decode(item["data"], validate=True)
        except (TypeError, ValueError) as exc:
            raise Refused("VARIANT_ENCODING") from exc
        if not 0 < len(data) <= OUTPUT_CAP or item["size"] != len(data) or item["sha256"] != sha(data):
            raise Refused("VARIANT_INTEGRITY")
        records.append({key: value for key, value in item.items() if key != "data"})
        payloads[variant] = data
    manifest = dict(schema=1, profile=PROFILE, policy=POLICY,
                    source_sha256=expected["source_sha256"], variants=records)
    return manifest, payloads


def webp_structure(raw):
    if raw[:4] != b"RIFF" or raw[8:12] != b"WEBP" or len(raw) < 20:
        raise Refused("WEBP_STRUCTURE")
    if int.from_bytes(raw[4:8], "little") + 8 != len(raw):
        raise Refused("WEBP_STRUCTURE")
    tags = []
    offset = 12
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise Refused("WEBP_STRUCTURE")
        tag, size = struct.unpack_from("<4sI", raw, offset)
        start = offset + 8
        end = start + size
        offset = end + size % 2
        if offset > len(raw) or size == 0 or (size % 2 and raw[end] != 0):
            raise Refused("WEBP_STRUCTURE")
        if tag == b"VP8X" and (size != 10 or raw[start] != 0x10 or raw[start + 1:start + 4] != b"\0\0\0"):
            raise Refused("WEBP_PROFILE")
        tags.append(tag)
        if len(tags) > 3:
            raise Refused("WEBP_PROFILE")
    if tags not in ([b"VP8 "], [b"VP8L"], [b"VP8X", b"ALPH", b"VP8 "]):
        raise Refused("WEBP_PROFILE")


def verify(request):
    exact(request, ("attempt", "response", "manifest_sha256"))
    attempt = request["attempt"]
    manifest, payloads = manifest_for(attempt, request["response"])
    manifest_hash = sha(canonical(manifest))
    if request["manifest_sha256"] != manifest_hash:
        raise Refused("MANIFEST_MISMATCH")
    for record in manifest["variants"]:
        raw = payloads[record["variant"]]
        webp_structure(raw)
        try:
            with Image.open(io.BytesIO(raw), formats=("WEBP",)) as image:
                if image.n_frames != 1 or image.size != (record["width"], record["height"]):
                    raise Refused("WEBP_GEOMETRY")
                image.load()
                if any(key in image.info for key in ("exif", "icc_profile", "xmp")):
                    raise Refused("WEBP_PROFILE")
        except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise Refused("WEBP_INVALID") from exc
    return dict(attempt=attempt, manifest_sha256=manifest_hash,
                digests=[record["sha256"] for record in manifest["variants"]],
                verdict="VERIFIED_MEDIA_POLICY")


async def bounded_call(mode, raw, *, timeout=TIMEOUT):
    if len(raw) > WIRE_CAP:
        raise Refused("WIRE_LIMIT")
    # OS loader paths only. This is a subprocess boundary, not a sandbox.
    env = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "APPDATA", "USERPROFILE") if key in os.environ}
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-B", "-E", str(LAB / "pipeline.py"), mode,
        cwd=LAB, env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=65536,
    )

    async def send():
        try:
            for offset in range(0, len(raw), 65536):
                process.stdin.write(raw[offset:offset + 65536])
                await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            process.stdin.close()

    async def receive():
        received = bytearray()
        while chunk := await process.stdout.read(65536):
            received.extend(chunk)
            if len(received) > WIRE_CAP:
                raise Refused("WIRE_LIMIT")
        return bytes(received)

    send_task = asyncio.create_task(send())
    try:
        async with asyncio.timeout(timeout):
            output = await receive()
            await process.wait()
        if process.returncode != 0:
            raise Refused("CHILD_FAILED")
        response = parse(output)
        if type(response) is dict and set(response) == {"error"}:
            error = response["error"]
            raise Refused(error if type(error) is str and error in CHILD_ERRORS else "CHILD_FAILED")
        return response
    except TimeoutError as exc:
        raise Refused("CHILD_TIMEOUT") from exc
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            while await process.stdout.read(65536):
                pass
            await process.wait()
        await send_task


CHILD_ERRORS = frozenset((
    "WIRE_LIMIT", "WIRE_INVALID", "SOURCE_LIMIT", "SOURCE_MISMATCH", "SOURCE_FORMAT",
    "SOURCE_INVALID", "SOURCE_GEOMETRY", "OUTPUT_LIMIT", "ATTEMPT_MISMATCH",
    "VARIANT_SET", "VARIANT_FIELDS", "VARIANT_GEOMETRY", "VARIANT_ENCODING",
    "VARIANT_INTEGRITY", "MANIFEST_MISMATCH", "WEBP_STRUCTURE", "WEBP_PROFILE",
    "WEBP_GEOMETRY", "WEBP_INVALID", "CHILD_INVALID",
))


def call(mode, request):
    return asyncio.run(bounded_call(mode, canonical(request)))


def run_attempt(raw, attempt):
    if len(raw) > SOURCE_CAP:
        raise Refused("SOURCE_LIMIT")
    expected = attempt.wire()
    response = call("worker", dict(attempt=expected, source=base64.b64encode(raw).decode("ascii")))
    manifest, payloads = manifest_for(expected, response)
    manifest_hash = sha(canonical(manifest))
    receipt = call("verifier", dict(attempt=expected, response=response, manifest_sha256=manifest_hash))
    if canonical(receipt) != canonical(dict(attempt=expected, manifest_sha256=manifest_hash,
                                             digests=[item["sha256"] for item in manifest["variants"]],
                                             verdict="VERIFIED_MEDIA_POLICY")):
        raise Refused("VERIFIER_MISMATCH")
    return manifest, payloads


if __name__ == "__main__":
    if os.name == "posix":
        import resource

        for limit, budget in ((resource.RLIMIT_CPU, 8), (resource.RLIMIT_AS, 384 * 1024**2)):
            _, hard = resource.getrlimit(limit)
            bounded = budget if hard == resource.RLIM_INFINITY else min(budget, hard)
            resource.setrlimit(limit, (bounded, bounded))
    try:
        operation = {"worker": render, "verifier": verify}[sys.argv[1]]
        request = parse(sys.stdin.buffer.read(WIRE_CAP + 1))
        result = operation(request)
    except Refused as exc:
        result = {"error": str(exc) if str(exc) in CHILD_ERRORS else "CHILD_INVALID"}
    except (TypeError, ValueError, KeyError, OSError, IndexError, OverflowError):
        result = {"error": "CHILD_INVALID"}
    sys.stdout.buffer.write(canonical(result))
