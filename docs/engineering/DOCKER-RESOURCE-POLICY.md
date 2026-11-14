# Docker resource ownership and cleanup

Status PROPOSED / REVIEW_REQUIRED. Task DOCKER-CLEANUP-POLICY-01. Effective for new tasks after explicit owner approval. Existing scripts are inventoried in [the compatibility review](DOCKER-RESOURCE-COMPATIBILITY.md). This change supplies instructions and a [ledger template](DOCKER-RESOURCE-LEDGER.template.json).

## Creation and identity

Record the selected context and the effective endpoint, including CLI context/host overrides, DOCKER_CONTEXT and DOCKER_HOST where applicable. Record the daemon ID from that connection. If connection identity is unavailable or changes during a run, stop new operations and preserve the ledger for reconciliation. Redact credentials in connection URLs, environment values and inspect output.

Use a random run ID and an isolated Compose project name. Recommended labels are stdu.task.id and stdu.run.id, set explicitly on disposable containers and owned networks/volumes where supported. A Compose project label supplements the ledger. Names, prefixes and labels do not independently establish ownership.

Before a create request, persist the intended resource type, expected name, labels and run identity. Immediately persist the ID returned by the daemon. If the client loses the response, inspect the intended identity, match labels and ownership, and retain an unresolved entry if creation may still complete. Do not treat an empty inventory after interrupted creation as proof of successful cleanup.

Record images with exact image ID and digest, whether created or reused, and the tasks that still need them. Record volumes with exact name, labels, driver and creation identity because Docker volumes have no container-style immutable ID. Record no password, token, DB URL or raw secret-bearing inspect document. Keep the real ledger in a task-private evidence directory, never in a shared template. The template is illustrative, not an executable cleanup plan or a validated schema: populate resources with container entries; use volumes, networks and images for their respective entries, repeating the creation, retention and cleanup fields. For volumes use name/driver/labels/creation identity instead of an immutable ID; for images include ID/digest, created-or-reused and outstanding references. Empty arrays mean none only after reconciliation. Replace every placeholder and unknown value before claiming CONFIRMED.

## Cleanup lifecycle

The run supervisor owns cleanup even when setup fails partway. Execute bounded cleanup in finally/defer and handle normal SIGINT/SIGTERM. Preserve the original test error as well as any cleanup error. Repeated signals, hard process termination and power loss can interrupt cleanup, so persist the ledger as resources are created.

Before each destructive operation, reconnect to the recorded daemon and revalidate the exact resource, labels, run and retention state. Stop new work first, prove writers/owned processes are quiescent, then stop and remove only disposable resources within the allowlist. Handle created and exited containers as well as running containers. A failed stop can coincide with a normal exit, so inspect the exact ID before deciding the next action.

Assign a finite workload budget and separate stop and removal budgets under one overall monotonic cleanup deadline. Record those budgets before starting. No universal number is prescribed for existing tests. Preserve the tested VIS-CAT-02B cleanup budget when reusing that runner. Poll only within the remaining budget.

After removal, inspect each exact ID. Accept only an explicit resource-not-found response from the expected healthy daemon as absence. Authentication failure, timeout, connection failure and unparseable output mean CLEANUP_UNCONFIRMED. Rechecking by a reusable name alone is insufficient for containers/networks. Never delete a replacement resource that reused a name.

Save sanitized test evidence before removing disposable resources. If shutdown or ownership is uncertain, stop subsequent jobs, report known IDs/names and retain data/evidence for recovery. On the next invocation reconcile this task's previous ledger. Ask the owner when safe removal cannot be established.

## Protected resources

Preserve permanent environments, OPS-TEST-02, WB-LAB-01, foreign resources, bind-mounted data and resources with uncertain ownership. This policy grants no removal authority for those resources. Never remove a host bind path as a side effect of container cleanup.

Stopped containers may still belong to retained environments or ongoing investigations. Verify purpose before removal. OPS/WB resources cannot be swept as stale test leftovers.

Remove a disposable image only by its recorded ID after checking all container references and other tasks' usage. Preserve shared base images and pinned digests until their trials finish. Build cache needs separate maintenance approval. Do not use global docker system prune, docker volume prune or docker image prune -a. A generic Compose down, --remove-orphans or down -v is not an ownership check. Any cleanup helper must respect the exact allowlist and volume exclusions.

## Volume retention

Record one classification in `retention.volume_class` for each volume:

| Class            | Decision                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETAINED`       | Preserve permanent PostgreSQL/Redis volumes, volumes used by retained environments, shared or external volumes, and volumes containing required evidence. |
| `DISPOSABLE_LAB` | Eligible for scoped cleanup only when all identity, authorization, quiescence and evidence checks below pass.                                             |
| `UNCLASSIFIED`   | Preserve until the volume's purpose, authorization and ownership are established. This is the default.                                                    |

The owner must explicitly authorize removal of the run's disposable volumes before creation. Record the authorization reference and approved scope in the ledger, then bind the authorization to each exact creation record. A named PostgreSQL or Redis volume can qualify when it was newly created exclusively for that approved disposable laboratory run. Test success, a service name, a project label and a matching prefix confer no deletion authority.

Before removal, require the same daemon, the exact recorded volume name, driver, labels and creation identity, a confirmed new volume from this run, no attached container or active writer, and saved required evidence. Confirm that no protected, shared or external classification applies. The stricter rule controls when classifications conflict. If a check is missing or inconclusive, preserve the volume and report the reason. Verify removal on the same daemon. A volume reappearing under the same name requires reconciliation and must be left untouched.

## Task report

Include DOCKER RESOURCE REPORT with the effective host/context/daemon, Task ID/RUN_ID, created containers, volumes, networks, images, cleanup attempts and confirmed results, residual resources and the evidence that foreign resources were untouched.

Use DOCKER_RESOURCES: NOT_USED when no Docker operation occurred. Use DOCKER_CLEANUP: CONFIRMED only after removal and verification of disposable run resources. Use BLOCKED when resources remain, including explicitly retained created resources, and identify the retention decision. Use NOT_VERIFIED when verification was not performed. Uncertain cleanup must never become CLEANUP PASS.

For a task operating an intentionally retained environment, describe its health and retention scope separately. That environment's working state is not evidence of disposable cleanup.

## Minimal verification for policy adoption

Review the ledger for typed identity, retention, budgets, no secrets and per-resource verification. Validate the JSON template syntax and format changed documents. No Docker or application test is needed for this documentation change.

When adapting a runner later, add targeted tests for success, partial create, timeout, SIGINT/SIGTERM, daemon unavailable, mismatched labels/IDs, retained resources, stop/removal failures and created/exited containers. Tests must distinguish explicit absence from inability to inspect. A targeted disposable Docker proof may be used when authorized, without rerunning the entire workload solely for cleanup acceptance.
