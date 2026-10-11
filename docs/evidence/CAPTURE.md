# Native HTML capture lineage

Implemented 2026-10-11 in `src/core/capture.ts`.

A saved native HTML file must establish which project publication it edited.
`docId` alone does not provide that evidence: an older downloaded copy can have
the same ID while Studio has saved newer content/design. Comparing such a copy
directly to current `state.emitted` would interpret stale content as new edits
and silently undo the newer work.

## Integration API

```ts
// While preparing the next journaled publication:
const prepared = await preparePublication(document, assembledHtml);
const html = prepared.html;
state = await recordPublication(
  state,
  document,
  outputPath,
  html,
  prepared.receipt,
);
// Caller safely publishes html and state through its normal render transaction.

// Capture, under the project operation lock:
const editedDoc = await verifyCapture(state, nativeHtml);
state = captureEdits(state, editedDoc);
if (capturedPath === publishedOutputPath) {
  state = await markEmitted(state, editedDoc, publishedOutputPath, nativeHtml);
}
state = consumeCapture(state);
state = await store.save(state);
```

`preparePublication` generates a fresh UUID and inserts an inert
`application/json` script named `qbento-receipt` outside `bento-doc`. The
receipt contains version, generation, document identity and SHA-256 of the
canonical published document. It contains no executable code or user secrets.
`recordPublication` verifies the HTML/document/receipt agreement and records
`generation`, `publishedDocSha256` and `captureConsumed: false` alongside the
normal output path and byte hash.

`verifyCapture` requires a matching receipt, current project generation and
identity, and an unchanged published baseline in `state.emitted`. It rejects
legacy receipt-less HTML, older downloads, malformed or duplicated receipts,
foreign documents and native copies predating a newer Studio snapshot. A pure
revision bookkeeping increment does not invalidate an identical snapshot. Both
same-path saves and downloaded copies are supported when those checks pass.
These helpers return data; they do not modify the HTML or QMD.

`consumeCapture` marks the generation consumed. Persist it atomically together
with the captured edits; a failed save must not change the caller's
authoritative state. `markEmitted` retains optional publication metadata so
same-path capture can update the HTML byte hash without inventing a new native
baseline.

## Explicit current restriction

Only **one capture per publication generation** is accepted, including when the
capture contains no changes. A second capture requires a fresh
render/publication. This deliberately prevents another old copy from silently
undoing the first capture; a full three-way native import workflow is separate
work. Rejections instruct the user to preserve their HTML and refresh/reconcile
deliberately. No receipt is rotated inside an already edited HTML file as an
unjournaled side effect of capture. Distributed copies do not automatically
become source syncs.

## Evidence

```sh
deno check src/core/capture.ts
deno lint src/core/capture.ts src/state/store.ts src/state/types.ts tests/capture_test.ts
deno test --allow-read --allow-write tests/capture_test.ts tests/state_test.ts
```

Nine dedicated capture tests plus the existing 21 state tests pass. Tests cover
receipt preservation while replacing native document JSON, same-path and
download capture, generation consumption, newer Studio text/design refusal,
revision-only changes, new generation publication, old copy refusal,
malformed/missing receipts, publication mismatches, and consumed receipt
persistence after reopen.

The bridge agent separately exercised **real pinned Bento `serialize()`** with
an inert receipt inserted before boot, observing exactly one receipt with
byte-identical text in the serialized HTML. That live upstream evidence is
documented with the Studio/bridge work; the helper tests alone prove JSON/shell
handling, not browser save-dialog behavior.
