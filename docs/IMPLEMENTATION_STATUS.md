# Implementation ledger

Updated 2026-10-11. The full product destination remains `PRODUCT_TARGET.md`.
The first supported bidirectional Linux workflow has been demonstrated end to end.
Full product acceptance and public v1 release remain pending. See
[first-slice evidence](evidence/FIRST-SLICE.md) for scope and reproduction.

## Execution baseline

- Root documentation preserved in Git before code changes (`e7f3f46`).
- Quarto 1.10.19, Deno 2.9.6, R 4.6.1 on Linux.
- Bento revision and bundled shell digest: `vendor/bento/pin.json`.
- Five isolated managed worktrees: source mapping, Bento bridge, project state,
  Quarto extension/design, and pinned document contract validation.
- Core choices: TypeScript/Deno; no runtime package or computation environment management.
- Each implementation commit must carry suitable tests or measured evidence. Integration and
  browser validation are separate gates; unit tests alone do not establish a slice.

## Acceptance ledger

| Requirement | Current evidence / remaining work |
|---|---|
| S0 executed QMD to native Bento | Real native editing → actual Bento serialize/download → capture → changed-data recompute preserves geometry/style/docId. [Live evidence](evidence/S2-studio.md). OS file picker not yet verified. |
| S1 original byte spans / safe patches | UTF-8/CRLF, fenced blocks, explicit IDs, qb markers, bounded patches and stale-source checks pass. Unsupported source formatting refuses reverse sync. [Mapping evidence](evidence/S1.md). |
| S2 editor observation / undo / save | Public Bento API adapter, native edit/save/reopen, revision-bound iframe and recompute busy state tested. [Bridge](evidence/S2.md), [Studio](evidence/S2-studio.md). |
| Stable deck/semantic/visual identity | Persisted docId, explicit IDs and native-created IDs survive sync/render; ambiguous weak identities refuse. Broader plain-QMD mapping and lost computation provenance remain under development. |
| Sparse visual overrides and decorations | Field-level sparse overrides, element stacking and explicit creation promotion integrated. Changed SVG preserves placement/style/decorations in live and automated tests. |
| Save durable pending semantics, separate from sync | Atomic state/checksum/revision; live server restart preserves pending authored text and visual objects. Save/preview leave QMD unchanged. |
| Field-level three-way reconciliation | Fresh execution-bound preview/apply and Studio three-value conflicts tested; explicit QMD/Bento/detach decisions save state without silently syncing. [Reconciliation](evidence/RECONCILE.md). |
| HTML guard in every render entry point | Core render and ordinary Quarto integration tested; native capture receipts reject stale/foreign/consumed generations. Direct Quarto invocation verification currently Linux-only. [Quarto](evidence/QUARTO.md), [capture](evidence/CAPTURE.md). |
| Verified preview/apply + recoverable source/state transaction | Text/structural plans, exact fragment/hash/state checks, recoverable source transaction and promotion receipts integrated. Interrupted render/sync finish/rollback tested. [Recovery](evidence/RECOVERY.md). |
| New/order/hide/restore/delete slides safely | New slide/text/order and explicit safe deletion implemented; computed producer ordering/deletion protected. Native new-slide/order/save/reopen/sync tested live; repeated template IDs have an independent real-Quarto regression; hide/restore/delete UI needs further work. [Structural sync](evidence/SYNC-STRUCTURE.md). |
| Authored text/math/displayed code/notes synchronization | Plain/bold/italic/strikeout/web-link/inline-code text round-trip tested, including live native editing. [Inline](evidence/INLINE.md). Math/displayed-code/notes still pending. |
| Computed provenance and explicit detach | Executed origins verified against original source; generated as-is content refuses ambiguous provenance. Explicit reconciliation supports restore/detach; broader fixtures remain. |
| QMD visual attributes + annotation levels | Bounded attribute patch/design primitives tested; projector ownership and annotations are not integrated. |
| Components, layouts, themes, animation/morph | Pending full supported projections and retention checks. |
| Charts and simple tables; faithful rich fallback | Pending adapters and conversion diagnostics. |
| Plotly/htmlwidgets + isolated offline Presenter | Pending supported fixture, static fallback and isolation checks. |
| Bento standalone/PDF | Upstream shell vendored; offline/edit/PDF visual proof pending. |
| Structured CLI/API + ordinary Quarto custom format | JSON CLI render/capture/status/diff/sync/recover/edit/init/doctor, guarded project hooks and single-execution test implemented. Packaging and remaining actions pending. |
| Rebuild from clean clone without generated HTML | Relocated rebuild from QMD, CSV and two state files preserves pending text, native design/docId and changed-data SVG. [First slice](evidence/FIRST-SLICE.md). |
| Offline / hostile data / paths / local server security | Initial safe script splicing/local asset checks; complete audit pending. |
| Linux/macOS/Windows packaging and native evidence | Linux development only; packaging/CI/native other-OS proof pending. |
| Accurate end-user docs + public release scope | Pending implementation docs; public v1 boundary not frozen. |

## Known limits under active implementation

- First-slice evidence is Linux-specific and bounded to the documented fixture.
  Broader structural cases and all later product gates remain active work.
- `results: asis` can lose computation wrappers in Quarto's executed AST. This
  refuses before execution; a generated heading must never become implicitly
  authored content. Original-source/producer checks also validate projection.
- Rich original Markdown outside the faithful reverse subset refuses sync.
  Link/code/strikeout projection and bounded synchronization are now supported.
  Native charts/tables, notes/math/code round-trip, components, widgets,
  Presenter/PDF and cross-platform packaging remain separate incomplete gates.
- Capture permits one accepted capture per published generation and refuses
  older HTML after newer Studio edits. Re-render before editing another native
  copy; arbitrary independent copies are not automatically reconciled.
- Tests that bind the local Studio server need loopback access in the execution
  sandbox. The server listens only on `127.0.0.1`.

## Integration discipline

The coordinator integrates reviewed commits onto main. Agents own disjoint directories
and report test commands, failure cases and limitations. No permanent Bento fork, source
rewrites on render, or automatic environment manager is introduced. UI/browser state is
not a substitute for durable `.qbento/` data. Product direction changes still require
explicit agreement; routine internal implementation choices do not.
