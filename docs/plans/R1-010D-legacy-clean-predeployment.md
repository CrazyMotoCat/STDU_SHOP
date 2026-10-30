# R1-010D legacy CLEAN pre-deployment safety plan

Status: production readiness blocked; no production database has been inspected or modified.

1. Before any deployment, an authorized operator must perform read-only inventory of every `inquiry_source_document` with `safety_state = 'CLEAN'`, including source ID, creation time, provenance and associated scan-job/audit metadata. Do not export document bytes, capability values or customer details into logs.
2. Trace each row to the scanner version, signature set, job, source digest, timestamps and audit history. Missing or ambiguous provenance is untrusted; the absence of a job or an old CLEAN flag does not imply complete scanning.
3. Until a separately approved remediation and download-access policy is applied, do not deploy or enable the download path where untrusted legacy CLEAN rows exist. On an isolated disposable database, reproduce that the existing terminal CLEAN state remains downloadable under the old policy; do not claim that the new finalize guard repairs it.
4. Review the inventory with the owner and security. If safe quarantine or access revocation requires changing terminal transitions or access behavior, prepare a versioned contract amendment and an audited, reversible migration plan for explicit approval. Never bulk-update production state under this task.
5. Only after approved remediation, validate that untrusted originals cannot be downloaded, retain originals and audit provenance, and confirm recovery and access with controlled synthetic fixtures. Functional re-enablement of CLEAN additionally requires a separately approved completeness policy and DB migration.
