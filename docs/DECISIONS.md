# Decision record — Architecture & Design v0.2

**As of 2026-10-09.** This is the agreed **target behavior**, not a feature-completion report. `quarto-bento` and `qbento` are provisional names.

## Accepted / settled decisions

| Topic | Decision |
|---|---|
| Product | Public, general-purpose Quarto ↔ Bento authoring layer; **not merely an exporter**. |
| Authority | QMD = semantic/computational source; `.qbento/` = visual/design state. Explicit visual attributes in QMD are also honored and synchronized by field. |
| Editing | Text, authored LaTeX, displayed code, speaker notes, slide creation/order/deletion editable in Bento with visible pending sync. Decorative Bento-only objects need no semantic QMD representation. |
| Saving | Save unsynced edits durably; **save does not imply QMD sync**. Re-render never silently destroys them. |
| Merge | Semantic, field-granular three-way merge using last confirmed baseline; visible divergences/conflicts and previewable choices. No silent conflict resolution. |
| Source changes | Surgical verified patches, not whole-file Pandoc Markdown regeneration. Stable provenance/IDs and source spans required. |
| Computed output | Regenerate from code; no fabricated reverse mapping of edited numbers/figures into R/Python. Offer restore, edit source, or explicit detach. |
| Content vs design | Semantically meaningful text in visual components belongs to QMD after sync; pure graphics stay in `.qbento/`. |
| QMD authoring | Ordinary Markdown, optional declarative `.bento-*` components, and optional advanced layout/style attributes. Remain editable from Bento. |
| Annotations | Configurable `none` / `minimal` (default) / `detailed` **informational** QMD annotations. Necessary semantic structure and technical IDs are not optional. |
| Slides | Create, reorder, hide, restore, delete from Bento. Confirmed deletion changes QMD; hide retains it. |
| Layouts/themes | Reusable, first-class; editable from QMD and Studio; design persisted in `.qbento/`. |
| Rendering | Bento HTML and PDF primary; Reveal.js optional secondary output, without design-parity promise. SVG preferred for static computed vector figures. |
| Figures/tables | Native Bento charts/tables only when fidelity is adequate; complex visuals may use SVG/HTML projections. |
| Widgets | Static compatible fallback for standalone Bento/PDF; supported widgets interactive in enhanced Presenter, isolated from pure-data BentoDoc; offline where dependencies can be bundled. |
| Reproducibility | Source + input data + visual state + **user-provided compatible runtime/packages** reconstruct the presentation. `renv`/`uv`/Docker are user-controlled optional recommendations, **not managed by qbento**. |
| Distribution | Editable standalone `.bento.html` is an independent copy; importing/reconciling later is separate functionality. |
| Git/offline/platforms | Git-first sources, offline ordinary workflow, Linux/macOS/Windows target; Linux first for development. |
| Languages | R is an important use case, but core independent of R (Quarto/Pandoc execution handles R/Python/Julia/etc.). |
| Agents | Structured JSON core operations/CLI from the start; MCP/agent interfaces can be added on top. |
| Collaboration | **Disabled in initial implementation**; revisit Bento CRDT collaboration later. |
| Bento integration | Upstream first; allow small compatibility adapter if necessary; avoid maintaining a permanent fork unless unavoidable. |
| Scope | v1 is the **full target**, developed in vertical slices; do not make a throwaway architecture. [PRODUCT_TARGET.md](PRODUCT_TARGET.md) gives behavioral acceptance; the specific public release boundary still requires explicit confirmation. |
| First project scope | Single `.qmd` for first working implementation; data models prepare for multifile sources later. |

## Proposed technical choices (not frozen)

- Deck IR between Quarto/Pandoc and BentoDoc; QMD source scanner/mapping plus a separate design state and sync engine.
- TypeScript core, Deno runtime/CLI, Lua filters, TypeScript Studio, JSON Schema, pinned Bento upstream shell.
- `qbento edit/render/status/diff/sync/validate/doctor`; `qbento init` and `qbento import` under consideration.
- `.qbento/{deck.yml,theme.yml,sync.lock.json,slides/,layouts/,assets/,widgets/}` as conceptual structure. **Preserve Bento `docId` across regenerations**, likely in `deck.yml`, and prefer sparse, stable-ID-keyed **visual overrides** for QMD-backed elements; keep Bento-only objects and pending/detached semantic content separately. These storage choices are provisional; exact schemas, baseline snapshots, journal and filenames remain open.
- A **local HTML capture/reconcile** mode may extract `#bento-doc` from a Bento-saved generated file, compare it to a pinned baseline and store safe visual changes in `.qbento/` without Studio. This is distinct from arbitrary third-party HTML import; automatic reverse conversion to QMD is **not** assumed.
- Syntax examples in `AUTHORING.md` are proposed extension contracts; verify parsing/Quarto integration first. Do **not** assume bare `format: bento` or `quarto bento` is registered by a Quarto extension; a suffixed format such as `qbento-html` and the separate `qbento` CLI are more realistic.

## How the original September proposal fits

The original `QMD → Bento base → _bento/overrides.json → .bento.html` model **remains valid for visual edits** and is the simplest useful proof of concept. The later `.qbento/` design generalizes `_bento/`: it does not require a literal `overrides.json` filename. Deck IR adds typed provenance; Studio and three-way merge add safe **optional semantic round-trip**. Original `linked/detached` becomes authored/computed provenance plus explicit detach/pending-sync; dragging an object still never rewrites QMD. The original `quarto bento sync` syntax is replaced by the proposed `qbento sync` CLI. A Quarto format extension and render scripts are viable integration points, but the Bento shell assembly, live editor bridge and QMD source mapping still need proof.

## Technical unknowns (not new product decisions)

1. Efficient, reliable observation/control of Bento editor changes and selection through upstream hooks or adapter.
2. Faithful QMD source mapping through reader transforms, execution, includes, and inline computations; atomic patches.
3. IR ↔ Bento projection with stable element identity/morph semantics and safe recomputation preserving visual edits.
4. Specific baseline, save-journal, conflict transaction, widgets/Presenter, and version-compatibility implementations.

See `ROADMAP.md` for experiments and acceptance criteria. Do not change a settled product choice because an initial integration attempt is inconvenient; record trade-offs and propose a conscious revision.
