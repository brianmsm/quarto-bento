# npm CLI package

Quarto-Bento uses a scoped npm CLI package named `@brianmsm/quarto-bento`, with
package version `0.1.0`. Its current package target is **Linux only**. This is a
development package for the validated Linux implementation; it does not declare
a stable v1 release. The owner authorized registry publication on 2026-10-16.
Version `0.1.0` is publicly available on
[npm](https://www.npmjs.com/package/@brianmsm/quarto-bento). Anonymous registry
integrity and README checks, public npm/mise installation, 117 payload hashes
and rendering passed on 2026-10-16. See [the receipt](evidence/NPM-CLI.md);
these checks are separate from the earlier local package tests.

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

## npm and mise installation

With the external requirements available, install the pinned registry version:

```sh
npm install -g @brianmsm/quarto-bento@0.1.0
qbento --version
qbento doctor
```

If your npm prefix needs elevated permissions, choose a user-owned prefix:

```sh
npm install -g --prefix "$HOME/.local" \
  @brianmsm/quarto-bento@0.1.0
export PATH="$HOME/.local/bin:$PATH"
```

Mise can install the npm package and manage its Node/Deno runtimes:

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

See the
[mise npm backend documentation](https://mise.jdx.dev/dev-tools/backends/npm).
Quarto and computation dependencies remain separate requirements. No package
install hooks manage them. Check `qbento doctor` before rendering a document.

## Maintainer publication

The source-root package remains private; publish only the reviewed staged
archive. Authenticate with `npm login --auth-type=web`, verify `npm whoami`,
check that the scope belongs to that publisher, and publish the exact reviewed
version with explicit public access. Do not put credentials into source or logs.
After publication, compare registry integrity with the local tarball and verify
an actual installation using a fresh prefix/cache. Do not overwrite or assume
that a published name/version can be replaced.

A successful publish may return HTTP 202 while npm processes the package. During
this interval, downloads can return 404. Wait for public metadata and tarball
availability before recording install success; do not republish the same
version. See the
[npm publish-time scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).

## Documentation snapshot in version 0.1.0

The immutable `0.1.0` archive includes `distribution/PACKAGING.md` from the
staging snapshot. Its final paragraph predates registry publication and says
npm/mise publication is pending. The archived root README also predates the
new-package approval required by mise 2026.10.11. Those historical instructions
do not describe current registry availability or current mise requirements; use
this guide for installation. A future package version can refresh the bundled
portable guide. The original archive and its 117 payload hashes remain
unchanged.

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
