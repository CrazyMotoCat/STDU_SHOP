# VIS-CAT-02C checkpoint

Status PREPARATION / MOCK_TESTED. Owner approved PR #52 plan at b1e6e11fc2d43823de635055aa8e16cfc56533a6, then explicitly selected code and mock preparation while the test host is unavailable.

Branch `codex/vis-cat-02c-harness` (PR #53) incorporates the approved plan with its original Git history and targets main `21f94a2a434155e5315852d1cc25e07a1f242750`. Integration requires owner merge approval for the final HEAD.

Implemented the in-memory intent/reference/fencing model and preflight predicates with controlled concurrency barriers. The [experiment README](../../../experiments/vis-cat-02c/README.md) records the test commands and the boundary between mock and runtime evidence.

Remaining prerequisite is a designated prepared separate Linux host with the approved ext4 device. Implement the resource collector and feed observed mount-source/device metadata to the tested mock binding predicate, bounded controller, real PG and storage adapters, watchdog and canary observations before running E0/E1–E5. E4b remains separately gated.

Do not repeat the 02B benchmark, change production contracts, touch OPS-TEST-02 or infer real durability/network acceptance from mock results.
