# Implementation ledger

Updated 2026-10-11. The full product destination remains `PRODUCT_TARGET.md`.
Implementation has started; no milestone or public v1 release is accepted yet.

## Execution baseline

- Root documentation preserved in Git before code changes (`e7f3f46`).
- Quarto 1.10.19, Deno 2.9.6, R 4.6.1 on Linux.
- Bento revision and bundled shell digest: `vendor/bento/pin.json`.
- Three isolated managed worktrees: source mapping, Bento bridge, project state.
- Core choices: TypeScript/Deno; no runtime package or computation environment management.
- Each implementation commit must carry suitable tests or measured evidence. Integration and
  browser validation are separate gates; unit tests alone do not establish a slice.

## Acceptance ledger

| Requirement | Current evidence / remaining work |
|---|---|
| S0 executed QMD to native Bento | `scripts/probe-render.ts` projects two slides and a real R SVG; browser edit/capture/recompute pending. |
| S1 original byte spans / safe patches | Isolated implementation in progress; root integration and review pending. |
| S2 editor observation / undo / save | Isolated implementation in progress; live browser validation pending. |
| Stable deck/semantic/visual identity | Initial explicit IDs; unlabelled identity registry and ambiguity checks pending. |
| Sparse visual overrides and decorations | State worktree in progress; integration pending. |
| Save durable pending semantics, separate from sync | State core in progress; Studio and restart proof pending. |
| Field-level three-way reconciliation | State core in progress; integration and conflict UI pending. |
| HTML guard in every render entry point | Pending CLI and Quarto extension integration. |
| Verified preview/apply + recoverable source/state transaction | Source/state primitives in progress; joint transaction pending. |
| New/order/hide/restore/delete slides safely | Pending full workflow, dependencies and explicit delete validation. |
| Authored text/math/displayed code/notes synchronization | Text mapping in progress; remaining conversions pending. |
| Computed provenance and explicit detach | Pending integration and user actions; never reverse-write computed code. |
| QMD visual attributes + annotation levels | Pending field ownership and source annotations. |
| Components, layouts, themes, animation/morph | Pending full supported projections and retention checks. |
| Charts and simple tables; faithful rich fallback | Pending adapters and conversion diagnostics. |
| Plotly/htmlwidgets + isolated offline Presenter | Pending supported fixture, static fallback and isolation checks. |
| Bento standalone/PDF | Upstream shell vendored; offline/edit/PDF visual proof pending. |
| Structured CLI/API + ordinary Quarto custom format | Pending. |
| Rebuild from clean clone without generated HTML | Pending end-to-end test including pending state. |
| Offline / hostile data / paths / local server security | Initial safe script splicing/local asset checks; complete audit pending. |
| Linux/macOS/Windows packaging and native evidence | Linux development only; packaging/CI/native other-OS proof pending. |
| Accurate end-user docs + public release scope | Pending implementation docs; public v1 boundary not frozen. |

## Integration discipline

The coordinator integrates reviewed commits onto main. Agents own disjoint directories
and report test commands, failure cases and limitations. No permanent Bento fork, source
rewrites on render, or automatic environment manager is introduced. UI/browser state is
not a substitute for durable `.qbento/` data. Product direction changes still require
explicit agreement; routine internal implementation choices do not.
