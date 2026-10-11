# Quarto-Bento (working name: `qbento`)

**Status:** implementation in progress (2026-10-11). The executed Quarto renderer,
native Bento bridge, local Studio save, source-patch primitives and persistent
three-way state core exist. The supported first bidirectional Linux workflow is
[demonstrated end to end](docs/evidence/FIRST-SLICE.md); the full product target is
**not yet complete**. See [implementation ledger](docs/IMPLEMENTATION_STATUS.md).

Quarto-Bento aims to combine **computationally reproducible Quarto presentations** with **Bento's fast visual slide editor**, without losing visual edits when results are regenerated.

## The user contract

- **`.qmd` owns meaning:** authored text, executable code, equations, notes, semantic structure, and references to computed outputs.
- **`.qbento/` owns presentation:** stable-ID-keyed visual overrides, layouts, animations, decorative elements, and synchronization metadata. It also holds recoverable *pending* edits and explicitly detached content until otherwise resolved.
- **`.bento.html` is a rebuildable output**, not the project's only source. A distributed standalone HTML remains editable as an independent copy.
- **Bento can edit semantics:** these edits are saved as pending changes and deliberately synchronized to QMD; saving a deck alone does *not* silently rewrite QMD.
- **Regenerating Quarto updates computed results without discarding retained visual design.** Conflicts are reported; nothing is silently overwritten.

## Run the current development build

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
Capture native local edits explicitly with `deno task qbento capture path.qmd
[edited-copy.html]` before regeneration. A changed uncaptured output is refused.

Currently demonstrated projection: explicit slide headings, supported rich text
in identified fenced divs, displayed code, and R-generated SVG figures.
Unknown conversions refuse rather than
invent a result. Studio supports text/structural review and fresh conflict resolution. The guarded
`qbento-html` extension executes Quarto once per render (verified on Linux).
The static standalone/PDF workflow has [offline browser evidence](docs/evidence/OFFLINE-PDF.md).
Broader semantic/content adapters, enhanced Presenter and native cross-platform
validation remain in progress. The implementation ledger is
the authority for acceptance evidence; the target documentation below remains
the intended product contract.

## Intended installed workflow (not all commands are delivered yet)

```sh
qbento edit presentation.qmd     # Generate/open Bento Studio
qbento status presentation.qmd   # Inspect pending changes
qbento diff presentation.qmd     # Preview divergence
qbento sync presentation.qmd     # Review/apply semantic patches
qbento render presentation.qmd   # Rebuild output
```

`quarto render presentation.qmd` should also remain supported through a compatible **custom format extension** (the exact format key is not finalized; Quarto commonly uses a suffix such as `qbento-html`). PDF is generated from Bento; Reveal.js is only an optional secondary output without visual parity guarantees.

**Save ≠ sync ≠ render.** Save persists Studio edits (including unsynchronized content); sync writes approved changes to QMD; render recomputes and combines QMD with saved visual state.

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

This directory layout and filenames are **proposed**, not finalized schemas. As in the original design, source-backed objects need only **visual overrides** (e.g. a figure's `x/y/w/h`), not a second copy of computed results. Bento-only elements and pending/detached content require their own persisted records. A stable **Bento `docId`** must be saved in project metadata and reused on every regeneration; do not regenerate it with the HTML.

The current implementation persists project identity in `.qbento/project.json`
and checksummed design, baselines and pending edits in `.qbento/state.json`.
Version both files with QMD and inputs; build artifacts and history are rebuildable
or recovery material. The detailed split shown above remains a future storage design. **Directly saving a generated `.bento.html` edits that file, not `.qbento/`**: a local explicit capture/import path is a viable secondary workflow, but must run before any render that would overwrite that changed HTML. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [SYNC.md](docs/SYNC.md).

## Reproducibility boundary

Given a **compatible execution environment**, the QMD, inputs, and `.qbento/` must regenerate the content and retained design. Quarto-Bento **does not install, lock, or manage** R/Python/Julia packages or environments. Tools such as `renv`, `uv`, and Docker are optional user choices, not Quarto-Bento dependencies or requirements. Pixel-identical output across platforms is not promised.

## Documentation / start a new session here

1. [PRODUCT_TARGET.md](docs/PRODUCT_TARGET.md) — product horizon and criteria for calling a milestone or v1 complete.
2. [DECISIONS.md](docs/DECISIONS.md) — accepted decisions vs provisional choices.
3. [WORKFLOWS.md](docs/WORKFLOWS.md) — expected behavior and ten practical scenarios.
4. [AUTHORING.md](docs/AUTHORING.md) — QMD components, attributes, annotation levels.
5. [SYNC.md](docs/SYNC.md) — ownership, three-way merge, pending edits, safe writes.
6. [ARCHITECTURE.md](docs/ARCHITECTURE.md) — conceptual components and integration boundaries.
7. [ROADMAP.md](docs/ROADMAP.md) — high-risk experiments, first vertical slice, acceptance tests.

For coding agents, read [AGENTS.md](AGENTS.md) first, then the current
[implementation ledger](docs/IMPLEMENTATION_STATUS.md). The original design
documents describe target behavior; do not equate an implemented primitive with
an accepted end-to-end milestone.
