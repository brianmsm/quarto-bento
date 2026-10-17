# Changelog

## 0.1.1 — prepared, not yet published

Compatible corrections within the Linux `0.1.x` development series. JSON API
version 1 and saved-state schema version 1 remain unchanged.

- Verify the QMD association consistently in `status`, `diff`, `get`, Studio
  startup and saved-state diagnostics. Reading another document in the same
  directory refuses without creating state, locks or files.
- Expose reviewed selective synchronization through
  `qbento sync deck.qmd
  --select selection.json` and Studio selection
  controls, bound to document identity and revision. Keep deletion confirmation
  separate from selection.
- Preserve excluded pending work and reject selections that would retire
  excluded changes through a destructive parent operation. Component creation
  remains an atomic semantic group.
- Show full proposed source where supporting identities/annotations are needed,
  invalidate stale selection previews and retain exact-plan verification.
- Explain that successful sync updates QMD while retaining pending edits until
  render verifies them. Studio now states this explicitly after Apply.
- Refresh package installation documentation and prepare the `0.1.1` archive
  using the existing hook-free launcher and pinned upstream assets.

See [the correction receipt](docs/evidence/SYNC-SELECTION-0.1.1.md) for
validation and [version policy](docs/NPM.md#development-version-policy). Source
preparation is separate from registry publication and does not declare stable v1
or other platform support.

## 0.1.0 — 2026-10-16

Initial public Linux development CLI on npm. Node launches the bundled
TypeScript application through external Deno; Quarto and computation engines
remain separately installed. Public npm/mise integrity, installation and render
checks are recorded in [the publication receipt](docs/evidence/NPM-CLI.md).
