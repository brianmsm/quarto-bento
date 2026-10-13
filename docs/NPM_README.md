# Quarto-Bento

Quarto-Bento connects [Quarto](https://quarto.org/) authoring and computation
with [Bento](https://github.com/nyblnet/bento) slide design. It provides a local
Studio, reviewed QMD synchronization and an offline standalone Bento HTML
output.

This npm CLI package is named `@brianmsm/quarto-bento` and currently targets
**Linux only**. Version `0.1.0` is a prepared development package, not a stable
v1 release. The package has not been published to the npm registry.

## Requirements

- Linux.
- Node.js 22 or later to run the `qbento` command launcher.
- Deno 2.9.6 on `PATH` to execute the bundled TypeScript runtime.
- Quarto 1.10.19 for rendering and computation.
- Any language engines, packages and local inputs used by your QMD documents.

The npm package bundles Quarto-Bento's runtime and does not download JavaScript
dependencies during installation or execution. It does not install or manage
Node, Deno, Quarto, Chromium or computation environments. Only run QMD and
executable code you trust.

## Install from a prepared local tarball

When you have built the `.tgz` from a Quarto-Bento source checkout, install it
into an npm prefix available to your user:

```sh
npm install --global \
  --offline --ignore-scripts --no-audit --no-fund \
  --prefix "$HOME/.local/share/qbento" \
  /path/to/brianmsm-quarto-bento-0.1.0.tgz
export PATH="$HOME/.local/share/qbento/bin:$PATH"

qbento --version
qbento doctor
```

The
[package preparation guide](https://github.com/brianmsm/quarto-bento/blob/main/docs/NPM.md)
explains how to create and verify a local tarball. This tarball installation
works without npm registry publication.

## Basic use

```sh
qbento render /absolute/path/to/presentation.qmd
qbento edit /absolute/path/to/presentation.qmd
```

`edit` prints a local Studio URL. Studio saves design and pending content to
`.qbento/` without silently rewriting QMD. Review proposed source changes before
applying synchronization. Recalculation executes QMD again and retains saved
design. See the
[English usage guide](https://github.com/brianmsm/quarto-bento/blob/main/docs/USAGE.md)
for the workflow and recovery behavior.

## Project and license scope

The Linux implementation supports bounded QMD syntax and documented workflows;
it is not a general converter for arbitrary Quarto projects. Read the
[acceptance limits](https://github.com/brianmsm/quarto-bento/blob/main/docs/ACCEPTANCE_GAPS.md)
before relying on unsupported constructs. Windows and macOS have not been
qualified for this npm package.

Quarto-Bento's authored code and documentation use the MIT License. The
distribution also contains Bento and other third-party assets under their own
terms. Four historical complete package-license-source gaps remain documented;
their presence is not resolved by packaging. See the
[license audit](https://github.com/brianmsm/quarto-bento/blob/main/docs/evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
and the bundled notices.

For current implementation status, contribution instructions and security
reporting, see the
[project repository](https://github.com/brianmsm/quarto-bento).
