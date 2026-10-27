# Changelog

## 0.2.0 — 2026-10-27

- Share content-free design packages across independently bound QMD projects.
  Initialize a new deck before its first render or preview/apply a replacement
  in an existing saved project, preserving pending work and native overrides.
- Define bounded title/body/code/card styles, named text/card/code styles and
  slide variants with frames and pure visual decorations. Existing four-field
  themes, saved-state schema 1 and the JSON agent protocol remain compatible.
- Export/import through Studio with a native sample, complete replacement review
  and guarded drafts; use the same checked operations through `qbento design`.
- Sample explicitly mapped local Reveal HTML styles, including Quarto embedded
  stylesheet data, without executing reference scripts or loading remote assets.
  Keep the provenance report separate from the reusable package.
- Add a neutral course example and an explicit SPP/Metropolis reference mapping.
- Reject incompatible text/code styles on single authored objects inside plain
  or nested QMD wrappers before design import or computation.
- Preserve named wrapper styles on headings inside and outside cards, with
  explicit QMD properties retaining precedence over inherited defaults.
- Reject layout column-count changes incompatible with the original QMD before
  design initialization/import or computation.
- Measure styled `.bento-code` wrappers at their selected typography before
  allocating the remaining card space to computed figures.
- Export compact design JSON in CLI and Studio, counting its final newline in
  byte limits so large valid exports remain readable by the bounded importers.
- Preserve list items, paragraphs, nesting and indentation when measuring card
  rows before allocating space to computed figures.
- Use compact registry storage when indentation alone would exceed 256 KiB,
  allowing valid exported packages to initialize and import unchanged while
  retaining readable formatting for smaller registries.
- Add explicit named theme slots and variant-specific role styles for reusable
  teaching compositions, retaining source ownership and native exceptions.
- Compose echoed code, text, figures and bounded native tables inside cards;
  support literal source/result columns, output grids and producer-linked result
  slides without executing a chunk twice or changing QMD.
- Prefer SVG for compatible static R figures unless an explicit source/project
  device or format chooses otherwise. Use real PNG snapshots for Plotly 3D.
- Keep complete computed code/stdout/table data behind opt-in scroll viewports;
  print native slides and full continuation pages in the Presenter parent flow
  instead of clipping long output inside its viewer iframe.
- Interact with supported Plotly scatter/bar and `scatter3d` points/lines in the
  native slide rectangle in Studio and offline standalone HTML. Explicit 3D
  camera saves refresh the static fallback; exploration alone stays transient.
- Import bounded local R-htmlwidget Plotly data without executing artifact
  scripts or fabricating an R execution receipt. Reject ambiguous identifiers
  and read local artifacts through bounded no-follow file descriptors.
- Preserve native chart palette, font and geometry while recomputing data;
  chart values and executable source remain under computational authority.

The owner-authorized `0.2.0` publication completed on 2026-10-27, with npm
`latest` pointing to it. Exact public archive integrity and anonymous npm/mise
installation passed; see [the publication receipt](docs/evidence/NPM-0.2.0.md).
The [Linux source and package qualification](docs/evidence/COMPOSITION-INTERACTIVITY-0.2.0.md)
remains prepublication evidence, including its historical dirty local review
archive, distinct from the clean published artifact at source `5b17bf6`.
Extended design registries require the matching runtime; older runtimes refuse
their extra fields. The owner separately ran the global mise update selecting
`0.2.0` and pinning Node/Deno; selected-CLI version/doctor, complete file/hash
comparison and real rendering passed. No stable v1 or platform expansion is implied.

## 0.1.1 — 2026-10-17

Compatible corrections within the Linux `0.1.x` development series. JSON API
version 1 and saved-state schema version 1 remain unchanged.

- Verify the QMD association consistently in `status`, `diff`, `get`, Studio
  startup and saved-state diagnostics. Reading another document in the same
  directory refuses without creating state, locks or files.
- Expose reviewed selective synchronization through
  `qbento sync deck.qmd --select selection.json` and Studio selection controls,
  bound to document identity and revision. Keep deletion confirmation separate
  from selection.
- Preserve excluded pending work and reject selections that would retire
  excluded changes through a destructive parent operation. Component creation
  remains an atomic semantic group.
- Show full proposed source where supporting identities/annotations are needed,
  invalidate stale selection previews and retain exact-plan verification.
- Explain that successful sync updates QMD while retaining pending edits until
  render verifies them. Studio now states this explicitly after Apply.
- Refresh package installation documentation and publish the `0.1.1` archive
  using the existing hook-free launcher and pinned upstream assets.

See [the correction receipt](docs/evidence/SYNC-SELECTION-0.1.1.md) for
validation and [version policy](docs/NPM.md#development-version-policy). The
exact validated archive is published on npm. This Linux development release does
not declare stable v1 or other platform support.

## 0.1.0 — 2026-10-16

Initial public Linux development CLI on npm. Node launches the bundled
TypeScript application through external Deno; Quarto and computation engines
remain separately installed. Public npm/mise integrity, installation and render
checks are recorded in [the publication receipt](docs/evidence/NPM-CLI.md).
