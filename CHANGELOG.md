# Changelog

## Unreleased — reusable presentation designs

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

These source additions are not part of the published npm `0.1.1` archive.
Extended design registries require this newer runtime; older runtimes refuse
their extra fields. No release, installed-runtime update or platform expansion
is implied.

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
