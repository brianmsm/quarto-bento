# Contributing

Quarto-Bento welcomes reproducible bug reports, documentation improvements and
bounded implementation changes. The supported development baseline is Linux;
Windows and macOS qualification remain future work. Start with the
[usage guide](docs/USAGE.md), [current status](docs/IMPLEMENTATION_STATUS.md)
and [architecture](docs/ARCHITECTURE.md). Coding agents must also read
[AGENTS.md](AGENTS.md).

## Development setup

Use installed Deno 2.9.6 and Quarto 1.10.19 for the tested baseline. Computation
tests need their installed R/Python packages; browser tests need Chromium.
Quarto-Bento does not install or lock these environments. The source checkout
does not require `npm install` to use its committed runtime. The separate
Linux npm CLI package is staged from the reviewed portable distribution; Bento's
upstream package files are pinned provenance, not instructions to build or
install its dependencies.

```sh
deno task qbento doctor
deno task check
deno lint src tests scripts
deno fmt --check src scripts
```

To prepare the consumer npm tarball for local review, run the staging script
from the repository root into a new directory outside the checkout:

```sh
deno run --no-config --allow-read --allow-write --allow-run=git \
  scripts/npm-package.ts /tmp/qbento-npm-0.1.0
npm pack --ignore-scripts --pack-destination /tmp /tmp/qbento-npm-0.1.0
```

The staging script validates the package metadata and builds the self-contained
runtime payload. It does not publish to npm. See [NPM.md](docs/NPM.md) for the
local install workflow and publication status. Do not publish a registry
package until its provenance and licensing review is complete.

Run `deno task npm-check` for the real offline tarball installation and relocated
state-only rebuild smoke. Run `python3 scripts/mise-npm-check.py <tarball>` for
the isolated real mise backend check. These helpers use temporary prefixes and
configuration; neither publishes a package or changes the user's global setup.

Run the tests relevant to the changed behavior. `deno task test` includes real
Quarto/computation tests and expects the necessary local dependencies; optional
browser and Python tests require explicit environment switches. A passing subset
must be reported as a subset.

To reproduce the complete Linux acceptance configuration, first check out Bento
separately at the revision in `vendor/bento/pin.json` and replace the source
path below with that checkout. The run used these switches:

```sh
DENO_JOBS=2 \
NO_COLOR=1 \
QBENTO_BENTO_SOURCE=/absolute/path/to/pinned-bento-source \
QBENTO_STUDIO_BROWSER_TEST=1 \
QBENTO_RELATIONS_BROWSER=1 \
QBENTO_LAYOUT_BROWSER=1 \
QBENTO_PYTHON_EXECUTION_TEST=1 \
QBENTO_TEST_PYTHON=/usr/bin/python3 \
deno test --parallel --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

Omitting `QBENTO_BENTO_SOURCE` skips its optional upstream source comparison and
does not reproduce the exact recorded 578-test configuration. Set
`QBENTO_WIDGET_EVIDENCE` to a local output directory to retain diagnostics for
exact widget SVG comparisons. The receipt at
[SECURITY-LINUX.md](docs/evidence/SECURITY-LINUX.md) records the precise
completed run and environment. Chromium must be able to start and use loopback
sockets; a command sandbox that denies these operations cannot validate browser
tests.

For portable relocation and state-only reconstruction:

```sh
deno run --no-config --no-remote --no-npm --allow-read --allow-write \
  --allow-run --allow-env scripts/portable-check.ts
```

The GitHub workflow is a manually dispatched Linux portable smoke. It is a
smaller authored-source test and does not reproduce the full R/Python/browser
acceptance suite.

## Changes and reviews

Keep changes focused and document their user-visible behavior, supported scope
and validation. Add regression coverage for consequential changes to source
patching, provenance, state, path boundaries, execution or synchronization.
Preserve historical receipts as observations of their original revisions. Update
current status separately instead of relabeling old evidence.

QMD remains the semantic/computational authority; `.qbento/` retains design and
recoverable pending changes. Save must not implicitly synchronize QMD, render
must not discard unsynced edits, and source patches must be inspectable and
recoverable. Computed results must come from execution. Avoid whole-file
Markdown rewrites, automatic environment management and silent merges.

Use synthetic fixtures for reports and tests. Describe the actual command,
versions, smallest reproducing source, expected result and observed result. Do
not include private data or credentials. Report vulnerabilities through the
[security process](SECURITY.md).

The project uses MIT for its own code and documentation. Contributions are
provided under those terms. Preserve third-party licenses and provenance; do not
rewrite pinned vendor files or substitute newer upstream license text for an
unresolved historical package without evidence.
