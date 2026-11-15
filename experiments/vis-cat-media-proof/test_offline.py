import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import io
import json
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

from mock_api import Catalog, Staff
from pipeline import (
    Attempt, Refused, SOURCE_CAP, VARIANTS, bounded_call, call, canonical,
    manifest_for, parse, run_attempt, sha, webp_structure,
)
from storage_proof import StorageRefused, Store

ASSET = "a" * 16
SET = "b" * 16


def fixture(fmt="PNG", *, size=(420, 220), alpha=False, animated=False):
    source = Image.new("RGBA" if alpha else "RGB", size, (245, 245, 240, 210) if alpha else (245, 245, 240))
    if size == (420, 220):
        ImageDraw.Draw(source).text((24, 36), "STDU  R1-01  24V", fill="black",
                                    font=ImageFont.load_default(size=26))
    buf = io.BytesIO()
    kwargs = {}
    if fmt == "PNG":
        info = PngImagePlugin.PngInfo()
        info.add_text("fixture", "SYNTHETIC_ONLY")
        kwargs["pnginfo"] = info
    if animated:
        kwargs.update(save_all=True, append_images=[Image.new(source.mode, size, "red")])
    source.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def attempt(raw, fmt="PNG", size=(420, 220), *, number=1):
    return Attempt("synthetic-job", number, "offline-nonce", sha(raw), len(raw), fmt, *size)


def worker(raw):
    expected = attempt(raw).wire()
    return expected, call("worker", {"attempt": expected, "source": base64.b64encode(raw).decode("ascii")})


class PipelineTests(unittest.TestCase):
    def test_synthetic_formats_alpha_and_marking_geometry(self):
        for fmt, alpha in (("PNG", True), ("JPEG", False), ("WEBP", False)):
            with self.subTest(fmt=fmt):
                raw = fixture(fmt, alpha=alpha)
                manifest, payloads = run_attempt(raw, attempt(raw, fmt))
                self.assertEqual(tuple(payloads), VARIANTS)
                self.assertEqual(manifest["source_sha256"], sha(raw))
                for item in manifest["variants"]:
                    data = payloads[item["variant"]]
                    self.assertEqual(item["sha256"], sha(data))
                    self.assertNotIn(b"SYNTHETIC_ONLY", data)
                    webp_structure(data)
                with Image.open(io.BytesIO(payloads[1200])) as output:
                    self.assertEqual(output.size, (420, 220))
                    self.assertEqual(output.mode, "RGBA" if alpha else "RGB")
                    # Synthetic contrast and orientation check, not human legibility evidence.
                    self.assertLess(min(output.convert("L").crop((24, 36, 330, 85)).getextrema()), 60)

    def test_rotated_jpeg_has_normalized_dimensions(self):
        encoded = io.BytesIO()
        image = Image.new("RGB", (90, 40), "black")
        exif = Image.Exif()
        exif[274] = 6
        image.save(encoded, format="JPEG", exif=exif)
        raw = encoded.getvalue()
        manifest, _ = run_attempt(raw, attempt(raw, "JPEG", (40, 90)))
        self.assertEqual((manifest["variants"][-1]["width"], manifest["variants"][-1]["height"]), (40, 90))

    def test_reject_malformed_oversized_animated_and_format_mismatch(self):
        png = fixture()
        jpeg = fixture("JPEG")
        cases = (
            (png[:40], "PNG", "SOURCE_INVALID"),
            (png + b"safe trailer", "PNG", "SOURCE_INVALID"),
            (png + png[-12:], "PNG", "SOURCE_INVALID"),
            (jpeg + b"trailer" + jpeg[-2:], "JPEG", "SOURCE_INVALID"),
            (b"\x00" * (SOURCE_CAP + 1), "PNG", "SOURCE_LIMIT"),
            (fixture(size=(2500, 2001)), "PNG", "SOURCE_INVALID"),
            (fixture(size=(2500, 2001)), "PNG", "SOURCE_LIMIT"),
            (fixture("WEBP", animated=True), "WEBP", "SOURCE_INVALID"),
            (png, "JPEG", "SOURCE_INVALID"),
            (fixture("GIF"), "GIF", "SOURCE_FORMAT"),
        )
        for raw, fmt, code in cases:
            with self.subTest(fmt=fmt, code=code), self.assertRaisesRegex(Refused, f"^{code}$"):
                run_attempt(raw, attempt(raw, fmt, (2500, 2001) if code == "SOURCE_LIMIT" and len(raw) <= SOURCE_CAP else (420, 220)))

    def test_child_timeout_and_crash_fail_closed(self):
        spawn = asyncio.create_subprocess_exec

        for code, reason in (("import time; time.sleep(20)", "CHILD_TIMEOUT"),
                             ("raise SystemExit(71)", "CHILD_FAILED")):
            async def replace_child(*_args, **kwargs):
                return await spawn(sys.executable, "-B", "-c", code, **kwargs)

            with patch("pipeline.asyncio.create_subprocess_exec", replace_child):
                with self.assertRaisesRegex(Refused, reason):
                    asyncio.run(bounded_call("worker", b"{}", timeout=1))

    def test_reject_digest_manifest_variant_and_stale_substitution(self):
        raw = fixture()
        expected, response = worker(raw)
        manifest, _ = manifest_for(expected, response)
        correct_hash = sha(canonical(manifest))
        with self.assertRaisesRegex(Refused, "MANIFEST_MISMATCH"):
            call("verifier", dict(attempt=expected, response=response, manifest_sha256="0"*64))
        actual = call("verifier", dict(attempt=expected, response=response, manifest_sha256=correct_hash))
        self.assertEqual(actual["manifest_sha256"], correct_hash)
        wrong = deepcopy(response)
        wrong["items"][0]["sha256"] = "0"*64
        with self.assertRaisesRegex(Refused, "VARIANT_INTEGRITY"):
            manifest_for(expected, wrong)
        wrong = deepcopy(response)
        wrong["items"][1] = wrong["items"][0]
        with self.assertRaisesRegex(Refused, "VARIANT_SET"):
            manifest_for(expected, wrong)
        wrong = deepcopy(response)
        wrong["items"][0]["width"] += 1
        with self.assertRaisesRegex(Refused, "VARIANT_GEOMETRY"):
            manifest_for(expected, wrong)
        with self.assertRaisesRegex(Refused, "ATTEMPT_MISMATCH"):
            manifest_for(attempt(raw, number=2).wire(), response)
        with self.assertRaisesRegex(Refused, "WIRE_INVALID"):
            parse(b'{"a":0,"a":0}')
        with self.assertRaisesRegex(Refused, "WIRE_INVALID"):
            parse(b'{"a": 0}')

    def test_verifier_refuses_validly_hashed_non_profile_output(self):
        raw = fixture()
        expected, response = worker(raw)
        replacement = b"synthetic non-webp artifact"
        response["items"][0].update(data=base64.b64encode(replacement).decode("ascii"),
                                    size=len(replacement), sha256=sha(replacement))
        manifest, _ = manifest_for(expected, response)
        with self.assertRaisesRegex(Refused, "WEBP_STRUCTURE"):
            call("verifier", dict(attempt=expected, response=response, manifest_sha256=sha(canonical(manifest))))

    def test_verifier_rejects_metadata_added_to_valid_webp(self):
        raw = fixture()
        expected, response = worker(raw)
        output = base64.b64decode(response["items"][0]["data"])
        extra = b"EXIF\x04\x00\x00\x00test"
        modified = output[:4] + (len(output) + len(extra) - 8).to_bytes(4, "little") + output[8:] + extra
        response["items"][0].update(data=base64.b64encode(modified).decode("ascii"),
                                    size=len(modified), sha256=sha(modified))
        manifest, _ = manifest_for(expected, response)
        with self.assertRaisesRegex(Refused, "WEBP_PROFILE"):
            call("verifier", dict(attempt=expected, response=response, manifest_sha256=sha(canonical(manifest))))


class StoreTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="vis-cat-media-proof-")
        self.addCleanup(temp.cleanup)
        self.store = Store.initialize(Path(temp.name) / "owned")
        self.data = b"synthetic proof artifact"
        self.gen = self.store.reserve("job", self.data)

    def test_duplicate_and_conflicting_requests(self):
        self.assertEqual(self.store.reserve("job", self.data), self.gen)
        with self.assertRaisesRegex(StorageRefused, "REPLAY_CONFLICT"):
            self.store.reserve("job", b"different")
        self.store.stage("job", self.gen, self.data)
        self.store.finish("job", self.gen)
        self.store.finish("job", self.gen)
        self.assertEqual(self.store.read("job", self.gen), self.data)

    def test_runner_crash_and_lost_commit(self):
        for point, status in (("promoted", "NOT_COMMITTED"), ("committed", "COMMITTED")):
            self.store.reserve(point, self.data)
            self.store.stage(point, 1, self.data)
            result = subprocess.run(
                [sys.executable, "-B", str(Path(__file__).resolve()), "crash-child",
                 str(self.store.root), point], timeout=10, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 71, result.stderr)
            restarted = Store(self.store.root)
            self.assertEqual(restarted.reconcile(point, 1), status)
            restarted.finish(point, 1)
            restarted.cleanup(point, 1, writer_stopped=True)
            self.assertEqual(restarted.reconcile(point, 1), "COMMITTED")
            self.assertEqual(restarted.read(point, 1), self.data)
            self.assertFalse(restarted.paths(point, 1)[0].exists())

    def test_crash_after_stage_before_ownership_leaves_unknown_object(self):
        self.store.reserve("staged", self.data)
        result = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).resolve()), "crash-child",
             str(self.store.root), "staged", base64.b64encode(self.data).decode("ascii")],
            timeout=10, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 71, result.stderr)
        restarted = Store(self.store.root)
        self.assertEqual(restarted.reconcile("staged", 1), "NOT_COMMITTED")
        restarted.takeover("staged", 1)
        with self.assertRaisesRegex(StorageRefused, "OBJECT_OWNERSHIP"):
            restarted.cleanup("staged", 1, writer_stopped=True)
        self.assertEqual(restarted.paths("staged", 1)[0].read_bytes(), self.data)
        restarted.stage("staged", 2, self.data)
        restarted.finish("staged", 2)
        self.assertEqual(restarted.read("staged", 2), self.data)

    def test_concurrent_generation_fencing(self):
        ready = threading.Event()
        continue_writer = threading.Event()

        def old_writer():
            self.store.stage("job", self.gen, self.data)
            ready.set()
            if not continue_writer.wait(5):
                raise AssertionError("fencing barrier")
            with self.assertRaisesRegex(StorageRefused, "STALE_GENERATION"):
                self.store.finish("job", self.gen)

        with ThreadPoolExecutor(max_workers=1) as executor:
            old = executor.submit(old_writer)
            try:
                self.assertTrue(ready.wait(5))
                new = self.store.takeover("job", self.gen)
                with self.assertRaisesRegex(StorageRefused, "WRITER_NOT_STOPPED"):
                    self.store.cleanup("job", self.gen, writer_stopped=False)
                self.store.stage("job", new, self.data)
                self.store.finish("job", new)
            finally:
                continue_writer.set()
            old.result(timeout=6)
        self.assertEqual(self.store.reconcile("job", self.gen), "FENCED")
        self.store.cleanup("job", self.gen, writer_stopped=old.done())
        self.assertFalse(any(path.exists() for path in self.store.paths("job", self.gen)))
        self.assertEqual(self.store.read("job", new), self.data)

    def test_two_concurrent_reservations_and_commits_have_one_generation(self):
        def delivery(_):
            return self.store.reserve("job", self.data)

        self.store.stage("job", self.gen, self.data)
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(list(executor.map(delivery, (1, 2))), [1, 1])
            list(executor.map(lambda _: self.store.finish("job", self.gen), (1, 2)))
        self.assertEqual(self.store.read("job", self.gen), self.data)

    def test_foreign_collision_and_addressed_cleanup(self):
        stage, final = self.store.paths("job", self.gen)
        self.store.stage("job", self.gen, self.data)
        final.write_bytes(self.data)  # equivalent bytes do not prove ownership
        with self.assertRaisesRegex(StorageRefused, "OBJECT_OWNERSHIP"):
            self.store.finish("job", self.gen)
        self.store.takeover("job", self.gen)
        with self.assertRaisesRegex(StorageRefused, "OBJECT_OWNERSHIP"):
            self.store.cleanup("job", self.gen, writer_stopped=True)
        self.assertTrue(stage.exists())
        self.assertEqual(final.read_bytes(), self.data)

    def test_database_and_storage_failure(self):
        self.store.stage("job", self.gen, self.data)
        self.store.finish("job", self.gen)
        _, final = self.store.paths("job", self.gen)
        final.write_bytes(b"corrupted")
        self.assertEqual(self.store.reconcile("job", self.gen), "UNKNOWN")
        with self.assertRaisesRegex(StorageRefused, "ARTIFACT_INTEGRITY"):
            self.store.read("job", self.gen)
        self.store.database.rename(self.store.root / "held-database")
        self.assertEqual(self.store.reconcile("job", self.gen), "UNKNOWN")
        # Losing the database must not create a replacement or remove bytes.
        self.assertEqual(final.read_bytes(), b"corrupted")
        self.assertFalse(self.store.database.exists())


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = fixture()
        cls.manifest, cls.payloads = run_attempt(raw, attempt(raw))

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="vis-cat-media-http-")
        self.addCleanup(temp.cleanup)
        self.store = Store.initialize(Path(temp.name) / "owned")
        self.now = 0
        self.catalog = Catalog(self.store, clock=lambda: self.now)
        self.asset = self.catalog.ingest_fixture(
            "sku", ASSET, SET, "rev-1", "synthetic-rights", 60, fixture(), "PNG", (420, 220),
        )
        self.path = f"/media/catalog/products/sku/{ASSET}/{SET}/{VARIANTS[0]}"
        self.preview = f"/staff/preview/sku/{ASSET}/{SET}/{VARIANTS[0]}"
        self.staff = Staff(frozenset(("catalog.products.read", "catalog.products.media.preview")), frozenset(("sku",)))

    def test_public_get_head_304_and_no_store(self):
        self.assertEqual(self.catalog.request("GET", self.path).status, 404)
        self.catalog.publish("sku", "rev-1")
        reply = self.catalog.request("GET", self.path)
        self.assertEqual(reply.status, 200)
        self.assertEqual(reply.body, self.payloads[VARIANTS[0]])
        self.assertEqual(reply.headers["Cache-Control"], "no-store")
        self.assertNotIn("private-fileversion", json.dumps(reply.headers))
        head = self.catalog.request("HEAD", self.path)
        self.assertEqual((head.status, head.body, head.headers), (200, b"", reply.headers))
        conditional = self.catalog.request("GET", self.path, etag=reply.headers["ETag"])
        self.assertEqual((conditional.status, conditional.body), (304, b""))
        self.catalog.revoke("sku", ASSET)
        denied = self.catalog.request("HEAD", self.path, etag=reply.headers["ETag"])
        self.assertEqual((denied.status, denied.body), (404, b""))

    def test_rights_revoke_and_published_revision_change(self):
        self.catalog.publish("sku", "rev-1")
        prior = self.catalog.request("GET", self.path)
        self.catalog.publish("sku", "rev-2")
        self.assertEqual(self.catalog.request("GET", self.path, etag=prior.headers["ETag"]).status, 404)
        self.catalog.publish("sku", "rev-1")
        self.assertEqual(self.catalog.request("GET", self.path).status, 200)
        self.catalog.revoke_rights("synthetic-rights")
        self.assertEqual(self.catalog.request("GET", self.path, etag=prior.headers["ETag"]).status, 404)

    def test_inflight_snapshot_precedes_revoke_new_request_denied(self):
        self.catalog.publish("sku", "rev-1")
        entered, release = threading.Event(), threading.Event()
        read = self.store.read

        def delayed(*args):
            entered.set()
            if not release.wait(5):
                raise AssertionError("request barrier")
            return read(*args)

        with patch.object(self.store, "read", delayed):
            with ThreadPoolExecutor(max_workers=1) as executor:
                prior = executor.submit(self.catalog.request, "GET", self.path)
                try:
                    self.assertTrue(entered.wait(5))
                    self.catalog.revoke("sku", ASSET)
                    self.assertEqual(self.catalog.request("GET", self.path).status, 404)
                finally:
                    release.set()
                self.assertEqual(prior.result(timeout=6).status, 200)
    def test_staff_scope_draft_preview_and_integrity_fail_closed(self):
        self.assertEqual(self.catalog.request("GET", self.preview).status, 401)
        self.assertEqual(self.catalog.request("GET", self.preview,
                             staff=Staff(frozenset(), frozenset(("sku",)))).status, 403)
        self.assertEqual(self.catalog.request("GET", self.preview,
                             staff=Staff(self.staff.permissions, frozenset(("other",)))).status, 404)
        preview = self.catalog.request("GET", self.preview, staff=self.staff)
        self.assertEqual(preview.status, 200)
        self.assertEqual(preview.headers["Cache-Control"], "private, no-store")
        self.catalog.publish("sku", "rev-1")
        _, final = self.store.paths(self.asset.variants[0].job, 1)
        final.unlink()
        for method in ("GET", "HEAD"):
            reply = self.catalog.request(method, self.path, etag=preview.headers["ETag"])
            self.assertEqual((reply.status, reply.body, reply.headers), (503, b"", {"Cache-Control": "no-store"}))

    def test_expiry_checked_before_conditional_response(self):
        self.catalog.publish("sku", "rev-1")
        initial = self.catalog.request("GET", self.path)
        self.now = 60
        self.assertEqual(self.catalog.request("HEAD", self.path, etag=initial.headers["ETag"]).status, 404)

    def test_v2_metadata_only_exposes_safe_active_identifiers_and_paths(self):
        path = "/v2/public/catalog/products/sku"
        self.assertEqual(self.catalog.request("GET", path).status, 404)
        self.catalog.publish("sku", "rev-1")
        response = self.catalog.request("GET", path)
        image, = json.loads(response.body)["images"]
        self.assertEqual(set(image), {"publicAssetId", "renditionSetId", "variants"})
        self.assertEqual(image["variants"][str(VARIANTS[0])], self.path)
        for secret in (self.asset.variants[0].job, self.asset.rights, self.asset.manifest_sha256):
            self.assertNotIn(secret.encode("ascii"), response.body)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.catalog.revoke_rights(self.asset.rights)
        self.assertEqual(json.loads(self.catalog.request("GET", path).body), {"images": []})

    def test_local_http_rechecks_origin_after_revocation(self):
        catalog = self.catalog

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                reply = catalog.request(self.command, self.path, etag=self.headers.get("If-None-Match"))
                self.send_response(reply.status)
                for key, value in reply.headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(reply.body)

            do_HEAD = do_GET

        self.catalog.publish("sku", "rev-1")
        with HTTPServer(("127.0.0.1", 0), Handler) as server:
            server.timeout = 3
            def request(method, headers=None):
                with ThreadPoolExecutor(max_workers=1) as executor:
                    served = executor.submit(server.handle_request)
                    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    try:
                        connection.request(method, self.path, headers=headers or {})
                        reply = connection.getresponse()
                        return reply.status, dict(reply.getheaders()), reply.read()
                    finally:
                        connection.close()
                        served.result(timeout=4)

            status, headers, body = request("GET")
            self.assertEqual((status, headers["Cache-Control"], body), (200, "no-store", self.payloads[VARIANTS[0]]))
            conditional = {"If-None-Match": headers["ETag"]}
            self.assertEqual(request("HEAD", conditional)[0], 304)
            self.catalog.revoke_rights("synthetic-rights")
            self.assertEqual(request("GET", conditional)[0], 404)

    def test_exact_product_asset_rendition_and_fixed_methods(self):
        self.catalog.publish("sku", "rev-1")
        for path in (self.path.replace("sku", "other"), self.path.replace(SET, "z"*16),
                     self.path.replace(ASSET, "z"*16), self.path + "?q=1", self.path + "/",
                     self.path.replace("/sku/", "/sku%2f/"), self.path.rsplit("/", 1)[0] + "/999"):
            self.assertEqual(self.catalog.request("GET", path).status, 404)
        self.assertEqual(self.catalog.request("POST", self.path).status, 405)
        self.assertEqual(self.catalog.request("GET", "/files/private-fileversion-160").status, 404)


if __name__ == "__main__":
    if sys.argv[1:2] == ["crash-child"]:
        import os
        def crash(point):
            if point == sys.argv[3]:
                os._exit(71)
        store = Store(sys.argv[2])
        if sys.argv[3] == "staged":
            store.stage("staged", 1, base64.b64decode(sys.argv[4]), checkpoint=crash)
        else:
            store.finish(sys.argv[3], 1, checkpoint=crash)
    else:
        unittest.main()
