# Quarto-Bento (working name: `qbento`)

**Status:** Architecture & Design v0.2 — decisions recorded, **not implemented** (2026-10-09).

Quarto-Bento aims to combine **computationally reproducible Quarto presentations** with **Bento's fast visual slide editor**, without losing visual edits when results are regenerated.

## The user contract

- **`.qmd` owns meaning:** authored text, executable code, equations, notes, semantic structure, and references to computed outputs.
- **`.qbento/` owns presentation:** stable-ID-keyed visual overrides, layouts, animations, decorative elements, and synchronization metadata. It also holds recoverable *pending* edits and explicitly detached content until otherwise resolved.
- **`.bento.html` is a rebuildable output**, not the project's only source. A distributed standalone HTML remains editable as an independent copy.
- **Bento can edit semantics:** these edits are saved as pending changes and deliberately synchronized to QMD; saving a deck alone does *not* silently rewrite QMD.
- **Regenerating Quarto updates computed results without discarding retained visual design.** Conflicts are reported; nothing is silently overwritten.

## Intended workflow (commands are proposed, not yet available)

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

Unsynced Studio edits must be persisted/recoverable independently of the generated HTML; their precise storage is pending design. **Directly saving a generated `.bento.html` edits that file, not `.qbento/`**: a local explicit capture/import path is a viable secondary workflow, but must run before any render that would overwrite that changed HTML. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [SYNC.md](docs/SYNC.md).

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

For coding agents, read [AGENTS.md](AGENTS.md) first. **No implementation, CLI, extension, schema, or Studio has yet been delivered by this documentation-only phase.**
