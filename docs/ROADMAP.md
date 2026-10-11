# Implementation roadmap and validation gates

**Status:** planning only. Build toward the [product target](PRODUCT_TARGET.md) in **vertical slices**. A small throwaway exporter is not the goal. The final public v1 release boundary must be frozen before shipping, not guessed by an agent.

## Start here: critical feasibility experiments

| Spike | Question to answer | Evidence required |
|---|---|---|
| **S0 — original visual-overrides loop** | Can a QMD figure produce a BentoDoc with stable `docId`, be visually moved in native Bento, have its HTML changes captured into a sparse sidecar, then be regenerated from changed data without resetting the design? | Minimal QMD → Bento shell → edit native HTML → explicit read-back of `#bento-doc` → write design overrides → change data → regenerate preserving appearance and `docId`. Guard against overwriting an uncaptured HTML. This is a reusable component, **not** a disposable exporter. |
| **S1 — QMD source mapping** | Can we map authored text, headings, fenced divs and chunks back to precise original byte spans after Quarto preprocessing/execution? | Reversible edit of an identified QMD paragraph without changing surrounding Markdown; correct refusal for a computed or ambiguous span. |
| **S2 — Bento editor bridge** | Can Studio observe edits, selections, slide moves, saves, undo/redo, and feed updated BentoDoc back without fighting Bento's own editor? | A live proof with upstream hooks or a small isolated adapter, including save/reopen and identity stability. |
| **S3 — regenerate without resetting design** | Can recomputation replace figures/tables while retaining visual design and object identity? | Changed input dataset → changed SVG/chart data, original placement and styles preserved. |
| **S4 — merge and persistence** | Can independently edited QMD and Studio reconcile safely, including crashes and stale baselines? | Field-level three-way diff, conflict display, atomic patch, durable unsynced edits, clean reload. |

These are **technical gates**, not additional product-policy questions. **Run S0 first or alongside S1/S2**: it validates the original high-value concept without requiring a full Studio UI or semantic reverse editing. S1/S2/S4 are still essential before claiming full bidirectional round-trip. If a spike fails, document the limitation, test an alternative and propose a conscious spec change only if unavoidable.

**Verified so far:** local Quarto 1.10.19 produced `demo.bento.html` from a throwaway `check-html` format using `output-ext: bento.html`; this **only proves Quarto custom-format output naming**, not actual BentoDoc generation, editor behavior, or read-back. A bare unsuffixed `check` format failed. The test directory was removed.

## First vertical slice — definition of done

Use **one `presentation.qmd`** containing:
- authored heading and paragraph;
- an executable R chunk rendering a vector figure from a small external dataset;
- at least two existing slides.

Workflow to demonstrate end-to-end:

1. Build a Bento deck and open it in Studio.
2. Move/resize/style the computed figure; add a purely visual shape.
3. Edit authored text, create a slide with text, and reorder slides.
4. Save, close and reopen Studio **before** syncing: all visual and pending semantic edits must survive.
5. Inspect per-element divergences; preview and safely sync authored text/new-slide/order edits to QMD.
6. Change the dataset, re-execute Quarto; figure output changes while Bento arrangement survives.
7. Deliberately edit the same QMD/Bento text independently; verify visible conflict and **no silent overwrite**.
8. Remove the generated HTML; rebuild using only QMD + inputs + versioned `.qbento/` on a compatible environment.
9. Check QMD/Git diffs: no unrelated Markdown churn, lost decorations or fake reverse edits to R code.

**Passing this slice establishes the project's core value.** It does not prove full compatibility with arbitrary QMD syntax or every Bento feature.

## Subsequent vertical slices (proposed order)

| Sequence | Scope |
|---|---|
| 2 | Hardening: source IDs, annotations levels, QMD attrs, more source maps, robust save journal, diagnostics, safe delete/hide/restore. |
| 3 | Reusable layouts/themes, slide notes, math and displayed code round-trip, motion/morph and visual validation. |
| 4 | Native charts/simple tables with fidelity checks; static SVG fallbacks for complex graphics/`gt`/`gtsummary`. |
| 5 | Plotly/htmlwidgets static projection plus isolated enhanced offline Presenter; PDF fidelity and exports. |
| 6 | Cross-platform packaging, first-class agent JSON API and optional MCP, expanded Git/CI tests, multi-QMD project support. |
| Later | Importing independently edited Bento HTML, optional collaborative integration with upstream Bento CRDT. |

Sequences are illustrative; features may move earlier to support validation without changing the agreed full target.

## Concrete items to design after the spikes

- Versioned Deck IR and Bento adapter schemas, provenance/semantic IDs and morph identity mapping.
- Precise on-disk `.qbento/` schemas, pending edit journal, baseline snapshots, Git behavior and migrations.
- Studio bridge strategy (upstream contribution vs compatibility adapter), editor lifecycle, sync inspector UX.
- Safe source edit transactions/rollback, strict CI behavior and diagnostics contracts.
- Reproducibility tests and pixel/geometry tolerance policy (not cross-OS pixel identity).
- Quarto extension and Deno runtime integration; verify API/chunk-annotation syntax against actual upstream versions.
- Classification of lossless/lossy component conversions; widget sandbox and offline bundling.

## Out of scope for initial implementation

- Automatically managing `renv`, `uv`, Docker, packages or computation environments. Users supply compatible dependencies.
- Multi-file QMD editing (the data model should prepare for it).
- Live multi-user Bento collaboration / CRDT ↔ QMD mediation.
- Full round-trip of edits made independently in distributed `.bento.html` copies.
- Perfect visual equivalence of optional Reveal.js output with Bento.
- Universal Plotly/htmlwidgets or pixel-identical rendering across platforms.

## Suggested next-session action

1. Inspect/pin Bento upstream, then run **S0** (the simple QMD → Bento → visual override → regenerated Bento loop). Reuse its output and adapter in later slices; don't build a throwaway converter.
2. Test **S1** (accurate source mapping) and **S2** (Studio editor bridge) separately. Record measured limits, update `ARCHITECTURE.md` and `AUTHORING.md` as needed; don't prematurely commit to a permanent Bento fork.
3. Complete **S3/S4** and the first full bidirectional vertical slice only after source mapping and Studio integration are credible.

Useful references:
- Bento: https://github.com/nyblnet/bento
- Bento model: https://github.com/nyblnet/bento/blob/main/slides/src/model.ts
- Bento agent/document interface: https://github.com/nyblnet/bento/blob/main/docs/agents.md
- Quarto custom formats: https://quarto.org/docs/extensions/formats.html
- Quarto source maps: https://github.com/posit-dev/quarto-source-map
