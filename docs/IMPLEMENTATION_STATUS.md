# Implementation ledger

Updated 2026-10-11. The full product destination remains `PRODUCT_TARGET.md`.
The first supported bidirectional Linux workflow has been demonstrated end to
end. Full product acceptance and public v1 release remain pending. See
[first-slice evidence](evidence/FIRST-SLICE.md) for scope and reproduction.

## Execution baseline

- Root documentation preserved in Git before code changes (`e7f3f46`).
- Quarto 1.10.19, Deno 2.9.6, R 4.6.1 on Linux.
- Current owner-requested validation scope: this local Linux machine only
  (2026-10-11). Native macOS/Windows and hosted CI validation are deferred; they
  are not prerequisites for closing this local validation pass.
- Bento revision and bundled shell digest: `vendor/bento/pin.json`.
- Isolated managed worktrees separate source mapping, bridge/state, Quarto
  integration, document validation, Studio hardening, math, notes and packaging.
- Core choices: TypeScript/Deno; no runtime package or computation environment
  management.
- Each implementation commit must carry suitable tests or measured evidence.
  Integration and browser validation are separate gates; unit tests alone do not
  establish a slice.

## Acceptance ledger

The native standalone-text creation path is now integrated as well: Save and
reopen retain the pending object; reviewed sync inserts a bounded identified
paragraph into the existing source slide; recalculation promotes it while
preserving its native ID and complete saved visual fields. The coordinator's
two-slide UI check also verified exact preservation of the other slide and
source bytes outside the reviewed insertion/annotations.
[Text insertion](evidence/TEXT-INSERTION.md).

Studio shows missing external-design diagnostics on open/recalculate. Render
warnings survive the corresponding iframe reconnect and design-only refresh.
`OVERFLOW` is recomputed from the final composed document, including saved
geometry and page size; it checks vertical box bounds, not rendered ink.
[Banner lifecycle](evidence/MISSING-DESIGN.md),
[composed overflow](evidence/COMPOSED-OVERFLOW.md).

| Requirement                                                   | Current evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0 executed QMD to native Bento                               | Real native editing → actual Bento serialize/download → capture → changed-data recompute preserves geometry/style/docId. [Live evidence](evidence/S2-studio.md). OS file picker not yet verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S1 original byte spans / safe patches                         | UTF-8/CRLF, fenced blocks, explicit IDs, qb markers, bounded patches and stale-source checks pass. Unsupported source formatting refuses reverse sync. [Mapping evidence](evidence/S1.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S2 editor observation / undo / save                           | Public Bento API adapter, native edit/save/reopen, revision-bound iframe and recompute busy state tested. [Bridge](evidence/S2.md), [Studio](evidence/S2-studio.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Stable deck/semantic/visual identity                          | Persisted docId, explicit IDs and native-created IDs survive sync/render; ambiguous weak identities refuse. Broader plain-QMD mapping and lost computation provenance remain under development.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sparse visual overrides and decorations                       | Field-level sparse overrides, element stacking and explicit creation promotion integrated. Changed SVG preserves placement/style/decorations in live and automated tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Save durable pending semantics, separate from sync            | Atomic state/checksum/revision; live server restart preserves pending authored text and visual objects. Save/preview leave QMD unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Field-level three-way reconciliation                          | Fresh execution-bound preview/apply and Studio three-value conflicts tested; explicit QMD/Bento/detach decisions save state without silently syncing. [Reconciliation](evidence/RECONCILE.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| HTML guard in every render entry point                        | Core render and ordinary Quarto integration tested; native capture receipts reject stale/foreign/consumed generations. Direct Quarto invocation verification currently Linux-only. [Quarto](evidence/QUARTO.md), [capture](evidence/CAPTURE.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Verified preview/apply + recoverable source/state transaction | Text/structural plans, exact fragment/hash/state checks, recoverable source transaction and promotion receipts integrated. Interrupted render/sync finish/rollback tested. [Recovery](evidence/RECOVERY.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| New/order/hide/restore/delete slides safely                   | Native new-slide/order/save/reopen/sync and Studio hide/show/delete-pending/restore/reviewed-delete workflows are demonstrated. Restore retains prior order while respecting later survivor reordering; last-slide, producer and cross-reference protections tested. Bounded exact QMD deletion requires separate confirmation. [Structural sync](evidence/SYNC-STRUCTURE.md), [slide actions](evidence/SLIDE-ACTIONS.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Authored text/math/displayed code/notes synchronization       | Supported rich text, identified display equations, displayed code and plain identified speaker notes round-trip tested, including live native editing. [Inline](evidence/INLINE.md), [displayed code](evidence/DISPLAYED-CODE.md), [notes](evidence/NOTES.md), [math](evidence/MATH-CODEC.md). A combined native edit/sync/recompute fixture preserves all four and a changed-data SVG; the integrated suite at `ba0843d` passes 202 tests. [Combined evidence](evidence/SEMANTIC-ROUNDTRIP.md). General TeX and inline equations remain unsupported.                                                                                                                                                                                                                                                                                                                                                                       |
| Computed provenance and explicit detach                       | Executed origins verified against original source; generated as-is content refuses ambiguous provenance. Explicit reconciliation supports restore/detach; broader fixtures remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| QMD visual attributes + annotation levels                     | Direct-object QMD fields apply to projection, stay source-owned and sync through bounded patches; conflict and native UI checks pass. Component source ownership and none/minimal/detailed annotations are integrated. Exact optional patches and omission diagnostics have native Studio acceptance; save/render preserve QMD and reviewed apply uses the recovery transaction. [Annotations](evidence/ANNOTATIONS.md). Original QMD design traces now produce persistent `MISSING_DESIGN` warnings when external design is absent, including fresh rebuild/reopen and native Studio opening/recalculation. Invalid state and unresolved registry transactions remain failures. [Missing design](evidence/MISSING-DESIGN.md). [Design](evidence/DESIGN.md), [components](evidence/COMPONENTS.md).                                                                                                                          |
| Components, layouts, themes, animation/morph                  | Final-slot composition fixes undersized nested cards. Native heading/body/code readability, literal-text save/body-only sync and changed-data SVG with retained geometry/docId are demonstrated for bounded fixtures. [Canonical example](../examples/components/deck.qmd), [components](evidence/COMPONENTS.md). A validated local layout/theme registry is integrated; native palette, fade-up, count-up, reveal and morph survived save/recompute and were exercised in playback. Studio edits named layouts and themes with byte/revision checks and recoverable saves. Native save → registry edit → recompute retains pending text, source-owned fields and identity; a reviewed sync completes the loop. The theme vocabulary and palette-reference ownership remain bounded. [Studio registry](evidence/STUDIO-REGISTRY.md). [Registry](DESIGN_REGISTRY.md), [native motion evidence](evidence/DESIGN_REGISTRY.md). |
| Charts and simple tables; faithful rich fallback              | Plain tables and explicit bounded native bar/line charts now have executed provenance/fidelity tests and native save/changed-data visual acceptance. Geometry/table-wide styles survive; cells/chart-option reverse sync remains unsupported. Fresh bounded gt/gtsummary PNG fallback now preserves computed provenance, source formatting and full content. Native slides and a two-page offline PDF were visually inspected. [Tables](evidence/TABLES.md), [charts](evidence/CHARTS.md), [rich tables](evidence/RICH-TABLES.md).                                                                                                                                                                                                                                                                                                                                                                                          |
| Plotly/htmlwidgets + isolated offline Presenter               | Trusted generation resources, recovery, ordinary Quarto hooks and Studio Presenter are integrated. Real SVGs retain saved geometry after recomputation; separate isolated interactive views have offline headless Chromium hover/zoom evidence and independent runtime review. Static native deck/PDF retain the SVG. Arbitrary widgets and exact-geometry interactive overlays remain outside this bounded adapter. [Canonical example](../examples/plotly-offline/deck.qmd), [Plotly](evidence/PLOTLY.md).                                                                                                                                                                                                                                                                                                                                                                                                                |
| Bento standalone/PDF                                          | Static three-slide standalone opens, edits, downloads and reopens with networking disabled; native print yields visually inspected PDF with changed-data SVG and retained design. Browser harness on Linux; OS dialogs and broader widget-export acceptance remain pending. [Offline/PDF](evidence/OFFLINE-PDF.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Structured CLI/API + ordinary Quarto custom format            | JSON CLI get/patch expose saved deck/docId/revision/provenance, bounded field/order/hide/show mutations and authored slide creation through the same state core. Creation requires a current executed QMD baseline; stale source, invalid batches and identity/revision changes refuse without writing. Real create → reviewed sync → render/reopen preserves source and design. [Agent API](AGENT-API.md), [creation evidence](evidence/AGENT-CREATE.md). Reviewed deletion is available in Studio. Guarded ordinary Quarto remains verified on Linux; native other-OS qualification is pending.                                                                                                                                                                                                                                                                                                                           |
| Rebuild from clean clone without generated HTML               | Relocated rebuild from QMD, CSV and two state files preserves pending text, native design/docId and changed-data SVG. [First slice](evidence/FIRST-SLICE.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Offline / hostile data / paths / local server security        | Script splicing, local path and resource checks, bounded Studio/API input and document identity guards are implemented. Project saves refuse transient/external or missing referenced resources, including dependencies nested in native SVG/embed snapshots; self-contained resources and hyperlinks remain supported. [Asset/resource evidence](evidence/ASSET-PATHS.md). Complete dependency/security audit remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Linux/macOS/Windows packaging and native evidence             | Portable development directory, offline launchers and SHA256 inventory implemented; Linux relocation/clean-cache execution tested. A pinned CI matrix and an expanded portable launcher/state-only relocation smoke are committed; the latter passed locally on Linux. No hosted matrix run or native other-OS proof is claimed. Release packaging remains pending. [Packaging](PACKAGING.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Accurate end-user docs + public release scope                 | README, the [Spanish usage guide](USAGE.md), canonical semantic/table/chart/component/Plotly/rich-table examples and the [JSON agent contract](AGENT-API.md) describe bounded delivered behavior. Remaining implementation docs track active integrations; public v1 boundary is not frozen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Known limits under active implementation

The post-suite requirement audit found concrete missing ordinary workflows:
plain-QMD identity acquisition after reviewed edits, confirmed source-element
deletion, meaningful Studio-created card/KPI synchronization, and the remaining
declarative component vocabulary. See the
[functional acceptance checklist](ACCEPTANCE_GAPS.md). These remain required
implementation work; the green suite below covers its existing fixtures.

- First-slice evidence is Linux-specific and bounded to the documented fixture.
  Broader structural cases and all later product gates remain active work.
- `results: asis` can lose computation wrappers in Quarto's executed AST. This
  refuses before execution; a generated heading must never become implicitly
  authored content. Original-source/producer checks also validate projection.
- Rich original Markdown outside the faithful reverse subset refuses sync.
  Link/code/strikeout projection and bounded synchronization are now supported.
  Displayed code preserves content and source-owned typography; executable
  echoes retain computed provenance and cannot reverse-write their producer.
  Plain identified speaker notes now synchronize through their own bounded
  patch. Identified standalone display equations use a bounded LaTeX codec and
  reviewed body-only patches. Independent review closed delimiter, script-base
  and lossy text edge cases against the pinned native renderer; this is not
  general TeX support. Native chart/table support is bounded to documented
  source and fidelity limits; cell/option reverse synchronization remains
  unsupported. Corrected component composition and durable Plotly/Presenter
  integration are verified for their documented fixtures. Fresh gt/gtsummary
  captures have bounded native image and offline PDF evidence. Rich pending
  component content, inherited child-to-parent visual inference, arbitrary
  widgets and cross-platform native packaging remain incomplete gates.
  Interactive Plotly views are separate from the native static slide
  composition.
- Capture permits one accepted capture per published generation and refuses
  older HTML after newer Studio edits. Re-render before editing another native
  copy; arbitrary independent copies are not automatically reconciled.
- Tests that bind the local Studio server need loopback access in the execution
  sandbox. The server listens only on `127.0.0.1`.

## Recent integrated verification

- At `c225546`, the full integrated suite passed **332 tests, 4 steps, 0
  failures, 0 ignored tests** in **8 minutes 34 seconds**, with process exit
  **0**. The pinned upstream math comparison and real headless Studio check were
  enabled. Full source type checking, lint and runtime/test/tool formatting
  passed. The 69-file portable package also passed its complete relocated
  state-only rebuild smoke and ordinary Quarto test on Linux. This is the latest
  complete-suite receipt; details and reproduction are in
  [integrated Linux validation](evidence/INTEGRATED-LINUX.md).

- At `20a3492` (components and tables), the complete suite passed **223 tests, 0
  failures, 1 optional test ignored**. The optional pinned external
  math-renderer test has separate executed evidence when its upstream checkout
  is supplied.
- Charts integration adds a real-Quarto rejection test for charts/tables nested
  in unadapted components. The 22 focused component/chart/design cases pass; the
  new regression was rerun after correcting isolation of its two temporary
  projects.
- After `b201c4b`, 44 focused integrated slide-action, source-structure, state
  and Studio-body tests pass, and all source TypeScript checks pass.
- At `d784b65`, the complete suite passes **246 tests, 0 failures, 1 optional
  test ignored** in 4 minutes 33 seconds. This includes chart/component
  integration, slide actions and the isolated widget modules. This historical
  receipt predates the final-slot component correction, durable widget
  integration, resource guard and JSON agent API.
- `a140d2a` integrates the component readability correction. The coordinator
  inspected the corrected and changed-data native captures and verified a save →
  exact body-only sync → recalculate loop with stable geometry/docId;
  [component evidence](evidence/COMPONENTS.md) records the revisions and hashes.
- `c0ee21a` adds durable offline project-resource guards; **25 focused tests
  pass**, including atomic rejected saves and retained embedded native images.
- Widget integration `1991327` (author commit `37682cc`) has execution,
  recovery, trusted-resource and independent isolation review, plus native
  headless offline hover/zoom validation through Studio. **12 focused integrated
  widget/component tests pass** on main. See [Plotly](evidence/PLOTLY.md) for
  adapter bounds and separate static/interactive views.
- Agent API integration `95c7695` (author commit `a010aa3`) has independent
  review of the exact commit and **10 integrated agent/slide/Studio tests
  passed, 0 failures**, in 33 seconds with loopback permission. A sidecar
  replacement at lock entry cannot bypass document identity even with a matching
  revision.
- Both new canonical examples were smoke-rendered from fresh temporary copies
  under this integrated build. Components retain one slide, the literal body and
  a computed SVG at 680/250/496/362; Plotly emits one computed SVG and a trusted
  widget generation/Presenter. Both source QMD/CSV pairs remain unchanged and
  have zero pending edits. This is executed render evidence, separate from the
  native/browser validation above.
- Native hidden-slide print output has a one-page PDF with both source slides
  retained; its chart and labels were visually inspected. This closes the
  Chromium print layer for that bounded fixture, not native OS dialogs.

- At `832c9ed`, **73 integrated tests passed, 0 failed** in 1 minute 10 seconds:
  annotations, registry, widget publication and recovery. Native Studio
  separately demonstrated detailed patch review/apply/recompute and visible
  omission diagnostics with a disabled apply button for a diagnostic-only plan.

- `c93a1b8` extends resource persistence checks to native SVG/embed markup, CSS
  and nested SVG image data. Independent focused validation passed **28 tests**,
  plus a 20-case compatibility matrix. Save/capture refusals preserve source,
  state, generated output and retained imported HTML bytes.
- `138074d` adds the pinned Linux/macOS/Windows CI matrix. Its complete portable
  smoke passed locally at `c93a1b8`, including actual launchers, JSON edits,
  state-only reconstruction and ordinary Quarto after relocation and removal of
  the portable runtime. No hosted CI or native macOS/Windows execution occurred.
- Rich-table integration `0d4befe` has fresh projection, computed conflict,
  explicit detach and relocation tests with independent review. Native image and
  offline two-page PDF acceptance of the readable canonical example are recorded
  at `01e7f87` in [rich-table evidence](evidence/RICH-TABLES.md).
- `2cdcc2c` integrates reviewed JSON API slide creation; `2038dda` records the
  coordinator's native registry save/recompute/sync and persistent
  missing-design warning checks. See [agent creation](evidence/AGENT-CREATE.md)
  and [registry acceptance](evidence/STUDIO-REGISTRY.md).
- `7ce0d14` integrates bounded authored text insertion with **34 focused tests**
  and independent failure/recovery review. The coordinator then completed native
  add/edit/save → close/reopen → inspect/apply → recalculate with the exact
  complete native object retained and zero pending edits.
- `c225546` integrates the composed-overflow correction after independent review
  of its exact author commit. **12 focused tests** pass; the reviewer separately
  ran four tests and a real saved-geometry repro retaining unrelated
  diagnostics, exact QMD bytes and zero pending edits.

## Integration discipline

The coordinator integrates reviewed commits onto main. Agents own disjoint
directories and report test commands, failure cases and limitations. No
permanent Bento fork, source rewrites on render, or automatic environment
manager is introduced. UI/browser state is not a substitute for durable
`.qbento/` data. Product direction changes still require explicit agreement;
routine internal implementation choices do not.
