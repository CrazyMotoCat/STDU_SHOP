# VIS-CAT-01B — local IEK ARMAT demo

Two real identities: `AR-M06N-1-C006`, `AR-B06S-1N-C06C030`.

## Boundary

Demo-only Next.js media allowlist, not Product Media V2 or a publication mechanism. Frozen V1 responses are unchanged. No database, grants, audit changes, seeds, upload endpoints, worker or production deployment. Current Staff test setup requires privileged role fixtures; this task uses a loopback public API fixture instead of bypassing publication/RBAC gates. Fixture responses are not evidence of a published database product.

Real photos stay under ignored `.local/vis-cat-01b/media/owner-local/`. `PUBLICATION_RIGHTS_APPROVAL_REQUIRED`: copyright/public distribution rights are not confirmed. Do not add photos or real-photo screenshots to a public repository or public test domain without separate owner authorization. Attribution is not a license. CI uses only the explicitly synthetic WebP fixture embedded in the data manifest.

## Reproduce locally

From this worktree, using the pinned toolchain:

```powershell
pnpm install --frozen-lockfile
python scripts/prepare-iek-demo.py 'C:\Users\mvideo\Downloads\STDU_SHOP_IEK_ARMAT_demo_verified_v2.1.zip'
pnpm --filter @stdu/web build
node scripts/iek-demo-preview.mjs
```

The preview prints an ephemeral **127.0.0.1** catalog URL. It owns its Next process and fixture HTTP server; Ctrl+C stops them. No Docker or shared ports are used. `--synthetic` is available without the owner archive. The import checks the four pinned hashes before copying; repeated runs replace only these task-owned files. Stable fixture arrays contain exactly two unique SKU identities; nothing persists to a database.

For screenshot/browser acceptance:

```powershell
$env:CATALOG_DEMO_MEDIA_MODE='owner-local'
pnpm catalog:ui:smoke
```

Without this override the smoke prepares synthetic fixtures. Owner screenshots: `artifacts/verification/VIS-CAT-01B/owner-local/`; synthetic screenshots: sibling `synthetic/`. Both are local artifacts, excluded from the task commit.

## Media behavior

`APP_ENV` must be exactly `development` or `test`, and `CATALOG_DEMO_MEDIA_MODE` exactly `owner-local` or `synthetic`. Default/production/malformed configuration returns no demo media. No live environment flags are changed.

The server registry requires exact brand **IEK**, manufacturer **IEK**, and one of the two factory part numbers. File selection uses four fixed keys, never caller-provided paths or external URLs. Bytes must match the selected mode's pinned SHA-256; missing/corrupt files return a placeholder/404. The narrowly scoped Next route responds `private, no-store`, `nosniff`, `noindex, nofollow`; it cannot download FileVersion objects. It does not confer authorization or production media readiness.

Main and composite group views retain original proportions and pixels. The two native buttons expose pressed state and keyboard operation. Failed images fall back safely; unrelated products retain the existing placeholder. Table columns are unchanged.

## Data provenance

`apps/web/src/lib/catalog/iek-demo-data.json` preserves the owner manifest v2.1, exact URLs, image hashes, and evidence tier per attribute; only a clearly synthetic CI fixture is added. The supplied source statements are retained, not represented as a new independent verification.

- M06N: 20 attributes marked `manufacturer`; notably 400 V, 6 kA (EN 60898).
- B06S: six core attributes marked `manufacturer`; 14 extended attributes marked `distributor_same_sku`, including **230 V and 6 kA**. Do not call these manufacturer-verified.
- `NOT_VERIFIED` is not upgraded to a confirmed tier. No price, stock, warranty or partnership is invented; both prices remain “Цена по запросу”.

Fixture conversion preserves booleans, integer values, decimal strings as required by V1, units, and all 20 attributes. Sources/tier appear in a collapsible section on demo product pages. Main/group are two complete images; group is never split into invented views.

## Delivery

REVIEW_REQUIRED / Draft PR / NO_MERGE / NO_DEPLOY. No VIS-CAT-02B or changes to PR28/36/37/38, Quality, frozen contracts, migrations or RBAC. Owner visual approval and separate photo-publication decision remain outstanding.
