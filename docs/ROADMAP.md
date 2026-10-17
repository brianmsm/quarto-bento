# Implementation roadmap and validation gates

**Status:** Linux-local implementation objective completed 2026-10-13;
public source publication authorized. Runtime `2ee7974` passed 578 tests and
4 steps without failure, plus a 117-file portable reconstruction smoke.
The product horizon and public v1 boundary remain distinct from this closeout.
See [PUBLICATION.md](PUBLICATION.md) for source-publication scope. The
bounded Linux implementation now includes source-authored diagrams/timelines
and explicit Studio card/KPI creation alongside the first bidirectional slice.
Studio also provides guarded **Relaciones** selectors for paired endpoints in
existing source diagrams; timeline adjacency is displayed read-only. Bounded
Linux headless acceptance covers graph rendering/round trips and the newer
relationship controls in the [graph receipt](evidence/GRAPHS.md#explicit-relationship-controls-accepted-on-linux),
and the Studio card/KPI creation workflow in the [component creation
receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).
These receipts exercise the real Studio client and pinned Bento editor in
headless Chromium; they do not claim foreground desktop or other-platform
acceptance. Consult [the authoring contract](AUTHORING.md) and
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current scope and
unfinished work. Build toward the [product target](PRODUCT_TARGET.md)
in **vertical slices**. A small throwaway exporter
is not the goal. The final public v1 release boundary must be frozen before
shipping, not guessed by an agent.

## Original feasibility gates — bounded Linux proof integrated

The questions below defined the initial feasibility work. The integrated Linux
implementation now demonstrates bounded S0–S4 workflows; those questions are
acceptance criteria and historical context, not instructions to repeat the
spikes. Use [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current
evidence and remaining work. The proofs do not imply support for arbitrary QMD
or every Bento operation.

| Spike | Question to answer | Evidence required |
|---|---|---|
| **S0 — original visual-overrides loop** | Can a QMD figure produce a BentoDoc with stable `docId`, be visually moved in native Bento, have its HTML changes captured into a sparse sidecar, then be regenerated from changed data without resetting the design? | Minimal QMD → Bento shell → edit native HTML → explicit read-back of `#bento-doc` → write design overrides → change data → regenerate preserving appearance and `docId`. Guard against overwriting an uncaptured HTML. This is a reusable component, **not** a disposable exporter. |
| **S1 — QMD source mapping** | Can we map authored text, headings, fenced divs and chunks back to precise original byte spans after Quarto preprocessing/execution? | Reversible edit of an identified QMD paragraph without changing surrounding Markdown; correct refusal for a computed or ambiguous span. |
| **S2 — Bento editor bridge** | Can Studio observe edits, selections, slide moves, saves, undo/redo, and feed updated BentoDoc back without fighting Bento's own editor? | A live proof with upstream hooks or a small isolated adapter, including save/reopen and identity stability. |
| **S3 — regenerate without resetting design** | Can recomputation replace figures/tables while retaining visual design and object identity? | Changed input dataset → changed SVG/chart data, original placement and styles preserved. |
| **S4 — merge and persistence** | Can independently edited QMD and Studio reconcile safely, including crashes and stale baselines? | Field-level three-way diff, conflict display, atomic patch, durable unsynced edits, clean reload. |

These were **technical gates**, not product-policy questions. Their successful
bounded Linux workflows are recorded in the implementation ledger and linked
evidence. Remaining acceptance work extends those workflows; it does not reopen
the settled authority, persistence or conflict decisions.

**Initial design experiment (superseded by the integrated evidence):** local Quarto 1.10.19 produced `demo.bento.html` from a throwaway `check-html` format using `output-ext: bento.html`; this **only proves Quarto custom-format output naming**, not actual BentoDoc generation, editor behavior, or read-back. A bare unsuffixed `check` format failed. The test directory was removed.

## First vertical slice — acceptance definition and result

The bounded Linux first slice has been demonstrated end to end; see
[first-slice evidence](evidence/FIRST-SLICE.md). The definition below remains
the acceptance baseline, not a claim of full QMD or platform compatibility.

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

## Broader product slices (original proposed grouping)

This grouping predates several integrated features and is not the current task
list. Use the implementation ledger to see which parts have evidence and which
gates remain.

The source graph/timeline adapter, explicit Studio-authored card/KPI promotion,
and bounded Studio relationship selectors are additional slices beyond that
original grouping. Relationship Save records a checked `from`/`to` pair as
pending project state; reviewed Apply writes QMD, and Recalculate executes it.
Timeline relations remain read-only and derive from source milestone order.
These slices do not make arbitrary native graphs, inferred component
membership, or every QMD/Bento construct part of the supported workflow. The
graph evidence distinguishes source/core tests, native editor acceptance, and
remaining limits.

| Sequence | Scope |
|---|---|
| 2 | Hardening: source IDs, annotations levels, QMD attrs, more source maps, robust save journal, diagnostics, safe delete/hide/restore. |
| 3 | Reusable layouts/themes, slide notes, math and displayed code round-trip, motion/morph and visual validation. |
| 4 | Native charts/simple tables with fidelity checks; static SVG fallbacks for complex graphics/`gt`/`gtsummary`. |
| 5 | Plotly/htmlwidgets static projection plus isolated enhanced offline Presenter; PDF fidelity and exports. |
| 6 | Cross-platform packaging, first-class agent JSON API and optional MCP, expanded Git/CI tests, multi-QMD project support. |
| Later | Importing independently edited Bento HTML, optional collaborative integration with upstream Bento CRDT. |

Sequences are illustrative; features may move earlier to support validation without changing the agreed full target.

## Initial design backlog (partly superseded by implementation)

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

## Completed local objective and public source publication

The owner closed the Linux-local implementation objective on 2026-10-13 and
now authorizes publication of the source repository as
[`brianmsm/quarto-bento`](https://github.com/brianmsm/quarto-bento). See
[the publication scope](PUBLICATION.md) and
[the latest security/dependency receipt](evidence/SECURITY-LINUX.md).
Runtime `2ee7974` passed **578 tests and 4 steps, zero failures**; the clean
**117-file portable smoke** rebuilt from QMD and minimal saved state. The
published source documentation preserves the bounded codecs and separates
local runtime evidence from future v1 and distribution requirements.

The complete ordinary and redesign integrations remain recorded in
[ordinary Linux acceptance](evidence/ORDINARY-INTEGRATED-LINUX.md) and
[combined redesign acceptance](evidence/REDESIGN-INTEGRATED-LINUX.md). Their
older suite/artifact counts describe those earlier revisions. The initial
startup sequence—pin upstream, prove S0, then S1/S2/S4—is complete for the
supported scope and must not be repeated as unimplemented work.

## Compatible correction prepared and validated

The `0.1.1` implementation exposes selected source-sync batches and consistent
read-only source binding, and clarifies the post-Apply approval lifecycle.
See [the changelog](../CHANGELOG.md) and [correction receipt](evidence/SYNC-SELECTION-0.1.1.md).
The completed broad run and targeted fixture/source-comparison reruns cover
602 distinct cases; the receipt preserves the initial fixture failures. This
preserves prior Linux acceptance and the bounded codecs. Registry publication
remains a separate action.

## Future acceptance and distribution work

- Freeze an explicit feature/platform boundary before declaring a public v1.
  Public source publication is authorized; it does not make that decision.
- The Linux-only npm CLI `@brianmsm/quarto-bento@0.1.0` is published. Public npm
  and mise installation/rendering, archive integrity and 117 installed payload
  hashes passed on 2026-10-16. Earlier offline relocation/rebuild and loopback
  mise checks remain separately documented. See [NPM.md](NPM.md) and
  [the receipt](evidence/NPM-CLI.md). Continue provenance follow-up and use a new
  package version for future changes; this development release does not freeze v1.
- Preserve the complete supplied project/third-party notices and exact
  production-archive supplement. The owner-selected MIT License uses Brian
  Norman Peña Calero as holder. Four historical full-license-source cases remain
  unresolved; [the exact source audit](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
  records retrieval failures and source/package discrepancies. Do not substitute
  modern upstream files for the pinned packages' provenance.
- Retain the two advisories in the upstream build-only dependency graph as
  explicit upstream-rebuild follow-up. The production npm check reported zero
  advisories on its recorded date; advisory results are time-dependent and do
  not constitute a complete runtime security guarantee.
- Keep the strict widget SVG assertion and opt-in failure evidence. The prior
  intermittent mismatch has no established cause; successful later runs do not
  prove its cause fixed.
- Add evidence for new execution engines without introducing environment
  management. Current execution receipts cover installed R and Python through
  knitr/reticulate. Quarto's Jupyter engine and Julia are not qualified here.
- Windows/macOS remain pending future work outside the completed objective.
  Hosted CI is deferred. The workflow file is a manual-only Linux smoke recipe,
  not a hosted success receipt or other-platform claim.

These items preserve the longer-term product horizon and do not reopen the
completed local Linux objective. Refer to [the acceptance checklist](ACCEPTANCE_GAPS.md)
and [implementation ledger](IMPLEMENTATION_STATUS.md) before selecting future
work.

Useful references:
- Bento: https://github.com/nyblnet/bento
- Bento model: https://github.com/nyblnet/bento/blob/main/slides/src/model.ts
- Bento agent/document interface: https://github.com/nyblnet/bento/blob/main/docs/agents.md
- Quarto custom formats: https://quarto.org/docs/extensions/formats.html
- Quarto source maps: https://github.com/posit-dev/quarto-source-map
