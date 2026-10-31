# R1-010D Signature Freshness Operational Risk

Status: proposal for owner and security review; no policy change or deployment authorized.

The current frozen rule requires the loaded ClamAV signature database to be at most 24 hours old. The newest officially offered database can remain unchanged beyond that threshold; “up to date” therefore does not imply readiness. The observed 2026-10-30/31 interval is one occurrence, not a measured update-frequency distribution. No reliable frequency or weekend/holiday SLA has been established; measure over a representative period using official update metadata before forecasting availability.

When the threshold is exceeded, readiness fails closed. New jobs remain unclaimed, existing claimed work is subject to the existing retry/fencing rules, and documents remain private and unavailable until a permitted terminal result. The independent completeness gates still prohibit CLEAN. This may interrupt document processing over weekends or holidays even when FreshClam and the network are healthy.

Monitor daemon-loaded VERSION and timestamp, disk versus loaded database version, update attempt and verification results, age and readiness, worker queue age and retries, resource probe, and quarantined backlog. Alert before the threshold and on stale signatures, update/signature failures and prolonged backlog; avoid publishing sensitive source data. Distinguish latest-available-but-stale from DNS, CDN, signature verification, reload and clock failures.

Possible future owner-reviewed policies include retaining the fixed age with explicit availability expectations, setting a different approved maximum, or a separately specified policy combining verified official latest metadata with an absolute maximum age. Each has distinct threat and availability tradeoffs and requires an explicit FROZEN contract amendment, security analysis, telemetry, rollback, and runtime tests; no alternative is adopted here.

CI should retain a real scanner acceptance job with genuine current upstream signatures and report an external dependency failure honestly. Separate deterministic stale/fresh protocol and state-machine tests can diagnose behavior without counting as real ClamAV acceptance. Never alter clocks, metadata, attestation, readiness or the CLEAN gates to obtain a green result.
