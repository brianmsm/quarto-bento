# Integrated ordinary-authoring acceptance — Linux, 2026-10-13

The combined runtime is `85da0379ce721d91957f6f1e22f6bd1371a79658`.
This receipt adds the later ordinary-authoring corrections to the historical
[Linux acceptance](INTEGRATED-LINUX.md); it does not relabel the earlier native
checks as having run on this revision.

## Combined tests

The complete suite passed **550 tests, 4 steps, zero failures**, in **15m43s**,
with process exit status **0** and all optional browser/Python checks enabled.

The working tree remained clean and the runtime was not changed during the run.
Types, lint, formatting and Git whitespace checks passed. The invocation was:

```sh
DENO_JOBS=2 NO_COLOR=1 \
QBENTO_BENTO_SOURCE=/absolute/path/to/pinned/bento-upstream \
QBENTO_STUDIO_BROWSER_TEST=1 QBENTO_RELATIONS_BROWSER=1 \
QBENTO_PYTHON_EXECUTION_TEST=1 QBENTO_TEST_PYTHON=/usr/bin/python3 \
QBENTO_WIDGET_EVIDENCE=/absolute/path/to/widget-diagnostics \
deno test --parallel --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

The upstream checkout is pinned to
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. The installed environment is Linux,
Deno 2.9.6, Quarto 1.10.19, R 4.6.1, rmarkdown 2.31, Python 3.14.7 and Chromium
152.0.7977.82. The Python computation receipt uses installed knitr/reticulate;
Jupyter was not installed or qualified. No environment management was added.

The earlier combined attempt at `453a984` had 514 passes and seven failures.
Those failures were diagnosed and corrected before this run: out-of-page test
fixtures, outdated provenance/context expectations and a real rmarkdown input
filename mismatch. The failed run remains historical evidence, not a passing
result. The image adapter also resolves the generated SVG URI containing `%22`
for a QMD basename with spaces, quotes and Unicode.

A subsequent run at `9b237d5` had 544 passes, four steps and three failures.
One was the earlier mixed-math diagnostic expectation; another exposed a real
H1/H2 source-boundary mismatch, corrected with independent structural and
provenance review. The third compared two differing widget SVGs; it did not
reproduce in the isolated test, eight full renders or 50 additional exports.
Its cause remains unidentified. The exact-SVG assertion is retained, with
opt-in diagnostic capture enabled for the final run. A subsequent passing run
does not establish a root-cause fix for that intermittent observation.

## What was integrated

- Reviewed Markdown list creation, conversion and deletion; speaker-note
  creation and retention of source identities.
- Native table, KPI and chart composition within bounded cards/layouts, with
  original-source context checks and four-edge geometry diagnostics.
- Execution producer receipts across the CLI and ordinary Quarto entry points,
  including startup/profile behavior and unlabelled computed tables.
- Matching H1/H2 source and native slide boundaries, retaining explicit scanner
  level selection and original-source movement guards.
- Original-source mapping and reviewed identity acquisition for ordinary
  displayed code, display equations, pipe tables and local Markdown images.
- Local image/caption pairs, exact source assets, reviewed caption edits and
  empty-caption creation/clearing. Asset mutation during computation refuses
  publication while preserving recoverable project state.

Each lane has its own independent review and scoped execution evidence; see
[the ledger](../IMPLEMENTATION_STATUS.md), [tables](PLAIN-TABLES.md),
[images](PLAIN-IMAGES.md) and [producer activation](PRODUCER-ACTIVATION.md).
The final image merge was separately checked for preservation of table coverage,
original native identities and authenticated producer scope.

## Native Studio and portable reconstruction

The coordinator operated the real Studio client with headless Chromium at
`9b237d5`: edit a rich image caption, Save, reload, inspect the identity/content
patches, Apply and Recalculate. Save left QMD byte-identical. The final complete
emitted document matched the saved document, with the same docId, original
image URI and zero pending changes. The final screenshot was visually inspected;
the image and complete caption are readable inside the slide. This is native
browser interaction without desktop focus or mouse capture.

A new 108-file portable development package records the final clean
`85da037` Git revision. Every payload hash was checked. Its actual launcher passed doctor and
rebuilt both the earlier native table fixture and the new native image fixture
from QMD, input assets and `.qbento/{project.json,state.json}` only. No prior
HTML or execution cache was copied. Both emitted documents and docIds remained
exact, with zero pending changes. The table counter recorded one fresh R
execution. A separate image fixture retained saved geometry, rotation and
caption color. The portable smoke additionally retained one pending authored
edit through relocation and ordinary Quarto integration.

The usable distribution and demos are under
`output/verification/portable-85da037/`; its README gives launcher commands.
The manifest and `rebuild-receipt.json` record the source revision, versions,
input hashes and assertions. Native image source/state evidence is under
`output/verification/plain-images-native/`, with review/final captures in
`output/playwright/plain-images-*.png`. Raw full-suite/static logs and their
checksums are indexed by `output/verification/85da037/receipt.json`.
These local output paths are ignored by Git; this versioned receipt preserves
the commands and scope.

## Remaining boundaries

This closes the combined local Linux validation for the documented ordinary
workflows. It does not declare the full product horizon or a public v1 release
complete. macOS/Windows and hosted CI remain deferred by the owner. The public
release boundary is not frozen; the project license remains an owner decision.

The adapters remain bounded: image source replacement/deletion, arbitrary
widgets, general TeX, multi-QMD source editing and dynamic authored image
captions need separate faithful support. Pending edits remain recoverable when
such a conversion refuses. Layout association uses QMD declarations; Studio
edits registry definitions and local design, without a demonstrated association
operation for arbitrary free content. No universal conversion, OS-native
file-dialog acceptance or cross-platform visual equivalence is claimed.
