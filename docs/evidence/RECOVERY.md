# Explicit interrupted-transaction recovery

Implemented on 2026-10-11 in `src/core/recovery.ts`. The API is:

```ts
await recoverProject(source); // equivalent to 'inspect'; read-only
await recoverProject(source, "finish");
await recoverProject(source, "rollback");
```

Call it directly, **outside `withProject`**. Recovery acquires its own project
and state locks. Inspection returns the transaction kind, validated journal,
current state phase/revision, file existence/size/SHA-256 evidence, lock owner
evidence, available safe actions and diagnostics. Finish and rollback are
deliberate operations; neither runs automatically on opening a project.

## Shared safety boundary

- Journal paths must exactly match the source project's generated output,
  transaction-specific staging and `.qbento/history/` paths. Absolute paths do
  not grant permission to restore arbitrary files. Invalid path patterns,
  symlink files/parents, unsupported versions and corrupt state envelopes
  refuse.
- Recovery holds `operation.lock` and `write.lock`. Existing locks are released
  only when signal-zero process inspection returns the explicit `ESRCH` result.
  A live PID, malformed/missing owner, permission denial, unavailable process
  inspection or other ambiguity blocks mutation. Inspection never releases
  locks.
- Confirmed dead lock directories are archived with owner metadata before new
  recovery locks are acquired. Locks and all file/state evidence are checked
  again after acquisition; changed evidence refuses action.
- No-clobber hard links publish restored files. Existing concurrent output or
  source changes are retained, never silently replaced. Files moved during a
  race are preserved in history and restored without clobbering a replacement.
- Original output/source backups, staged bytes, replaced state envelopes and the
  exact transaction journal are retained. Completed journals move into history.
  Recovery is intentionally conservative about evidence it cannot verify.
- All state replacement uses durable temporary files. The project, state and
  history directories are fsynced on Unix. This validates Linux filesystem
  behavior, not arbitrary storage hardware, power-loss behavior or Windows/macOS
  support.

## Render journal

Supported journal v1 fields are `staging`, `backup`, `output`, `oldRevision`,
`nextRevision`, `sha256` and `previousOutput`, matching `renderProject`.

| Interrupted stage                                  | Finish                                                  | Rollback                                              |
| -------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Journal written, original output present           | Refuse: next source baseline not committed              | Keep original and old state                           |
| Original output moved to backup, old state remains | Refuse: next source baseline not committed              | Restore original and keep old state                   |
| Next state committed, staged output not published  | Publish staged output after receipt/document validation | Restore prior output and exact prior state            |
| Output published, staging still present            | Validate and finish                                     | Preserve generated output; restore prior output/state |
| Staging removed, active journal remains            | Validate published output and finish                    | Restore prior output/state                            |

A render journal contains merged HTML but **does not contain the next generated
baseline/provenance**. When state is still at `oldRevision`, deriving a new
source baseline from that HTML would corrupt the distinction between pending
edits, visual overrides and executed content. `finish` therefore refuses with
`RECOVERY_STATE_NOT_COMMITTED`; `rollback` followed by a fresh render is the
safe route. No computation is run by recovery.

When state is at `nextRevision`, its emitted document and receipt must match the
staged/published HTML. Rollback requires a checksum-valid `state.previous.json`
with the exact old revision, identity and previous output receipt. Later state
revisions block rollback. First-render rollback archives revision one and
removes the newly created active state; it never invents a previous project.

If render preserved concurrent native edits in its backup, rollback restores
those bytes and keeps the prior state receipt. The ordinary capture guard then
requires explicit native capture before another render.

## Source synchronization journal

Supported sync journal v1 fields are `transactionId`, `source`, `sourceBackup`,
`stateBackup`, `staging`, `receiptPath`, `sourceHash`, `resultHash`,
`stateRevision`, `planHash` and `selectedChangeIds`, matching `applySync`.

The state backup must be a checksum-valid exact baseline envelope. Current state
must equal that baseline, allowing only a one-step revision increment. Pending
edits, provenance, design and generated/emitted baselines may not have otherwise
changed. Recovery refuses later user edits.

Finish validates or publishes the reviewed source result, advances only the
state revision when necessary, and writes the exact successful `SyncReceipt`.
Existing receipts must match byte-independent JSON content. Rollback restores
the original source backup and baseline state. A preexisting successful receipt
remains in history as transaction evidence. Pending edits are retained in both
directions; subsequent rendering confirms source changes through normal merge
rules.

Both finish and rollback cover interruption after journal creation, source
backup, source publication, state revision commit, receipt creation and staging
removal. Coexisting render and sync journals refuse with
`MULTIPLE_RECOVERY_TRANSACTIONS`; the tool does not guess their order.

## Reproducible evidence

```sh
deno check src/core/recovery.ts
deno lint src/core/recovery.ts tests/recovery_test.ts
deno test --allow-read --allow-write --allow-env --allow-run tests/recovery_test.ts
```

The 29 tests inject all render and sync transaction stages listed above and
check finish/rollback invariants, absent source during sync, first-render
rollback, unchanged pending state, concurrent output/source preservation, later
revision refusal, confirmed-dead versus live/ambiguous locks, malicious journal
scope, symlink parents, changed staging, corrupt recovery envelopes and
mismatched sync receipts. These are synthetic crash-stage and real Linux
filesystem checks, not power-loss injection or cross-platform packaging
evidence.

## Approved native-creation metadata

Source sync can optionally stage a checksum-protected approval envelope through
`approvalStaging` (the exact transaction's `history/sync-approval-UUID.json`)
and `approvalPath` (`.qbento/sync-approved.json`). Recovery invokes the shared
approval validator, then binds its document ID, result-source hash, next
revision, plan hash and exact ordered pending records to this sync journal and
baseline.

Sync finish publishes that approval without clobbering another approval, after
source/state completion and before the success receipt. Rollback archives an
active approval only when its bytes match the preserved stage. Missing stages,
foreign active approval, inconsistent expected edits and unsafe paths refuse.

Render journals may additionally contain `approval: {path, sha256, archive}`,
where `archive` is a scoped `history/consumed-sync-UUID.json` path. Finish
consumes only that exact active approval, preserving its archive. Rollback to
the pre-render state preserves or restores the same approval without clobbering
another file, so the still-pending creation can be promoted on the next render.
This covers interruption after publication but before approval cleanup or
active-journal removal.

The extended suite now has **43 passing recovery tests**, including the six sync
stages with creation approval, published/unpublished approval rollback,
mismatched approval defenses, and render finish/rollback before/after approval
archival.
