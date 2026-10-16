# Quarto-Bento

Quarto-Bento connects [Quarto](https://quarto.org/) authoring and computation
with [Bento](https://github.com/nyblnet/bento) slide design. It provides a local
Studio, reviewed QMD synchronization and an offline standalone Bento HTML
output.

This npm CLI package is named `@brianmsm/quarto-bento` and currently targets
**Linux only**. Version `0.1.0` is a development release, not a stable v1.

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

## Install from npm

With Node, Deno and Quarto already installed, install the pinned CLI version:

```sh
npm install -g @brianmsm/quarto-bento@0.1.0
qbento --version
qbento doctor
```

If your npm global prefix is not writable, use a user-owned prefix instead:

```sh
npm install -g --prefix "$HOME/.local" \
  @brianmsm/quarto-bento@0.1.0
export PATH="$HOME/.local/bin:$PATH"
```

## Install with mise

Mise can manage Node, Deno and the npm CLI together. Quarto remains a separate
user-installed dependency:

```sh
mise use -g node@26.10.0 deno@2.9.6 \
  'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.1.0'
qbento doctor
```

Recent mise versions require explicit approval for new or low-download packages.
`allow_low_downloads=true` approves only this package after checking its name
and publisher; it does not enable build scripts or change global security
settings. See
[mise npm reputation checks](https://mise.jdx.dev/dev-tools/backends/npm#low-download-and-new-packages).

The package has no npm install hooks or JavaScript package dependencies. The
[installation guide](https://github.com/brianmsm/quarto-bento/blob/main/docs/NPM.md)
also covers local tarball installation, requirements and supported scope.

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
