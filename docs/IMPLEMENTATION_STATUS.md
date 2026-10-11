# Implementation ledger

Updated 2026-10-11. The full product destination remains `PRODUCT_TARGET.md`.
The first supported bidirectional Linux workflow has been demonstrated end to end.
Full product acceptance and public v1 release remain pending. See
[first-slice evidence](evidence/FIRST-SLICE.md) for scope and reproduction.

## Execution baseline

- Root documentation preserved in Git before code changes (`e7f3f46`).
- Quarto 1.10.19, Deno 2.9.6, R 4.6.1 on Linux.
- Bento revision and bundled shell digest: `vendor/bento/pin.json`.
- Isolated managed worktrees separate source mapping, bridge/state, Quarto
  integration, document validation, Studio hardening, math, notes and packaging.
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
| New/order/hide/restore/delete slides safely | Native new-slide/order/save/reopen/sync and Studio hide/show/delete-pending/restore/reviewed-delete workflows are demonstrated. Restore retains prior order while respecting later survivor reordering; last-slide, producer and cross-reference protections tested. Bounded exact QMD deletion requires separate confirmation. [Structural sync](evidence/SYNC-STRUCTURE.md), [slide actions](evidence/SLIDE-ACTIONS.md). |
| Authored text/math/displayed code/notes synchronization | Supported rich text, identified display equations, displayed code and plain identified speaker notes round-trip tested, including live native editing. [Inline](evidence/INLINE.md), [displayed code](evidence/DISPLAYED-CODE.md), [notes](evidence/NOTES.md), [math](evidence/MATH-CODEC.md). A combined native edit/sync/recompute fixture preserves all four and a changed-data SVG; the integrated suite at `ba0843d` passes 202 tests. [Combined evidence](evidence/SEMANTIC-ROUNDTRIP.md). General TeX and inline equations remain unsupported. |
| Computed provenance and explicit detach | Executed origins verified against original source; generated as-is content refuses ambiguous provenance. Explicit reconciliation supports restore/detach; broader fixtures remain. |
| QMD visual attributes + annotation levels | Direct-object QMD fields apply to projection, stay source-owned and sync through bounded patches; conflict and native UI checks pass. Component source ownership has executed checks; optional annotation levels remain in progress. [Design](evidence/DESIGN.md), [components](evidence/COMPONENTS.md). |
| Components, layouts, themes, animation/morph | Cards, named two-column layouts and displayed-code wrappers project and recompute with measured type restrictions. Native visual review found undersized text/figures from nested proportional fitting; composition acceptance remains open until corrected. Registry/theme and native motion retention work is active. [Components](evidence/COMPONENTS.md). |
| Charts and simple tables; faithful rich fallback | Plain tables and explicit bounded native bar/line charts now have executed provenance/fidelity tests and native save/changed-data visual acceptance. Geometry/table-wide styles survive; cells/chart-option reverse sync and complex rich fallbacks remain unsupported. [Tables](evidence/TABLES.md), [charts](evidence/CHARTS.md). |
| Plotly/htmlwidgets + isolated offline Presenter | Guarded Plotly scatter/bar adapter, real SVG snapshot and offline isolated Presenter modules pass execution/security/browser tests. They are integrated as modules; durable project/render/Studio wiring is still in progress. [Plotly](evidence/PLOTLY.md). |
| Bento standalone/PDF | Static three-slide standalone opens, edits, downloads and reopens with networking disabled; native print yields visually inspected PDF with changed-data SVG and retained design. Browser harness on Linux; OS dialogs and widgets remain pending. [Offline/PDF](evidence/OFFLINE-PDF.md). |
| Structured CLI/API + ordinary Quarto custom format | JSON CLI render/capture/status/diff/sync/recover/edit/init/doctor/validate, guarded hooks and single-execution test implemented, including spaces/quotes in project paths. Portable development packaging exists; remaining actions/native platforms pending. |
| Rebuild from clean clone without generated HTML | Relocated rebuild from QMD, CSV and two state files preserves pending text, native design/docId and changed-data SVG. [First slice](evidence/FIRST-SLICE.md). |
| Offline / hostile data / paths / local server security | Initial safe script splicing/local asset checks; complete audit pending. |
| Linux/macOS/Windows packaging and native evidence | Portable development directory, offline launchers and SHA256 inventory implemented; Linux relocation/clean-cache execution tested. Native other-OS proof and release packaging remain pending. [Packaging](PACKAGING.md). |
| Accurate end-user docs + public release scope | Pending implementation docs; public v1 boundary not frozen. |

## Known limits under active implementation

- First-slice evidence is Linux-specific and bounded to the documented fixture.
  Broader structural cases and all later product gates remain active work.
- `results: asis` can lose computation wrappers in Quarto's executed AST. This
  refuses before execution; a generated heading must never become implicitly
  authored content. Original-source/producer checks also validate projection.
- Rich original Markdown outside the faithful reverse subset refuses sync.
  Link/code/strikeout projection and bounded synchronization are now supported.
  Displayed code preserves content and source-owned typography; executable echoes
  retain computed provenance and cannot reverse-write their producer.
  Plain identified speaker notes now synchronize through their own bounded patch.
  Identified standalone display equations use a bounded LaTeX codec and reviewed
  body-only patches. Independent review closed delimiter, script-base and lossy
  text edge cases against the pinned native renderer; this is not general TeX
  support.
  Native chart/table support is bounded to documented source and fidelity limits;
  cell/option reverse synchronization remains unsupported. Component visual
  composition, complete widget/Presenter integration and cross-platform native
  packaging remain incomplete gates.
- Capture permits one accepted capture per published generation and refuses
  older HTML after newer Studio edits. Re-render before editing another native
  copy; arbitrary independent copies are not automatically reconciled.
- Tests that bind the local Studio server need loopback access in the execution
  sandbox. The server listens only on `127.0.0.1`.

## Recent integrated verification

- At `20a3492` (components and tables), the complete suite passed **223 tests,
  0 failures, 1 optional test ignored**. The optional pinned external math-renderer
  test has separate executed evidence when its upstream checkout is supplied.
- Charts integration adds a real-Quarto rejection test for charts/tables nested
  in unadapted components. The 22 focused component/chart/design cases pass;
  the new regression was rerun after correcting isolation of its two temporary
  projects.
- After `b201c4b`, 44 focused integrated slide-action, source-structure, state and
  Studio-body tests pass, and all source TypeScript checks pass. This is not a
  claim that the earlier complete-suite run includes the newer widget modules
  or pending changes.

## Integration discipline

The coordinator integrates reviewed commits onto main. Agents own disjoint directories
and report test commands, failure cases and limitations. No permanent Bento fork, source
rewrites on render, or automatic environment manager is introduced. UI/browser state is
not a substitute for durable `.qbento/` data. Product direction changes still require
explicit agreement; routine internal implementation choices do not.
