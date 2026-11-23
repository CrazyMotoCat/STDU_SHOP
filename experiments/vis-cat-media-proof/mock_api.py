"""Transport-free mock routes. All authorization facts are synthetic."""

from dataclasses import dataclass, replace
import re
import threading
import time
from uuid import uuid4

from pipeline import Attempt, canonical, run_attempt, sha
from storage_proof import StorageRefused

PUBLIC = re.compile(r"/media/catalog/products/([a-z0-9-]{1,48})/([a-z0-9]{16})/([a-z0-9]{16})/([1-9][0-9]{1,3})")
STAFF = re.compile(r"/staff/preview/([a-z0-9-]{1,48})/([a-z0-9]{16})/([a-z0-9]{16})/([1-9][0-9]{1,3})")
PUBLIC_PRODUCT = re.compile(r"/v2/public/catalog/products/([a-z0-9-]{1,48})")


@dataclass(frozen=True)
class Staff:
    permissions: frozenset
    products: frozenset


@dataclass(frozen=True)
class Variant:
    name: int
    job: str
    generation: int
    size: int
    sha256: str


@dataclass(frozen=True)
class Asset:
    product: str
    asset: str
    rendition: str
    revision: str
    variants: tuple
    rights: str
    rights_until: float
    manifest_sha256: str
    revoked: bool = False


@dataclass(frozen=True)
class Reply:
    status: int
    headers: dict
    body: bytes = b""


def deny(status, **headers):
    return Reply(status, {"Cache-Control": "no-store", **headers})


class Catalog:
    def __init__(self, store, *, clock=time.time):
        self.store = store
        self.clock = clock
        self._assets = {}
        self._published = {}
        self._revoked_rights = set()
        self._lock = threading.RLock()

    def ingest_fixture(self, product, asset_id, rendition, revision, rights, rights_until,
                       raw, source_format, dimensions):
        attempt = Attempt(uuid4().hex, 1, uuid4().hex, sha(raw), len(raw),
                          source_format, *dimensions)
        key = (product, asset_id)
        with self._lock:
            if key in self._assets:
                raise ValueError("ASSET_EXISTS")
            manifest, payloads = run_attempt(raw, attempt)
            records = []
            for item in manifest["variants"]:
                name = item["variant"]
                job = f"{attempt.job}-{name}"
                generation = self.store.reserve(job, payloads[name])
                self.store.stage(job, generation, payloads[name])
                self.store.finish(job, generation)
                self.store.cleanup(job, generation, writer_stopped=True)
                records.append(Variant(name, job, generation, item["size"], item["sha256"]))
            asset = Asset(product, asset_id, rendition, revision, tuple(records), rights,
                          rights_until, sha(canonical(manifest)))
            self._assets[key] = asset
        return asset

    def publish(self, product, revision):
        with self._lock:
            self._published[product] = revision

    def revoke(self, product, asset):
        with self._lock:
            key = (product, asset)
            self._assets[key] = replace(self._assets[key], revoked=True)

    def revoke_rights(self, evidence):
        with self._lock:
            self._revoked_rights.add(evidence)

    def _eligible(self, asset, now):
        return (not asset.revoked and self._published.get(asset.product) == asset.revision
                and asset.rights and asset.rights not in self._revoked_rights
                and now < asset.rights_until)

    def _product_media(self, method, product):
        with self._lock:
            now = self.clock()
            if not self._published.get(product):
                return deny(404)
            images = [
                dict(publicAssetId=asset.asset, renditionSetId=asset.rendition,
                     variants={str(item.name): f"/media/catalog/products/{product}/{asset.asset}/{asset.rendition}/{item.name}"
                               for item in asset.variants})
                for asset in self._assets.values()
                if asset.product == product and self._eligible(asset, now)
            ]
        body = canonical({"images": images})
        return Reply(200, {"Content-Type": "application/json", "Cache-Control": "no-store",
                           "Content-Length": str(len(body))}, body if method == "GET" else b"")

    def request(self, method, path, *, staff=None, etag=None):
        if method not in ("GET", "HEAD"):
            return deny(405, Allow="GET, HEAD")
        if len(path) > 150:
            return deny(404)
        if product := PUBLIC_PRODUCT.fullmatch(path):
            return self._product_media(method, product[1])
        route = PUBLIC.fullmatch(path)
        is_staff = route is None
        if is_staff:
            route = STAFF.fullmatch(path)
        if route is None:
            return deny(404)
        product, asset_id, rendition, variant = route.groups()
        if is_staff:
            if staff is None:
                return deny(401)
            if not {"catalog.products.read", "catalog.products.media.preview"} <= staff.permissions:
                return deny(403)
            if product not in staff.products:
                return deny(404)
        with self._lock:
            asset = self._assets.get((product, asset_id))
            if not asset or asset.rendition != rendition or asset.revoked:
                return deny(404)
            if not is_staff and not self._eligible(asset, self.clock()):
                return deny(404)
            selected = next((item for item in asset.variants if item.name == int(variant)), None)
        if not selected:
            return deny(404)
        try:
            data = self.store.read(selected.job, selected.generation)
            if len(data) != selected.size or sha(data) != selected.sha256:
                return deny(503)
        except StorageRefused:
            return deny(503)
        tag = f'"sha256-{selected.sha256}"'
        cache = "private, no-store" if is_staff else "no-store"
        if etag == tag:
            return Reply(304, {"ETag": tag, "Cache-Control": cache})
        return Reply(200, {"ETag": tag, "Cache-Control": cache, "Content-Type": "image/webp",
                           "Content-Length": str(len(data)), "X-Content-Type-Options": "nosniff"},
                     data if method == "GET" else b"")
