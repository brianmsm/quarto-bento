# Confirmed source element deletion — Linux author evidence

Implementation slice on `feat/confirmed-element-delete`, based on `0bf0d9c`.
This evidence covers the author's local Linux machine with Deno 2.9.6,
Quarto 1.10.19 and the bundled Bento 1.2.6 shell pinned to
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

## Implemented workflow

Native removal followed by Save retains a `delete-element` pending change.
QMD remains unchanged. **Revisar cambios** has a separate checkbox naming each
source element and its slide; no deletion preview or Apply is enabled until all
selected deletion confirmations are checked. The review displays the exact
UTF-8 source span and the complete proposed QMD.

Before synchronization, **Comparar con QMD** offers **Restaurar elemento con su
texto y diseño pendientes**. It removes only the deletion change and recomposes
its earlier pending semantic values, visual overrides and observed element
order. Save/reopen and a subsequent render retain that restored document. If
the source element is already absent, the label describes discarding a pending
deletion and recovering the source from history; it does not promise restoration.

An approved sync removes one existing authored independent source unit:

- A paragraph, displayed code block or display equation with a stable standalone
  technical ID.
- One such child of a top-level identified plain singleton fenced div. Its whole
  wrapper is removed so it cannot remain empty or capture another source block.

The helper verifies original UTF-8 spans, technical markers, wrapper attributes,
closing fences, reference dependencies and the remaining scanned identities,
source bytes and semantic boundaries. A fresh executed baseline is required.
Headings, computations, nested/shared/semantic containers and unresolved weak
survivor identities refuse before QMD publication. Element deletion on a slide
also marked for deletion is rejected with `OVERLAPPING_SOURCE_DELETE`; restore
one pending action before reviewing the other.

Apply uses the existing durable QMD transaction and preserves both source/state
backups and the pending journal. Its approval adds an exact checksum of the
post-apply project state. Fresh execution must retain the slide and prove the
approved target absent before retiring only that target's pending content,
provenance, ownership, visual overrides and order entry. External removal alone
cannot authorize that cleanup; conflicts and recoverable design remain.
Recovery checks the approval checksum against the exact transaction baseline.

## Focused validation

The author's final test command is:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 \
  tests/source_deletion_test.ts tests/element_deletion_test.ts \
  tests/source_structure_test.ts tests/state_test.ts \
  tests/reconcile_test.ts tests/studio_client_diagnostics_test.ts \
  tests/studio_element_deletion_client_test.ts
```

**Result: 56 passed, 0 failed in 50 seconds.**
The receipt is `/tmp/qbento-element-delete-tests.log` on the author's machine.
The test layers include:

- Real Quarto render → pending text/design → delete/save → reopen → separately
  confirmed exact QMD patch → apply → fresh render and output-free rebuild, with
  stable `docId`, unrelated slide/design/decorations retained and target-only
  cleanup. Exact non-target CRLF/UTF-8 bytes are checked.
- Real Quarto comparison/restoration of a deleted-pending element with earlier
  pending rich text, x/y/font size and manually changed stacking; its complete
  original native snapshot and pending text survive save/reopen/render.
- Refusals for stale QMD/state/approval, altered confirmation/patch plans,
  computed producers, headings, semantic or shared containers and overlapping
  element/slide deletion. Rejected operations retain QMD/state/output bytes.
- Injected state-commit failure after source publication; recoverable exact
  backups and checked finish, including refusal of a checksum-valid approval
  containing the wrong expected state checksum.
- Real Quarto deletion of existing displayed code and display math using the
  same source-unit proof, with explicit assertions of their executed kinds.
- Local Studio HTTP save/reopen/preview/apply/render; separately, the complete
  shipped client runs against DOM/transport doubles to verify specific checkbox
  consent, disabled Apply and honest restoration labels.

Changed source/core/server entry points pass `deno check`; changed code and
focused tests pass `deno lint` and `git diff --check`.

These are executed Linux, local HTTP and client-double checks. Foreground native
Studio acceptance is a separate coordinator gate. The full product and public
release boundary are not established by this slice.
