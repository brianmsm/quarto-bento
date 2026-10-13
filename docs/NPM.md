# npm CLI package

Quarto-Bento is prepared as a scoped npm CLI package named
`@brianmsm/quarto-bento`, with package version `0.1.0`. Its current package
target is **Linux only**. This is a development package for the validated Linux
implementation; it does not declare a stable v1 release. The package has been
prepared for local staging and review. It has **not** been published to the npm
registry.

## What npm installs

The package contains the tested Quarto-Bento distribution, its integrity
manifest, the project MIT license, a standalone package README and a small Node
launcher that exposes the `qbento` command. Node 22 or later runs that launcher;
the launcher starts the TypeScript CLI with Deno. The application source and
assets are bundled; the Deno executable is installed separately. The application
runs without downloading JavaScript dependencies. Quarto remains an external
dependency. QMD computation also needs the language engines and packages
required by the document.

The package declares Node 22 or later; the tested application baseline is Deno
2.9.6 and Quarto 1.10.19 on Linux. Deno is called from `PATH`, so install it
separately. Quarto, Chromium for browser-based workflows, and document
computation dependencies are also managed by the user. Quarto-Bento does not
install or manage them. Only run QMD and executable code you trust.

The package includes the pinned Bento shell and the existing license and
third-party notices. It preserves four documented historical gaps in complete
license-source texts; package preparation does not resolve or certify those
items. See the [license-source audit](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
and [distribution notice record](evidence/DISTRIBUTION-NOTICES.md).

## Prepare a local package

From a Quarto-Bento source checkout, stage the package in a new directory
outside the repository. The staging command checks the package identity and
copies the reviewed runtime distribution; it does not install dependencies or
publish anything.

```sh
deno run --no-config --allow-read --allow-write --allow-run=git \
  scripts/npm-package.ts /tmp/qbento-npm-0.1.0
```

Create a tarball from the staged package. `--ignore-scripts` makes the pack step
skip lifecycle scripts; the package does not need install or prepare hooks. The
source-root `package.json` is intentionally `private: true`, preventing
publication of an incomplete checkout. The builder removes that flag only in the
explicitly assembled staging directory. Always pack the staged directory.

```sh
npm pack --ignore-scripts \
  --pack-destination /tmp \
  /tmp/qbento-npm-0.1.0
```

The generated tarball is suitable for a local installation test. For example,
install it to an isolated user prefix rather than the machine-wide npm prefix:

```sh
npm install --global \
  --offline --ignore-scripts --no-audit --no-fund \
  --prefix "$HOME/.local/share/qbento-npm-test" \
  /tmp/brianmsm-quarto-bento-0.1.0.tgz

PATH="$HOME/.local/share/qbento-npm-test/bin:$PATH" qbento --version
PATH="$HOME/.local/share/qbento-npm-test/bin:$PATH" qbento doctor
```

The directory added to `PATH` is the prefix's `bin` directory. Remove that
isolated prefix after testing if you no longer need it. Package installation
only places the CLI files; it does not install Node, Deno, Quarto or computation
dependencies.

## Verified local installation

Eleven focal launcher/staging/portable tests passed on Linux. The real npm smoke
packed exactly 122 files, verified all 117 installed runtime payloads, relocated
the npm prefix, and exercised version/doctor/render/validate/get/patch. It
reconstructed QMD plus saved state without previous HTML or the staging
directory, preserving identity, visual overrides and an authored pending edit.
Source type checks, lint and targeted formatting passed. The tested npm launcher
environment used Node 26.10.0 and npm 11.19.1; Node >=22 is the declared
requirement, not a claim that every older Node version has been qualified.

Reproduce the installed npm smoke with existing Node/npm, Deno and Quarto:

```sh
deno run --no-config --no-remote --no-npm --allow-read --allow-write \
  --allow-run --allow-env scripts/npm-check.ts
```

The smoke creates and removes only its own temporary prefix, npm config and
caches. The separate mise check runs its real npm backend against a minimal
temporary IPv4 loopback registry serving the prepared tarball. It passed with
mise 2026.10.7's default installer, `qbento --version`, `qbento doctor` and all
117 installed payload hashes. It uses isolated mise config/data/cache/state
directories and does not change the user's global setup or publish a package:

```sh
python3 scripts/mise-npm-check.py /tmp/brianmsm-quarto-bento-0.1.0.tgz
```

That local registry fixture proves backend installation and execution, not
availability on npmjs.org. See [the npm receipt](evidence/NPM-CLI.md).

## Future registry installation

The npm scope and package metadata are prepared for public access, but registry
publication is a separate step. It requires authenticated publisher access and
completion of the remaining provenance and license review. Until an owner
publishes and verifies the package, registry-based commands will fail because
the package is not available there.

After a verified registry publication, mise can install a pinned version using
its npm backend. This is a **future command**, not a currently working install:

```sh
mise use -g node@26 deno@2.9.6 npm:@brianmsm/quarto-bento@0.1.0
```

See the
[mise npm backend documentation](https://mise.jdx.dev/dev-tools/backends/npm).
The Node and Deno runtimes still need to be available in mise's environment.
Quarto and computation dependencies remain separate requirements.

## Scope

The package declares Linux as its supported npm platform. A portable Windows
launcher in the source tree does not mean the npm package supports Windows, and
macOS is not qualified. Both platforms remain future work outside the completed
Linux implementation objective. The package also does not change the bounded QMD
codecs or claim support for arbitrary widgets, broad multi-QMD projects or
independently edited distributed HTML copies. See the
[implementation status](IMPLEMENTATION_STATUS.md),
[acceptance limits](ACCEPTANCE_GAPS.md) and
[publication record](PUBLICATION.md).
