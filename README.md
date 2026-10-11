# Quarto-Bento (working name: `qbento`)

**Status:** implementation in progress (2026-10-11). The executed Quarto
renderer, native Bento bridge, local Studio save, source-patch primitives and
persistent three-way state core exist. The supported first bidirectional Linux
workflow is [demonstrated end to end](docs/evidence/FIRST-SLICE.md); the full
product target is **not yet complete**. See
[implementation ledger](docs/IMPLEMENTATION_STATUS.md).

Quarto-Bento aims to combine **computationally reproducible Quarto
presentations** with **Bento's fast visual slide editor**, without losing visual
edits when results are regenerated.

## The user contract

- **`.qmd` owns meaning:** authored text, executable code, equations, notes,
  semantic structure, and references to computed outputs.
- **`.qbento/` owns presentation:** stable-ID-keyed visual overrides, layouts,
  animations, decorative elements, and synchronization metadata. It also holds
  recoverable _pending_ edits and explicitly detached content until otherwise
  resolved.
- **`.bento.html` is a rebuildable output**, not the project's only source. A
  distributed standalone HTML remains editable as an independent copy.
- **Bento can edit semantics:** these edits are saved as pending changes and
  deliberately synchronized to QMD; saving a deck alone does _not_ silently
  rewrite QMD.
- **Regenerating Quarto updates computed results without discarding retained
  visual design.** Conflicts are reported; nothing is silently overwritten.

## Run the current development build

See [the practical usage guide](docs/USAGE.md) for the implemented save, review,
sync, rebuild and delivery workflows.

Requires installed Deno 2, Quarto and the language/packages used by your QMD.
The bundled Bento shell is pinned; ordinary rendering and editing need no cloud
service or downloaded runtime assets. The project does not manage your R/Python
environment.

```sh
deno task qbento doctor
deno task qbento render fixtures/basic/presentation.qmd
deno task qbento edit fixtures/basic/presentation.qmd
deno task qbento status fixtures/basic/presentation.qmd
deno task test
```

To build a portable development directory with launchers and the pinned offline
runtime, run `deno task package /absolute/path/to/new-directory`. See
[packaging instructions and platform evidence](docs/PACKAGING.md). This requires
installed Deno/Quarto and does not install computation environments.

`edit` prints a loopback Studio URL. Open that address in a browser. **Guardar
proyecto** saves durable visual and pending semantic edits to `.qbento/` without
changing QMD. Native Bento's own Save still saves a standalone HTML file.
Capture native local edits explicitly with
`deno task qbento capture path.qmd
[edited-copy.html]` before regeneration. A
changed uncaptured output is refused.

Currently demonstrated projection includes plain QMD headings and paragraphs,
supported rich text in identified fenced divs, displayed code, identified
display equations and speaker notes, R-generated SVG figures, plain tables,
bounded native charts, cards, named two-column layouts, source-authored
`.bento-kpi` components, and bounded source `.bento-diagram` and
`.bento-timeline` components. Plain QMD can acquire stable identities only
through an inspectable reviewed source plan; save and render do not add them
implicitly. Native Studio also supports reviewed deletion of bounded
source-backed elements and explicit creation of authored cards and literal-value
KPI components on existing source slides. Saving a created component leaves
QMD unchanged; its authored members remain pending until reviewed together in
the source-sync plan. The Studio KPI value is text, not a computed expression.
Focused component and Studio tests exist; visual acceptance of this creation
flow in the native editor has not yet been recorded. These adapters do not imply
support for every QMD construct. Reproducible sources include:

- [Semantic round-trip](examples/semantic-roundtrip/deck.qmd)
- [Native tables](examples/native-tables/deck.qmd)
- [Native charts](examples/native-charts/deck.qmd)
- [Computed gt/gtsummary tables](examples/rich-tables/deck.qmd)
- [Two-column components](examples/components/deck.qmd)
- [Source-authored KPI components](examples/kpi/deck.qmd)
- [Bounded diagrams and timelines](examples/source-graphs/deck.qmd) (see
  [Linux graph evidence](docs/evidence/GRAPHS.md#integrated-studio-acceptance-on-linux))
- [Offline Plotly](examples/plotly-offline/deck.qmd)

Examples use their accompanying CSV inputs. The rich-table example also uses
`participants.csv`. Bounded `gt`/`gtsummary` output is captured as a complete 2x
PNG with its source formatting; native slide and offline PDF inspection are
recorded in [rich-table evidence](docs/evidence/RICH-TABLES.md). Rendering that
fallback requires an installed Chromium. Unknown conversions refuse rather than
invent a result. Studio supports text/structural review, reversible slide
actions and fresh conflict resolution. Reviewed source-element deletion can be
restored before approval and safely applied for supported source units; see the
[deletion evidence](docs/evidence/ELEMENT-DELETION.md). New standalone native
text can be reviewed and inserted into an existing identified QMD slide, then
regenerated with its saved geometry and style; see the
[insertion scope and native acceptance](docs/evidence/TEXT-INSERTION.md). See
the bounded [component evidence](docs/evidence/COMPONENTS.md). Source diagrams
and timelines use declared node and relationship IDs, literal labels, and a
bounded native layout; unsupported topology or text metrics refuse before
publication. Their exact source contract and Linux validation are documented
with the [example](examples/source-graphs/README.md) and
[graph evidence](docs/evidence/GRAPHS.md). The guarded
`qbento-html` extension executes Quarto once per render (verified on Linux). The
static standalone/PDF workflow has
[offline browser evidence](docs/evidence/OFFLINE-PDF.md). Supported Plotly
scatter/bar output now produces a static SVG in native Bento and a separate
isolated interactive view through Studio's **Presentar con gráficos**. Saved
geometry survives changed-data regeneration; headless Chromium validation
exercised native hover and zoom offline. Rendering requires compatible installed
R Plotly and Chromium dependencies; the emitted Presenter bundles its runtime
locally. Interactive widgets are separate views, rather than overlays at the
slide's exact geometry. See
[Plotly scope and evidence](docs/evidence/PLOTLY.md). Broader semantic/content
adapters, arbitrary widgets and native cross-platform validation remain in
progress. The implementation ledger is the authority for acceptance evidence;
the target documentation below remains the intended product contract.

## Current commands and product boundary

```sh
qbento edit presentation.qmd     # Generate/open Bento Studio
qbento status presentation.qmd   # Inspect pending changes
qbento diff presentation.qmd     # Preview divergence
qbento sync presentation.qmd     # Review/apply semantic patches
qbento render presentation.qmd   # Rebuild output
qbento get presentation.qmd      # Read the saved deck and its checked revision
qbento patch presentation.qmd patch.json # Save bounded structured edits
```

The versioned [JSON agent API](docs/AGENT-API.md) supports existing-element and
slide fields, order, hide/show and bounded authored slide creation with strict
document/revision checks. Creation requires a current executed source baseline;
it accepts native text and decorative shapes. The API saves the same visual
state and pending semantic changes as Studio; it does not implicitly synchronize
QMD. Reviewed deletion remains available through Studio.

Ordinary `quarto render presentation.qmd` is supported through the installed
`qbento-html` extension after `qbento init presentation.qmd`; see
[Quarto integration evidence](docs/evidence/QUARTO.md). PDF is generated from
Bento; Reveal.js remains an optional secondary output without visual parity
guarantees. These commands belong to the current development build and do not
establish full product or native cross-platform release acceptance.

**Save ≠ sync ≠ render.** Save persists Studio edits (including unsynchronized
content); sync writes approved changes to QMD; render recomputes and combines
QMD with saved visual state.

Studio's **Diseños y temas** edits the project's named layouts and basic themes.
**Guardar diseños** updates `.qbento/design.json`; **Recalcular** applies its
defaults while preserving saved overrides and pending content. Explicit QMD
attributes retain their authority. See the
[registry contract](docs/DESIGN_REGISTRY.md) and
[save/conflict/recovery evidence](docs/evidence/STUDIO-REGISTRY.md).

### Proposed project files

```text
presentation.qmd           # Semantic/computational source
.qbento/
  deck.yml                 # Project/slide metadata
  theme.yml                # Theme
  layouts/                 # Reusable layouts
  slides/                  # Per-slide design and Bento-only objects
  assets/                  # Design assets
  widgets/                 # Interactive-widget support material
  sync.lock.json           # Versioned synchronization baseline
presentation.bento.html    # Generated artifact (usually not committed)
```

This directory layout and filenames are **proposed**, not finalized schemas. As
in the original design, source-backed objects need only **visual overrides**
(e.g. a figure's `x/y/w/h`), not a second copy of computed results. Bento-only
elements and pending/detached content require their own persisted records. A
stable **Bento `docId`** must be saved in project metadata and reused on every
regeneration; do not regenerate it with the HTML.

The current implementation persists project identity in `.qbento/project.json`
and checksummed design, baselines and pending edits in `.qbento/state.json`.
Version both files with QMD and inputs; build artifacts and history are
rebuildable or recovery material. The detailed split shown above remains a
future storage design. **Directly saving a generated `.bento.html` edits that
file, not `.qbento/`**: the explicit `qbento capture` command can capture a
copy with a matching project publication receipt and generation. Capture it
before the next render. It is not an import path for arbitrary or independently
distributed HTML. See [capture evidence](docs/evidence/CAPTURE.md),
[ARCHITECTURE.md](docs/ARCHITECTURE.md), and [SYNC.md](docs/SYNC.md).

## Reproducibility boundary

Given a **compatible execution environment**, the QMD, inputs, and `.qbento/`
must regenerate the content and retained design. Quarto-Bento **does not
install, lock, or manage** R/Python/Julia packages or environments. Tools such
as `renv`, `uv`, and Docker are optional user choices, not Quarto-Bento
dependencies or requirements. Pixel-identical output across platforms is not
promised.

## Documentation / start a new session here

The [Spanish usage guide](docs/USAGE.md) describes the current development
commands and Studio controls. The specifications below define the product
destination and its accepted contracts.

1. [PRODUCT_TARGET.md](docs/PRODUCT_TARGET.md) — product horizon and criteria
   for calling a milestone or v1 complete.
2. [DECISIONS.md](docs/DECISIONS.md) — accepted decisions vs provisional
   choices.
3. [WORKFLOWS.md](docs/WORKFLOWS.md) — expected behavior and ten practical
   scenarios.
4. [AUTHORING.md](docs/AUTHORING.md) — QMD components, attributes, annotation
   levels.
5. [SYNC.md](docs/SYNC.md) — ownership, three-way merge, pending edits, safe
   writes.
6. [ARCHITECTURE.md](docs/ARCHITECTURE.md) — conceptual components and
   integration boundaries.
7. [ROADMAP.md](docs/ROADMAP.md) — high-risk experiments, first vertical slice,
   acceptance tests.

For coding agents, read [AGENTS.md](AGENTS.md) first, then the current
[implementation ledger](docs/IMPLEMENTATION_STATUS.md). The original design
documents describe target behavior; do not equate an implemented primitive with
an accepted end-to-end milestone.
