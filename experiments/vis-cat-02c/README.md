# VIS-CAT-02C plan and mock preparation

The owner approved the plan at `b1e6e11` in PR #52 and selected mock preparation pending a separate Linux/ext4 test host. PR #53 combines the [plan](../../docs/plans/VIS-CAT-02C-plan.md), [run conditions](../../docs/plans/VIS-CAT-02C-owner-approval.md) and the in-memory reference model. The model and preflight functions work with synthetic fixtures without provisioning resources.

Run from the repository root with Python 3.14:

```powershell
python -B experiments/vis-cat-02c/run_mocks.py
python -B -m unittest discover -s experiments/vis-cat-02c -p test_models.py -v
```

The runner emits `MOCK_ONLY` evidence on stdout and test diagnostics on stderr. In this slice E0, E1–E3, E3b, E4a and E5 remain `NOT_RUN`, E4b remains `BLOCKED`, and the target filesystem match remains `NOT_PROVEN`. Runtime evidence for WB-LAB-01 is tracked separately in PR #54.

## Prepared code

`preflight.py` evaluates normalized host/resource metadata supplied by a future collector. It checks the explicitly approved context/daemon/device/kernel, ext4/mount flags, free-space watermark, exact creation ledger and label, new resource ownership, mount/network allowlists and per-container limits. E0b separately checks sentinel values, the isolated database name, experimental table set and restricted role flags. Worker/verifier profiles accept only network-none execution, no volume access and no credential environment.

The collector remains to be implemented and independently reviewed on the prepared host. An evaluator accepting a synthetic metadata fixture does not establish real network isolation, authentic metadata, empty volumes, exclusive ownership or total disk capacity. Runtime image configuration, PostgreSQL readiness, volume device paths and positive/negative network canaries still require actual observation.

`model.py` simulates intent-before-write, exclusive stage creation, sync-before-promotion, no-replace installation, reference commit, exact retry, expiry at the decision point, generation fencing, cleanup after modeled writer quiescence and preservation of registered or foreign keys. Fault injection covers write/sync/promotion/commit boundaries. Ordered thread barriers test both commit-versus-fence outcomes. The in-memory lock and fake durability set represent the intended transaction and filesystem ordering. They do not establish PostgreSQL row-lock behavior, real fsync durability or immutability of an ext4 object.

## Remaining implementation and measurements

When the host is designated, build the bounded Docker lifecycle controller by reusing the reviewed VIS-CAT-02B ID/label/deadline cleanup path. Add raw metadata collection and independent inspection, real disposable PostgreSQL transactions with statement/lock deadlines, E0b sentinel creation, the owned-volume writer/reconciler and bounded external watchdog. These operations must be tested as one isolated path before E1–E5 can receive runtime PASS. No runtime entry point is present in this preparatory slice.

Before target execution, provide the approved context/daemon identity, the empty 4 GiB ext4 device and mount details, and target-environment information for comparison. Observe C0 after failures and preserve resources whenever cleanup ownership or writer termination is uncertain. E4b and host-impacting operations remain separate owner decisions. Production contracts and deployment are outside the experiment.

The mock binding predicate joins the media mount source to the approved device UUID and number. The live collector that obtains and authenticates these observations remains unimplemented. The model reports UNKNOWN when the database cannot answer a commit inquiry. It reports COMMITTED only after checking the recorded reference, and distinguishes a pending attempt from a fenced or unknown generation. Modeled cleanup requires ownership, exact generation, quiescence and a shared deadline.

## Integration

PR #53 requires FAST, FULL and the merge gate on the combined revision, followed by owner merge approval for that SHA. After a merge commit, verify that `b1e6e11fc2d43823de635055aa8e16cfc56533a6` is an ancestor of `origin/main` before closing PR #52 as integrated.
