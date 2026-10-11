# S4 persistence and merge engine evidence

Implemented on 2026-10-11 in `src/state/`. This is the state component's
validation record. It does not by itself establish a working Quarto renderer,
Studio bridge, native Bento visual result, or source patcher.

## Contract

`src/state/mod.ts` exports JSON-only Bento document/element/slide interfaces,
`ProjectState`, typed diagnostics (`StateError.code`), and:

- `createState(generated, provenance = {}, ownership = {})`: creates version 1
  state. The caller chooses `generated.docId` once, then reuses `state.docId`.
- `captureEdits(state, editedDoc)`: compares against the actual last emitted or
  saved document. Geometry/style/decorative changes become sparse sidecar data;
  semantic changes become durable per-field pending records. It never writes
  QMD.
- `compose(state, newGenerated, provenance?, ownership?, {strict?: boolean})`:
  returns `{state, document, changes}`. It replaces generated content while
  retaining design and unsynced edits. Strict mode defaults to true and raises
  `MERGE_CONFLICT` with structured changes instead of choosing a conflicting
  value. Non-strict mode produces a preview and persists conflict information.
- `resolveChange(state, id, 'keep-source' | 'detach')`: deliberate
  restore/discard of a pending value, or explicitly labeled detachment of a
  computed field.
- `StateStore(directory).load()/save(state, expectedRevision = state.revision)`:
  checksum-verified versioned state envelope; save returns revision + 1. The
  caller must replace its in-memory reference with this returned value.
- `StateStore.inspectRecovery()`: validates and returns the previous committed
  revision without silently replacing current state.
- `assertOutputUnchanged(state | undefined, outputPath)`: run **before**
  invoking anything that might overwrite native HTML. Existing untracked or
  modified HTML refuses rendering; missing generated HTML can be reconstructed.
- `markEmitted(state, document, outputPath, htmlBytesOrString)`: async receipt
  preparation after a successful HTML write or explicit capture; returns state
  with a SHA-256 digest. This function does not write the HTML itself.
- `sha256`, `targetKey`, `validateDoc`, `validateState` and JSON comparison
  helpers.

Provenance is keyed by `targetKey({slideId, elementId})`, mapping to
`{origin, semanticId?, producer?, source?}`. Origin is `authored`, `computed`,
`bento-only`, or `detached`. Ownership uses the same keys with arrays of paths
such as `['x', 'font/size']`; paths designate explicitly QMD-owned visual
fields. All computed content fields must receive computed provenance from the
renderer. Missing provenance conservatively treats semantic changes as authored
pending; source-patch validation remains responsible for refusing unmapped
edits.

The state holds generated and emitted snapshots for three-way comparison; these
are **baselines, not competing semantic authorities**. Actual saved design is
sparse by `(slideId, elementId)`; element IDs may repeat across different
slides. Element stacking order is stored as IDs without stale copies of
generated data. Pure newly created shapes/lines/arrows/paths stay in
`bentoOnly`; newly authored text or slides stays in the pending journal until
safe source synchronization. Hide is a visual property. Source deletion/reorder
remains a pending action.

## Persistence transaction

`state.json` is a versioned, SHA-256-checked envelope. An atomic directory lock
serializes writers, and compare-and-swap revision checks reject stale clients.
The next envelope is written to a uniquely named temporary file and fsynced; the
previous validated envelope is durably retained as `state.previous.json`; rename
replaces the current envelope. The directory is fsynced on Unix. Unknown
versions, malformed IDs/paths, prototype-related JSON keys, checksum mismatch
and symlink state files are rejected. A stale lock is never stolen; its owner
metadata must be inspected before explicit recovery.

The caller still owns the higher-level HTML/QMD plus state transaction. A crash
between HTML emission and the state receipt is conservative: the next guard
refuses the untracked output. This module never claims a multi-file atomic
commit across source, HTML and state. Disk exhaustion and power-loss injection
have not been tested; runtime concurrency and corrupted-file recovery paths
have. Windows/macOS behavior has not been exercised here. No environment
management, network access or external package is required by this component.

## Reproducible checks

```sh
deno check src/state/mod.ts
deno lint src/state tests/state_test.ts
deno test --allow-read --allow-write tests/state_test.ts
```

The dependency-free suite proves recomputed SVG payload + retained frame and
shape, sparse reset of overridden fields, pending authored edits across repeated
renders, independent field merges, contradictory source conflict, acknowledgment
of synchronized fields, computed refusal/restore/detach, explicit QMD geometry
ownership, new-slide edit/reorder/delete persistence, source removal conflicts,
missing/duplicate IDs, independent repeated IDs, unrelated document refusal,
prototype-path defense, save/reopen, compare-and-swap, concurrent writer
refusal, backup validation, corrupt current envelope refusal, missing HTML
rebuild and uncaptured native HTML refusal. These are synthetic model and Linux
filesystem checks; native Bento editing/render fidelity requires the integration
evidence.

## Adversarial review follow-up

The multi-round restoration review found and fixed loss of objects inserted
while restoring a deleted source slide, stale hidden text/style edits
resurrecting after restoration, and loss of the original orphan snapshot after
repeated preview renders. The suite now includes these regressions and
retirement of associated design when a pending source deletion is confirmed by
fresh execution.

Creation synchronization uses an explicit operation:

```ts
state = promoteCreated(state, freshlyGeneratedDocument, approvedCreationIds);
const result = compose(state, freshlyGeneratedDocument, freshProvenance);
```

`approvedCreationIds` must contain actual pending
`create-slide`/`create-element` change IDs from the reviewed and successfully
applied source transaction. IDs and semantic fields must agree with fresh
execution; otherwise promotion refuses. Matching IDs or even matching complete
source objects do not implicitly approve a creation. Promotion separates
retained native appearance into sparse overrides, preserves decorative objects
and stacking, and consumes only approved creation records. QMD stays
authoritative for later semantic changes. Optional absent and empty slide
notes/title are treated as equivalent; arbitrary rich text normalization is not
guessed. This operation does not itself execute, approve, or apply source
patches.
