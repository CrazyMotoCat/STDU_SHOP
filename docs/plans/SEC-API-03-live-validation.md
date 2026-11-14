# SEC-API-03 synthetic HTTPS validation

Status: implementation for review. Live traffic requires separate owner approval. The existing SEC-API-02 mock worker and L0 remain authoritative for application runtime.

## Boundary

The standalone command accepts only `comma-csv` and `semicolon-csv`. Both files are generated from fixed strings in source. The command cannot read an arbitrary file, lookup an inquiry or access private storage. The two CSV variants are intentional initial coverage. PDF and XLSX are outside this live campaign.

The adapter uses the fixed Advanced endpoint on `api.cloudmersive.com:443`, direct TLS 1.2 or later, Node's bundled roots and standard hostname verification. It uses no ambient HTTP proxy, follows no redirects, sets a 15-second absolute deadline and caps the response at 128 KiB. The command emits only a normalized outcome or a generic error. The test key is supplied to that process as `CLOUDMERSIVE_TEST_API_KEY`.

## Live plan after explicit authorization

1. Confirm the exact reviewed SHA, authorized test account, Portal quota, endpoint access and region suitability. Record the starting quota. Use one private worktree and one ledger for the campaign. No key or approval flag in global environment, CI, shell history or reports.
2. Build the API. In an isolated process environment set `APP_ENV=development`, `NODE_ENV=test`, and `SEC_API_03_LIVE_APPROVAL=approved-synthetic-only`. Supply the test key through the approved local secret procedure. Run `node apps/api/dist/scan-worker/cloudmersive-live-main.js comma-csv`.
3. Record outcome and reconcile actual Portal usage. Continue with `semicolon-csv` only if the first verdict is coherent and quota is confirmed. Treat every reservation as potentially charged. Authorization, throttle, timeout, threat or uncertain response ends the campaign.
4. Clear the process environment and retain the ignored `.local/sec-api-03-ledger` and redacted result for review. Any interruption leaving an active lock requires investigation. Keep reservations and halt markers intact. The cap is two attempts within this one worktree ledger, with no retries and one in-flight request. This local ledger cannot enforce provider-account limits across other worktrees or clients.

A coherent provider response is candidate evidence only. The standalone command performs no database finalization, and its result grants no download access. No live request was needed for the local verification.
