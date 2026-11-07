# WB-LAB-01 E2 PostgreSQL CAS and generation

E1 Runtime PASS is accepted on `d1b1a3633d292e5d364e5252195340898fb2dafe`. Its three WB trials took 8.418 ms, 0.282 ms and 3.976 ms. The complete run took 7.974 s and cleanup was confirmed. Evidence SHA-256 is `ffbc52da74e6e32a6be8293376b98d6fa0cc701a99cc50cda07853929b949200`. E0b evidence remains `cb5f9c40c4dadf4e470dd2610396847b63ce130db2bcd64721d09c14d4a23255`.

**E2 status PREPARED / WB NOT_RUN / OWNER_E2_RUNTIME_APPROVED REQUIRED.**

## Scope and resources

E2 reuses the disposable PostgreSQL runner from E0b through an optional scenario callback. Existing E0b callers retain their default phase and behavior. E2 uses one new labeled PG container, two owned local volumes, synthetic sentinels and a new `wb_lab_<run-id>` database. PostgreSQL remains limited to 192 MiB, zero additional swap, 0.5 CPU and 32 PIDs, with six connections and a Unix socket. Network mode is none. The 30-second workload, independent watchdog, 10-second cleanup, write watermarks and host memory/disk preflight apply.

E0b and E1 evidence stay in their original private directories. Preflight accepts exactly those two retained run names. The entry point reads only regular root-owned mode-0600 files through nonblocking no-follow descriptors and verifies both pinned hashes. A new E2 run gets a distinct directory. Archival is unnecessary for this first E2 run.

The source SHA-256 and size for the WB SQL cases come from the current synthetic media sentinel already verified by E0b's setup. The experiment uses a disposable `e2` schema with intents, a unique reference per intent and a fixed finalization function. Row lock acquisition precedes the `clock_timestamp()` decision. The same transaction inserts the reference and marks the intent committed. SQL constraints and post-case queries check generation, hash, size, state and a single application. The command key and reference identify replay from a new connection.

## Six sequential cases

| Case                                | Required observation                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAS and hash/size denial            | Two clients contend for the same row. `pg_stat_activity` must show a Lock wait before the holder commits. One generation increment wins, the old generation affects zero rows, and wrong hash/size cannot finalize. |
| Expiry after row-lock wait          | The holder sets expiry while the contender is blocked. After release, transaction start is older than expiry and the decision clock is later. The result must be EXPIRED.                                           |
| Generation and owner fencing        | After takeover, the old generation/owner is denied. The new owner commits once and the old owner cannot replay that reference.                                                                                      |
| Lost COMMIT response                | The client sends COMMIT without consuming its reply. Another connection queries the durable reference, then retries. The result is REPLAY with one application. Conflicting keys and payloads are denied.           |
| Constraint rollback and recovery    | A CHECK violation is caught in a controlled SQL subtransaction. State is unchanged, and a subsequent valid operation succeeds. Unexpected SQL errors stop the series.                                               |
| Decision followed by delayed COMMIT | A synthetic one-second lease is valid at the locked decision. A 1.05-second delay passes expiry before COMMIT. Replay confirms the result. This records the approved decision-time boundary.                        |

Lock tests use observed database barriers. The final case deliberately delays COMMIT to measure that separate boundary. Short fixture lease values affect only the synthetic test row. Default fixture expiry is 240 seconds. Evidence includes case timings, blocked-query timings, barrier polls, transaction/decision/expiry timestamps, database version, hash and reference count. Blocked-query timings include client and SQL processing in addition to lock wait.

## Verification and execution gate

Offline tests cover approval before provisioning, retained-file hashes/modes/symlinks/FIFO, client EOF/deadlines and payload validation. The opt-in SQL test runs all six cases on a separately identified local/CI PostgreSQL 18.6 container with synthetic tmpfs data, network none and the same PG resource limits. It checks ownership before cleanup and preserves pre-existing Docker inventory. CI acquires only its explicit amd64 test digest. The WB image stays the existing approved ARM64 digest.

After an independent review and successful local checks, FAST/FULL verify the completed implementation. The owner must separately authorize WB execution on that reviewed HEAD. The one-shot command is `python3 -B experiments/wb-lab-01/runtime_e2.py OWNER_E2_RUNTIME_APPROVED`. A successful WB run requires all six SQL cases, unchanged sentinel hashes, a healthy watchdog, final state checks, verified writer removal and removal of both owned volumes. Failure produces a blocked result and retained evidence. A second E2 invocation is blocked by the extra run directory.

E3–E5 remain NOT_RUN. VDS equivalence and production durability remain NOT_PROVEN. This task ends at E2 preparation because its current owner instruction requires a separate E2 runtime authorization.
