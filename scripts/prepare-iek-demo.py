"""Copy only the four owner-provided images to ignored local demo storage.
No database access, network, publication or grants. Repeatable with the same ZIP.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "apps/web/src/lib/catalog/iek-demo-data.json").read_text(encoding="utf-8"))
if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/prepare-iek-demo.py <owner ZIP>")
with zipfile.ZipFile(sys.argv[1]) as archive:
    images = []
    for product in manifest["products"]:
        for image in product["images"]:
            raw = archive.read(image["src"])
            if len(raw) != image["bytes"] or hashlib.sha256(raw).hexdigest() != image["sha256"]:
                raise SystemExit("Image does not match the verified owner archive.")
            images.append((image["src"], raw))
    for name, raw in images:
        destination = root / ".local/vis-cat-01b/media/owner-local" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
print("PASS: four verified images prepared locally; no database writes or public publication.")
