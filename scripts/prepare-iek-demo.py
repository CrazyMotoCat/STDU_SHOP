"""Verify four owner-approved static images; optionally restore them from the owner ZIP.
No database, network, local demo storage or publication workflow changes.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "apps/web/src/lib/catalog/iek-demo-data.json").read_text(encoding="utf-8"))
if len(sys.argv) > 2:
    raise SystemExit("Usage: python scripts/prepare-iek-demo.py [owner ZIP]")
archive = zipfile.ZipFile(sys.argv[1]) if len(sys.argv) == 2 else None
try:
    for product in manifest["products"]:
        for image in product["images"]:
            destination = root / "apps/web/public" / image["publicSrc"].lstrip("/")
            raw = archive.read(image["src"]) if archive else destination.read_bytes()
            if len(raw) != image["bytes"] or hashlib.sha256(raw).hexdigest() != image["sha256"]:
                raise SystemExit("Static image differs from the owner manifest.")
            if archive:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(raw)
            print(image["publicSrc"], image["sha256"])
finally:
    if archive:
        archive.close()
print("PASS: four static WebP files verified; no database or grants.")
