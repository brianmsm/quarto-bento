# Quarto-Bento

Author and compute in [Quarto](https://quarto.org/), design in
[Bento](https://github.com/nyblnet/bento), and regenerate your presentation
while retaining its visual design. Quarto-Bento provides a local Studio,
explicit reviewed synchronization to QMD, and an offline standalone Bento HTML
output.

**Status:** public development source. The supported Linux implementation
objective is complete: the runtime at `2ee7974` passed 578 tests and four steps,
with zero failures, and the 117-file portable smoke passed. The supported
workflows and their limits are documented in the
[implementation ledger](docs/IMPLEMENTATION_STATUS.md) and
[completion audit](docs/COMPLETION_AUDIT.md). This repository is available for
use, inspection and contributions; a versioned v1 release has not been declared.
Windows and macOS qualification are future work outside the completed Linux
objective.

## Install the Linux CLI

Quarto-Bento's npm CLI is `@brianmsm/quarto-bento`. Install Node.js 22 or later,
Deno and Quarto first; the tested baseline is Node 26.10.0, Deno 2.9.6 and
Quarto 1.10.19. The package includes application source/assets, but does not
install these runtimes or your document's computation packages.

```sh
npm install --global --ignore-scripts @brianmsm/quarto-bento@0.1.0
qbento --version
qbento doctor
qbento edit /absolute/path/to/my-presentation/deck.qmd
```

For an npm prefix writable by your user, use
`npm install --global --ignore-scripts --prefix "$HOME/.local" @brianmsm/quarto-bento@0.1.0`
and ensure `$HOME/.local/bin` is on `PATH`.

Alternatively, manage the CLI and its Node/Deno runtimes through mise:

```sh
mise use -g node@26.10.0 deno@2.9.6 npm:@brianmsm/quarto-bento@0.1.0
qbento doctor
```

Quarto remains a separate installed requirement. See the
[installation guide](docs/NPM.md) for details. This is a Linux development CLI;
macOS/Windows and a stable v1 are outside this release scope.

## Run from a source checkout

Install Deno and Quarto yourself. The tested Linux baseline is **Deno 2.9.6**
and **Quarto 1.10.19**. A document with computation also needs its language and
packages; the acceptance suite used R 4.6.1 and locally installed Python.
Chromium is needed for supported browser-based captures and PDF workflows.
Quarto-Bento does not install or manage these dependencies.

```sh
git clone https://github.com/brianmsm/quarto-bento.git
cd quarto-bento
deno task qbento doctor
```

Create a separate directory for each presentation. For a minimal authored deck,
create `deck.qmd` there:

```qmd
---
title: My presentation
---

## Results {#results}

::: {#finding}
This text can be edited in Bento and synchronized to QMD after review.
:::
```

From the source checkout, run:

```sh
deno task qbento render /absolute/path/to/my-presentation/deck.qmd
deno task qbento edit /absolute/path/to/my-presentation/deck.qmd
```

Open the printed `127.0.0.1` Studio URL in a browser. The server remains running
while you edit. Studio currently uses Spanish labels: **Guardar proyecto** (Save
project) preserves design and pending authored edits; **Revisar cambios**
(Review changes) shows proposed QMD patches; **Aplicar** (Apply) commits the
reviewed source changes; **Recalcular** (Recalculate) executes QMD again. The
[English usage guide](docs/USAGE.md) explains the complete workflow and recovery
choices.

Only execute trusted QMD and code. Ordinary rendering and editing use the pinned
local Bento runtime and need no cloud service. Compatible computation packages
and local input assets remain your responsibility.

## Save, synchronize, regenerate

- **QMD owns meaning and computation:** authored content, executable source,
  equations, notes and semantic structure.
- **`.qbento/` owns retained visual state:** identity, geometry, design,
  decoration and recoverable pending edits.
- **Save** stores Studio edits without silently rewriting QMD.
- **Synchronize** applies explicit reviewed source patches; conflicts require a
  choice and computed output cannot be promoted into executable code.
- **Render** recomputes source results and combines them with retained design.

Version QMD, data/assets and the required `.qbento/` project state together. The
generated `.bento.html` is rebuildable. Native Bento Save creates a separate
HTML copy; use `qbento capture` for supported edits to a matching local project
copy before rendering again. See [capture](docs/evidence/CAPTURE.md) and
[reconstruction](docs/USAGE.md).

## Supported workflows

The documented single-QMD Linux workflow includes ordinary headings and rich
text, bounded lists, displayed code, display equations, speaker notes, local
images and captions, native/simple tables and charts, cards and two-column
layouts, literal and computed KPI content, and bounded diagrams/timelines.
Studio supports retained visual editing, pending semantic edits, reviewed slide
and element actions, reusable designs, conflict resolution and recovery.
Compatible R/Python execution has local evidence. Supported Plotly views are
isolated from the pure-data deck; static output remains available for delivery.

Each codec has explicit limits. Arbitrary HTML/widgets, broad multi-QMD editing,
live collaboration and reconciliation of independently distributed HTML copies
are outside the implemented scope. See [authoring](docs/AUTHORING.md),
[acceptance limits](docs/ACCEPTANCE_GAPS.md) and [examples](examples/README.md).
The [product target](docs/PRODUCT_TARGET.md) describes the longer-term horizon.

## Commands and installation

From the checkout, invoke commands with `deno task qbento`. A locally built
portable directory supplies the equivalent `bin/qbento` launcher:

```sh
qbento doctor
qbento render presentation.qmd
qbento edit presentation.qmd
qbento status presentation.qmd
qbento diff presentation.qmd
qbento sync presentation.qmd
qbento get presentation.qmd
qbento patch presentation.qmd patch.json
qbento init presentation.qmd
```

`init` installs the self-contained `qbento-html` extension for ordinary
`quarto render` in that project. The versioned
[JSON agent API](docs/AGENT-API.md) uses the same checked document/state core.
Build a portable development directory with
`deno task package /absolute/path/to/new-directory`; see
[packaging and license provenance](docs/PACKAGING.md). The Linux npm CLI wraps
this same distribution; its [installation guide](docs/NPM.md) covers npm, mise
and local tarballs. It is a development release rather than a stable v1 or a
cross-platform claim.

## Documentation and development

- [Usage](docs/USAGE.md): preparation, Studio, sync, computation and recovery.
- [Authoring](docs/AUTHORING.md): supported source syntax and codec limits.
- [Workflows](docs/WORKFLOWS.md): ten practical scenarios and ownership rules.
- [Sync](docs/SYNC.md), [architecture](docs/ARCHITECTURE.md) and
  [decisions](docs/DECISIONS.md): implementation contracts and product
  decisions.
- [Current status](docs/IMPLEMENTATION_STATUS.md), [roadmap](docs/ROADMAP.md)
  and [evidence index](docs/evidence/README.md): measured results and future
  work.
- [npm CLI package](docs/NPM.md): Linux package contents, local tarball
  preparation, npm installation and mise usage.
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md) and
  [publication scope](docs/PUBLICATION.md): development and public repository
  policy.

The [contributor guide](CONTRIBUTING.md) lists checks and the optional full
Linux acceptance command. The hosted workflow is a manually dispatched Linux
portable smoke; authored workflow configuration is distinct from a passing
hosted run. Agents should begin with [AGENTS.md](AGENTS.md).

## License and upstream

Quarto-Bento's own code and documentation use the [MIT License](LICENSE),
copyright (c) 2026 Brian Norman Peña Calero. The pinned Bento shell,
dependencies and embedded fonts retain their own terms. Their upstream notices,
complete available texts and provenance are preserved under
[vendor/bento](vendor/bento). The
[exact-version license investigation](docs/evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
records four missing or discrepant package-source texts; publication does not
turn those unresolved findings into a completed third-party review.

Bento is an independent upstream project by its authors. Quarto-Bento uses a
pinned upstream shell with a limited reviewed adapter; it is not affiliated with
or endorsed by Bento or Quarto.
