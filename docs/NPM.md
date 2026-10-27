# npm CLI package

Quarto-Bento uses the scoped npm CLI package
[@brianmsm/quarto-bento](https://www.npmjs.com/package/@brianmsm/quarto-bento).
**Status (2026-10-27):** `@brianmsm/quarto-bento@0.2.0` is published, with
`latest` pointing to it. Exact public archive integrity and anonymous npm/mise
installation passed; see [the 0.2.0 receipt](evidence/NPM-0.2.0.md).
The package targets **Linux only**, not stable v1. Separately, the owner ran the
global mise command selecting `0.2.0`, Node 26.12.0 and Deno 2.9.8. Subsequent
selected-CLI version/doctor, all 137 archive files/132 runtime hashes and a real
render passed; see the [global verification](evidence/NPM-0.2.0.md#owner-performed-global-mise-update).

The historical `0.1.1` publication and owner-requested global mise update passed
on 2026-10-17, including anonymous registry integrity, installation, selected
sync/render and all 117 runtime payload hashes. See
[its receipt](evidence/SYNC-SELECTION-0.1.1.md). The initial `0.1.0` publication
is preserved separately in [its historical receipt](evidence/NPM-CLI.md).

## Development version policy

The current release is `0.2.0`, a separately reviewed Linux minor
development release for larger workflow additions. The historical `0.1.1`
compatible correction followed the `0.1.x` policy: patches may complete
documented workflows without changing existing command spellings, saved-state
schema or the JSON API version. That patch exposes selected sync, fixes
source-binding checks and clarifies
post-sync pending state. The new selection option is an additive capability; it
is not presented as a bug fix with no public-interface addition. Larger workflow
additions or incompatible contracts should receive a separately reviewed minor
release. No `0.x` version declares stable v1.

Source/package/extension metadata is `0.2.0`. It adds
[execution layout](EXECUTION_LAYOUT.md), [theme slots](features/THEME_SLOTS.md),
inline Plotly 2D/scatter3d, checked local widget-data import and full-data
scroll/static continuations. Its
[Linux acceptance evidence](evidence/COMPOSITION-INTERACTIVITY-0.2.0.md) records
705 tests and four steps, zero failures, with one optional upstream-source math
comparison ignored, a 132-file portable distribution and a 137-file offline npm
archive with 132 runtime hashes. That prepublication receipt's dirty local
review archive remains historical. The clean published artifact comes from
source `5b17bf6acda597c3403ee6abf6ba4d396eba7ad6` (`dirty: false`); its
137 files and 132 runtime hashes match anonymous public downloads. See
[the publication receipt](evidence/NPM-0.2.0.md) for exact integrity,
README/launcher checks and real public npm/mise version, doctor and rendering.

The historical published `0.1.1` archive is the exact clean artifact prepared before
publication; anonymous registry downloads match its SHA256, npm shasum and
SHA512 integrity. The immutable `0.1.0` archive remains unchanged. Runtime,
local-package and public-installation evidence are distinguished in
[the correction receipt](evidence/SYNC-SELECTION-0.1.1.md).

## What npm installs

The package contains the tested Quarto-Bento distribution, its integrity
manifest, the project MIT license, a standalone package README and a small Node
launcher that exposes the `qbento` command. Node 22 or later runs that launcher;
the launcher starts the TypeScript CLI with Deno. The application source and
assets are bundled; the Deno executable is installed separately. The application
runs without downloading JavaScript dependencies. Quarto remains an external
dependency. QMD computation also needs the language engines and packages
required by the document.

The package declares Node 22 or later. The current source qualification uses
Deno 2.9.8, Node 26.12.0 and Quarto 1.10.19 on Linux; earlier 0.1.1 receipts
retain their Deno 2.9.6 baseline. Deno is called from `PATH`, so install it
separately. Quarto, Chromium and computation dependencies are also user-managed.
Only run QMD and executable code you trust.

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
  scripts/npm-package.ts /tmp/qbento-npm-0.2.0
```

Create a tarball from the staged package. `--ignore-scripts` makes the pack step
skip lifecycle scripts; the package does not need install or prepare hooks. The
source-root `package.json` is intentionally `private: true`, preventing
publication of an incomplete checkout. The builder removes that flag only in the
explicitly assembled staging directory. Always pack the staged directory.

```sh
npm pack --ignore-scripts \
  --pack-destination /tmp \
  /tmp/qbento-npm-0.2.0
```

The generated tarball is suitable for a local installation test. For example,
install it to an isolated user prefix rather than the machine-wide npm prefix:

```sh
npm install --global \
  --offline --ignore-scripts --no-audit --no-fund \
  --prefix "$HOME/.local/share/qbento-npm-test" \
  /tmp/brianmsm-quarto-bento-0.2.0.tgz

PATH="$HOME/.local/share/qbento-npm-test/bin:$PATH" qbento --version
PATH="$HOME/.local/share/qbento-npm-test/bin:$PATH" qbento doctor
```

The directory added to `PATH` is the prefix's `bin` directory. Remove that
isolated prefix after testing if you no longer need it. Package installation
only places the CLI files; it does not install Node, Deno, Quarto or computation
dependencies.

## Verified local installation

The prepublication `0.2.0` candidate has separate offline npm, isolated mise and actual
installed-widget/camera/scroll checks in the
[current receipt](evidence/COMPOSITION-INTERACTIVITY-0.2.0.md). The counts in the
following paragraph are historical `0.1.x` results, not a relabeling of that
candidate.

Eleven focal launcher/staging/portable tests passed on Linux. The real npm smoke
packed exactly 122 files, verified all 117 installed runtime payloads, relocated
the npm prefix, and exercised
version/doctor/render/validate/get/patch/selected-sync. It reconstructed QMD plus saved state without previous HTML or the staging
directory, preserving identity, visual overrides and an authored pending edit.
Source type checks, lint and targeted formatting passed. The tested npm launcher
environment used Node 26.10.0 and npm 11.19.1; Node >=22 is the declared
requirement, not a claim that every older Node version has been qualified.

Run the installed smoke with Node 26.12.0/npm, Deno 2.9.8
and Quarto 1.10.19:

```sh
deno run --no-config --no-remote --no-npm --allow-read --allow-write \
  --allow-run --allow-env scripts/npm-check.ts
```

The smoke creates and removes only its own temporary prefix, npm config and
caches. The separate mise check runs its real npm backend against a minimal
temporary IPv4 loopback registry serving the prepared tarball. Historical
qualification passed with mise 2026.10.11 and all 117 installed payload hashes;
current 0.2.0 results are in its separate receipt. The helper uses isolated mise
config/data/cache/state and changes no user global setup or registry package:

```sh
python3 scripts/mise-npm-check.py /tmp/brianmsm-quarto-bento-0.2.0.tgz
```

That local registry fixture proves backend installation and execution, not
availability on npmjs.org. See [the npm receipt](evidence/NPM-CLI.md).

## npm and mise installation

The public `0.2.0` package passed anonymous npm and mise installation checks in
[the publication receipt](evidence/NPM-0.2.0.md). Use the pinned commands below
with Node 26.12.0, Deno 2.9.8 and Quarto 1.10.19.

```sh
npm install -g @brianmsm/quarto-bento@0.2.0
qbento --version
qbento doctor
```

If your npm prefix needs elevated permissions, choose a user-owned prefix:

```sh
npm install -g --prefix "$HOME/.local" \
  @brianmsm/quarto-bento@0.2.0
export PATH="$HOME/.local/bin:$PATH"
```

Mise can install the npm package and manage its Node/Deno runtimes:

```sh
mise use -g node@26.12.0 deno@2.9.8 \
  'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.2.0'
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

The owner-authorized `0.2.0` publication and anonymous public verification are
complete in [the release receipt](evidence/NPM-0.2.0.md). The owner separately
executed the global mise command shown above: it installed Deno 2.9.8 and
`0.2.0`, with Node 26.12.0 already installed. This also pins Node and Deno;
it is not a claim that only the qbento setting changed. No additional global
installation was performed by the assistant.

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
this guide for installation. Version `0.1.1` refreshes the bundled portable
guide and standalone README. The original archive and its 117 payload hashes
remain unchanged.

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
