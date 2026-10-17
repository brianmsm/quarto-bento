# Linux 0.1.1 correction and publication evidence

Date: 2026-10-17. This receipt covers corrections prepared after the app/plugin
contrast review at source `a1b8025`. The skill/plugin repository is outside the
change scope. Package `0.1.1` was subsequently published and verified on
2026-10-17. The publication and owner-requested global update are recorded
separately below from the earlier local preparation results.

## Corrected behavior

- Read-only project access verifies `.qbento/project.json` against the requested
  QMD. `status`, `diff`, `get`, saved-state readers and Studio startup refuse a
  sibling source. A genuinely uninitialized project reports `NO_BASELINE`; an
  existing state whose source metadata is absent refuses
  `PROJECT_BINDING_MISSING`, including automatic Studio initialization and
  explicit render.
- CLI `--select selection.json` and Studio use the same strict versioned
  selection request. Document ID/revision, pending IDs, component dependencies
  and selected destructive confirmations are verified before preview.
- Apply retains exact-plan/source/revision checks. Supporting identities and
  annotations remain visible in the complete proposal. Excluded work remains
  pending; selections that would delete excluded target/subtree edits refuse.
- Semantic pending entries are intentionally retained after writing QMD until a
  later render verifies them. Receipt fields and approval-related refusals are
  explained in the app guides, with an explicit Studio message.

## Validation

Runtime correction commit: `32bb946`. Independent code review found and then
rechecked destructive selection dependencies, new-project CLI bootstrap and
missing-binding refusal. Each was corrected before the final validation run.

Focused checks passed: eight source-binding regressions; eight selection/CLI
startup tests; eleven existing sync and five structural tests; Studio selector,
body-limit, busy-Apply and deletion-confirmation regressions. Real headless
Chromium verified selected Apply followed by render, retaining two excluded
pending changes, document identity and exact saved design. These checks do not
establish arbitrary visual quality or desktop/other-platform acceptance.

The final installed npm smoke passed at clean source `281d90b`: 122 tarball
files, all 117 runtime payload hashes, offline temporary installation, prefix
relocation and state-only reconstruction. It also exercised selected sync,
receipt/pending semantics, final render and sibling-source refusals for
status/diff/get/edit. There was one pending edit before sync and zero after
verified render; content, geometry and docId were retained. It changed no user
installation/configuration.

Type checks, lint (211 files), formatting (212 source/script/test/launcher
files) and whitespace checks passed. A legacy component-deletion test was
extended to reject incomplete destructive selection and then explicitly review
all affected pending edits; its original remaining-state assertions are
preserved and its real Quarto rerun passed.

The completed broad-suite outcome, corrected fixture rerun and clean archive are
recorded below. The first exploratory broad pass was deliberately stopped after
the implementation froze; its earlier legacy fixture failure is not relabeled as
a passing run. No registry publication is inferred from source or local package
checks.

## Final prepared archive

The archive was staged from clean commit
`281d90bcfbbf003c4b7547fe7522c0f22cd7d151` (`dirty: false`), including the final
readable Studio selection labels. It contains 122 regular files and all 117
runtime payload sizes/hashes match its manifest. Pinned upstream bytes, notices
and existing license-source disclosures remain unchanged.

| Property      | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Filename      | `brianmsm-quarto-bento-0.1.1.tgz`                                                                 |
| Archive bytes | 896928                                                                                            |
| SHA256        | `c83995600a1f33e1fdb4e13ba7811f3da9b4147e6901792ea130a0f941010e85`                                |
| npm shasum    | `aaa2fe14a9d5f80fc98204dd4d75b0ec71120961`                                                        |
| npm integrity | `sha512-x5q3/BgnMdrivVRc+b8eF28ruwIooaTOitPPqjb0J9aDgaoSZVdgtoK1biJZv9BGjw0TfcMpZOdjd0ip8kpUPw==` |

Mise 2026.10.11 installed this exact archive through its default npm backend
against a temporary IPv4 loopback registry. Version (`qbento 0.1.1`), doctor and
all 117 installed hashes passed. Only fixture metadata and the tarball were
requested; user configuration was unchanged. This is local artifact evidence,
not availability on npmjs.org. The ignored detailed receipt is
`output/npm/release-0.1.1/mise-local.json`; stage/pack metadata and the archive
are in that same local directory.

Final Studio checks passed **eight tests, zero failures (18s)** after the label
refinement, including a real Chromium interaction. A second captured run passed
and was visually inspected at a 1280 x 900 viewport: the review dialog measured
928 pixels wide with no horizontal overflow. Selected and excluded changes,
separate deletion consent, reviewed patches and the post-Apply message were
checked. The image and log are local ignored artifacts at
`output/verification/0.1.1/selection-dialog.png` and `visual-review.log`. This
checks the bounded review dialog, not the design quality of arbitrary decks.

## Supplemental pinned-source comparison

The broad invocation did not set `QBENTO_BENTO_SOURCE`, so its optional native
math-source comparison remains recorded as ignored. A local checkout was then
found at `output/verification/bento-upstream`; its HEAD matches the pinned Bento
revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`, and its tracked worktree is
clean. Running the exact omitted test separately passed **one test, zero
failures (48ms)**. Its eight other tests were filtered, not rerun or relabeled.
The receipt is `output/verification/0.1.1/upstream-math.log`.

```sh
QBENTO_BENTO_SOURCE="$PWD/output/verification/bento-upstream" \
  NO_COLOR=1 deno test --allow-read --allow-env --allow-run \
  --filter 'pinned Bento renderer verifies math rejection and text fidelity regressions' \
  tests/math_test.ts
```

## Relocation fixture correction

The broad run exposed a legacy registry relocation fixture that copied
`state.json` but omitted the source association in `project.json`. The new
fail-closed loader correctly refused `PROJECT_BINDING_MISSING` before
rebuilding. The fixture now copies the original metadata too, as required by
[the reconstruction guide](../USAGE.md#change-data-and-rebuild). Two equivalent
weak-math/code relocation fixtures were updated proactively. No runtime guard or
content/design/identity assertion was weakened.

The complete affected files were rerun after this correction at `0c4f757`:
**eight tests passed, zero failures (2m42s)**. The detailed receipt is
`output/verification/0.1.1/relocation-fixtures-final.log`. The earlier failed
reproduction is retained separately as `registry-failure-repro.log`. The
runtime/package inputs still match clean artifact source `281d90b` exactly; this
fixture correction changes tests only.

## Completed broad-suite outcome

The broad Linux run completed with **598 passed (4 steps), 3 failed, 1 ignored
(33m23s)**. All three failures were the registry/weak-math/displayed-code
relocation fixtures described above: their source graph had been compiled before
the missing `project.json` copies were corrected. The entire affected test files
subsequently passed **8/8**. The ignored pinned-source math test subsequently
passed **1/1** with the verified local checkout. No other broad suite failure
was reported, including the strict widget SVG comparison. This does not
establish a cause or a fix for the previously documented intermittent SVG
mismatch.

Across the broad run and these targeted reruns, all **602 distinct test cases**
received a passing result. This is combined coverage, **not a claim of a new
single full-suite run with zero failures**. The production runtime did not
change during the fixture correction; final Studio label checks, installation,
relocation and reconstruction checks also passed separately. Historical 578-test
acceptance remains tied to its earlier revision.

The broad invocation was:

```sh
DENO_JOBS=2 NO_COLOR=1 \
QBENTO_STUDIO_BROWSER_TEST=1 QBENTO_RELATIONS_BROWSER=1 \
QBENTO_LAYOUT_BROWSER=1 QBENTO_PYTHON_EXECUTION_TEST=1 \
QBENTO_TEST_PYTHON=/usr/bin/python3 \
QBENTO_WIDGET_EVIDENCE="$PWD/output/verification/0.1.1/widget-svg" \
  deno test --parallel --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

The affected files were rerun with the same permissions:

```sh
NO_COLOR=1 deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/registry_execution_test.ts \
  tests/weak_math_identity_test.ts
```

Deno 2.9.6, Quarto 1.10.19, R 4.6.1 and Chromium 152.0.7977.82 were present. The
genuine Python execution lane was enabled with `/usr/bin/python3`. All browser
results here are Linux headless evidence; they do not qualify a foreground
desktop session, Windows/macOS or arbitrary visual quality.

Detailed logs are local ignored artifacts under `output/verification/0.1.1/`.
Their SHA256 values preserve the exact recorded runs:

| Receipt                          | SHA256                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| `full-suite.log`                 | `3176259bc599a114732dc45b1fe87fba5d71ebe8eefc953e29c37e3a7c517052` |
| `relocation-fixtures-final.log`  | `3b410f791e09a3f19f3cdaf7f7ae9db58c248ff23e45cfa6bd7e39c7118d10ca` |
| `upstream-math.log`              | `39ba842282862058706f3c3790ec1a5cf8615d0deb22e38a584beb79c11e5157` |
| `final-ui.log`                   | `4129fd6171596e911b3ac53862c48a413ed6e9d43dbafe6044336613e641ad5b` |
| `npm-installed-smoke-final.json` | `337e9d55b785a3e0dd3150507a99d80868a6e8e5623782eceb622896bf45bdd4` |

## Public npm release and global mise update: 2026-10-17

The owner authorized publishing `0.1.1` and updating the installed mise tool.
After web login and the separate publish authorization, npm accepted the exact
archive above with public access and the `latest` tag. The command completed
successfully while npm processed the version; public version requests initially
returned 404. No duplicate publication was submitted.

Anonymous registry checks subsequently verified exact-version metadata,
`latest: 0.1.1`, the standalone README, complete archive bytes, npm shasum and
SHA512 integrity. The historical `0.1.0` shasum remains unchanged. The public
archive SHA256 is
`c83995600a1f33e1fdb4e13ba7811f3da9b4147e6901792ea130a0f941010e85`.

A fresh anonymous npm installation used empty separate user/global npmrc files,
an isolated prefix/cache and a normal install without `--ignore-scripts`.
Version and doctor passed and all 117 installed payload hashes matched the
archive. A real render preserved QMD. A two-edit JSON patch, selected sync,
reviewed Apply and subsequent render synchronized one edit while retaining the
excluded edit, document identity and saved x-position 137. The QMD source was
unchanged by each render. This temporary smoke changed no user configuration.

A separate anonymous mise installation used fresh config/data/cache/state and
npm configuration against the public registry. Its default npm backend passed
version, doctor, all 117 installed hashes and a real render with unchanged QMD
and zero pending edits. It changed no user configuration.

The owner-requested global update used the validated local tarball through a
temporary loopback registry while public verification was pending. The registry
override existed only in the installation subprocess and was not persisted. That
same archive subsequently matched the public version byte for byte. The selected
global command was:

```sh
mise use -g 'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.1.1'
```

The existing mise shim now resolves `qbento 0.1.1`. One immediate lookup in the
update process saw the old selection; fresh-process checks confirmed the new
version without modifying shim code or links. The tool's previous selection was
`0.1.0`; parsed configuration comparison confirmed that unrelated tools and
settings were unchanged. All 117 installed hashes and the manifest matched the
published archive. Doctor and a real render passed with zero pending changes,
unchanged source and no diagnostics. A sibling QMD correctly refused
`PROJECT_SOURCE_MISMATCH`. The private configuration backup was removed after
verification. Existing Node, Deno, Quarto and computation environments were not
installed or changed.

These are public registry and owner-installation results, separate from the
earlier loopback test and isolated local tarball checks. They do not declare
stable v1, hosted CI success or Windows/macOS qualification. The four historical
license-source gaps and other documented acceptance limits remain unchanged.

Detailed local receipts are `output/npm/release-0.1.1/public-check.json`,
`public-mise-check.json` and `mise-global-update.json`. Their SHA256 values are:

| Receipt                   | SHA256                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `public-check.json`       | `2965e6b86f2ba8712d995dff2be454fdb7eb21e3ed54182b5cccf04bf0135b63` |
| `public-mise-check.json`  | `eaa221833f11d4095cccf14ce3351d7dc594af3e76639d2f51451883f84bde58` |
| `mise-global-update.json` | `2ff60950d0baa2932e3f9a92684366203664728d636b3d853888e079a5740e14` |
