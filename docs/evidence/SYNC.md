# Authored text sync: reviewed patches and recoverable transactions

Implementation evidence recorded 2026-10-11, Linux, Deno 2.9.6.

`src/core/sync.ts` exports:

```ts
previewSync(source: string, selectedChangeIds?: string[]): Promise<SyncPlan>
applySync(source: string, plan: SyncPlan): Promise<SyncReceipt>
inlineHtmlToMarkdown(html: string): string
```

Preview is read-only. It validates the project identity, persistence envelope,
current source mapping, selected pending changes and source fragments without
creating a lock, directory, annotation or other file. Omitting selected IDs
means all pending edits; an unsupported selected edit fails the preview.
Explicit selection returns the remaining IDs as `excludedChangeIds` so none
disappear.

The plan exposes `changes` with per-element `target`, `changeId`, `blockId`,
`kind`, `before`, `after` and original `html`. Exact UTF-8 patches are at
`plan.patch.patches`; the inspectable resulting QMD is `plan.patch.result`. It
also contains source hash, state revision, full state hash and a plan hash.
Apply recomputes the plan and patch from current authoritative source/state and
refuses any stale or tampered proposal. An arbitrary supplied result is not
trusted.

## Supported semantics and mapping

- Authored `html` field edits mapped to original heading/paragraph content only.
  Computed, detached, conflicting, structural and unmapped changes are refused.
- The exact stored original fragment must equal current QMD. Unrelated source
  edits are allowed for explicit stable IDs, or a single child of a stable
  explicit div with unchanged parent and sibling count. Changed
  anonymous/ordinal mappings are refused rather than guessed.
- A bounded HTML fragment converter supports literal text, basic bold/italic,
  line breaks, line-through spans, and a single editor paragraph/div wrapper. It
  decodes a limited explicit entity set and escapes Markdown control syntax.
  Scriptable attributes, other tags, unknown entities,
  nested/adjacent/whitespace ambiguous emphasis, empty text and unsupported
  source structure are refused. It does not invoke a whole-QMD Markdown writer
  or execute source computations.
- No identity markers are inserted implicitly. Syncing an anonymous block
  against an unchanged snapshot can be safe as a source patch while later
  regeneration still needs explicit identity pinning to preserve design. The
  first slice's explicit div with a single paragraph has an accepted stable
  mapping.

## Transaction and recovery contract

Apply runs inside `withProject` and its project operation lock. It rejects
symlink source files/state directories, stages and fsyncs the approved source,
stores a fsynced original state envelope, and writes/fsyncs
`sync-transaction.json` before changing QMD. The original source is renamed into
retained history and its hash is checked again. A no-clobber hard link publishes
the staged source; a concurrently recreated source file is preserved and causes
a recovery diagnostic.

Only after publication does StateStore save an unchanged semantic state with an
incremented revision. **Generated baseline, provenance and pending edits remain
unchanged.** No render runs within the lock. A future execution can confirm and
clear each pending field whose generated value equals the requested edit.

Success returns and persists a receipt with `renderNeeded: true`,
`pendingRetained: true`, old/new source hashes and revisions, selected IDs,
source backup, state backup and receipt paths. Failures after journal creation
preserve the journal, original snapshots and any surviving staged/new source.
Other project operations refuse the journal until explicit recovery; the
coordinated recovery module handles inspection/finish/rollback separately.

The journal schema is:

```text
version, transactionId, source, sourceBackup, stateBackup, staging, receiptPath,
sourceHash, resultHash, stateRevision, planHash, selectedChangeIds
```

Source backup is `history/source-UUID.qmd`, state backup is
`history/state-UUID.json`, staged QMD is beside the source as
`.NAME.qmd.sync-UUID`, and the receipt is `history/sync-UUID.json`. File
contents and Unix directory entries are fsynced; native Windows behavior and
filesystems without hard-link support are not claimed verified by Linux tests.

## Evidence

```sh
deno test --allow-read --allow-write tests/sync_test.ts
deno lint src/core/sync.ts tests/sync_test.ts
```

**10 tests pass**, using actual temporary QMD files and StateStore persistence:
read-only preview; exact Unicode/CRLF updates and backups; independent source
edits; same-fragment conflicts; stale source/state; modified plan; computed and
unsupported selections; singleton/anonymous mappings; HTML conversion refusal;
injected failure during state save; symlink source/state refusal; and a
simulated concurrent editor recreating QMD before publication. Lint passes.

This evidence verifies the core text-sync and recovery-artifact behavior. UI
approval, CLI orchestration, automatic pending reconciliation after real render,
and the separate recovery commands require integration evidence.

Current integration caveat: the state merge compares raw HTML strings.
Equivalent markup such as `<strong>` versus renderer `<b>`, or redundant
paragraph wrappers, may still require explicit reconciliation after rendering.
The converter never silently clears the original pending HTML edit based on an
unverified assumption of equivalence.
