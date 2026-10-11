# Expected behavior and use cases

These scenarios are the product acceptance contract, not a claim that every
behavior has shipped. See the [implementation ledger](IMPLEMENTATION_STATUS.md)
and the feature receipts for the current bounded Linux scope: [Studio
edit/save/recompute](evidence/S2-studio.md), [authored card/KPI
creation](evidence/COMPONENT-CREATION.md), [graphs, timeline and relationship
controls](evidence/GRAPHS.md), and [receipt-guarded HTML capture](evidence/CAPTURE.md).
Studio card/KPI creation is implemented with bounded headless evidence; its
native visual acceptance gate remains pending.

## Normal editing cycle

1. Author `presentation.qmd` with ordinary Quarto content. Run `deno task qbento edit presentation.qmd` to execute Quarto and open Bento Studio with the generated deck.
2. Arrange content in Studio. **Save** persists geometry, styles, animations, decorative elements, and *pending semantic edits*. The QMD is not silently modified.
3. Studio marks changes by slide/element and property. **Sync** previews and applies approved, reversible QMD changes. Visual-only edits stay in `.qbento/`.
4. **Render** executes the QMD again for supported source constructs and combines the new results with saved visual design. Any unresolved conflict or unsupported/lossy change is reported or refused, never discarded silently.
5. Distribute the resulting `.bento.html` or PDF. The HTML is an editable standalone **copy**, not a live write-through to the source project.

Think of three distinct operations: **save = preserve work; sync = reconcile source; render = rebuild**. Pending edits must survive closing Studio.

## Ten practical scenarios

| # | Scenario | Expected result and persistence |
|---|---|---|
| 1 | **Create a scientific deck.** Write slides and R/Python outputs in QMD; open Studio; position text/figures and add a border. | Text/code/results originate in QMD; placement, styling, border live in `.qbento/`. Removing the generated HTML and rebuilding keeps the design. |
| 2 | **Redesign an existing deck.** Apply a reusable two-column layout and customize one slide. | Reusable layouts, local overrides, animations and theme live in `.qbento/`; plain QMD stays readable. Changed text reflows into the same design; overflow is flagged. |
| 3 | **Edit a sentence in Bento.** Change an authored paragraph while reviewing slides. | Studio displays a per-element pending diff; save persists it. Sync patches only the matching QMD span after verifying it; divergent QMD edits become a conflict. |
| 4 | **Recompute after data change.** Add participants and rerun the R analysis. | Updated generated values, figures and tables replace the corresponding computed outputs (using stable provenance IDs), while size/position/style from `.qbento/` remain. Changed aspect ratios/overflow may trigger a warning. |
| 5 | **Create a slide visually.** Add a slide, type conclusions and add shapes. | Before sync, the new slide and its text are durable pending edits. Sync inserts the semantic slide/text into QMD; layout and shapes remain in `.qbento/`. |
| 6 | **Reorder, hide or delete slides.** Drag a slide to another position; hide an appendix; delete obsolete content. | Order changes are pending and sync can reorder QMD sections. Hide preserves source and suppresses the slide in presentation/PDF. Confirmed delete removes the verified QMD section; ambiguous or shared code blocks deletion. |
| 7 | **Edit formulas, displayed code and notes.** Modify an authored LaTeX equation or speaker notes through Studio. | Source LaTeX/text/notes are retained and syncable into QMD; appearance stays in `.qbento/`. Executing code/results are not rewritten by editing their visual output. |
| 8 | **Present computed tables/charts.** Use a simple data frame and a complex `gt` table. | Convert to native Bento table/chart if sufficiently faithful; otherwise retain SVG/HTML projection. Visual formatting can be edited; computed cell values are not reverse-written into code. |
| 9 | **Use Plotly/htmlwidgets.** Include an interactive computed figure. | Standalone Bento and PDF use a static fallback. Supported widgets run in the enhanced Presenter, isolated from BentoDoc and bundled for offline use where feasible. No blanket widget compatibility promise. |
| 10 | **Resume from Git.** Clone QMD, inputs and `.qbento/` on another machine with compatible dependencies. | Rebuild without the previously generated HTML, recovering semantic content and saved visual layout. Source/sidecar diffs are reviewable; conflicting edits are surfaced. |

## Additional scenarios

**Visual objects and meaningful text.** Adding a purely decorative arrow requires no QMD block; optional minimal QMD annotation can signal the slide has extra design. Studio's bounded **Añadir componente** flow creates an authored card or literal-value KPI on an existing source-backed slide. Its role fields are saved as pending semantic content in `.qbento/`; reviewing and applying the complete component promotes it to its exact QMD fenced-div schema while geometry remains in the sidecar. The flow does not infer membership from proximity or arbitrary native grouping. Its native visual acceptance gate remains pending; see [component creation evidence](evidence/COMPONENT-CREATION.md).

**Advanced QMD layout.** A developer may declare `.bento-layout`, `.bento-card`, or specific dimensions in QMD; Studio must respect them. If Studio changes an attribute explicitly present in QMD, mark and sync that field (or keep the QMD version), rather than silently overriding it.

**Calculated values.** A manually typed literal such as `β = .32` never updates with new data. An inline Quarto expression does update; Studio treats it as computed output and cannot overwrite the producing formula by replacing its rendered number.

**Standalone edited HTML.** A recipient may freely edit the exported Bento file. Those edits are independent; a general `qbento import` for arbitrary or independently distributed copies remains unimplemented, and automatic cross-file sync is not promised. **Locally edited project HTML** has a bounded explicit `qbento capture` operation: it requires a valid receipt for the current project publication, checks the published baseline, and stores supported native edits before a subsequent render. Only one capture per publication generation is accepted; stale, foreign, receipt-less and already-consumed copies are refused. Native Bento Save alone writes an HTML file, not `.qbento/`, and a render must not overwrite uncaptured edits silently. See [capture evidence](evidence/CAPTURE.md).

**Agents.** Structured calls can inspect decks, patch visual elements, create/move slides, preview sync and request approved application; agent edits follow exactly the same safety rules as human edits.

## What must not happen

- Saving a visual design unexpectedly rewrites QMD or loses unsynced semantic edits.
- Re-rendering resets manually placed objects or replaces computed values with visual edits.
- Merge picks a conflicting version silently.
- Source patch rewrites unrelated Markdown or deletes shared code.
- A complex table/widget is silently converted to a lower-fidelity representation.
