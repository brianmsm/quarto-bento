# Execution producers and installed Python: local Linux evidence

Dates: 2026-10-11–2026-10-13. This is implementation evidence for the bounded computation
lane, not a full product acceptance receipt or a cross-platform qualification.
No environments, packages or interpreters were installed or managed.

## Environment and independent engines

The exercised environment has Quarto 1.10.19, Deno 2.9.6, R 4.6.1,
knitr 1.51, reticulate 1.46.0, Python 3.14.7 at `/usr/bin/python3`, and
Matplotlib 3.11.1. Python runs as genuine Python through Quarto's `knitr`
engine and the already installed R package `reticulate`. Tests explicitly select
that existing Python and set `RETICULATE_USE_MANAGED_VENV=no`.

This does **not** qualify Quarto's Jupyter engine. The installed Python lacks
`nbformat`, `ipykernel` and Jupyter; an actual `engine: jupyter` probe failed
with `ModuleNotFoundError: nbformat` before Bento publication. Julia is also
absent. These are dependency gates, not evidence that Python must use R in the
product. No dependency installation or automatic environment setup was attempted.

## Original producer proof

Quarto/knitr can discard ordinary chunk labels from `.cell` wrappers. Several
echo and stdout blocks can also appear in separate nested wrappers. A local
counter formerly assigned repeated `producer/code:1` IDs. IDs now count across
those transparent wrappers, separately for each slide and original producer.

Displayed code is not a producer receipt. A real partial-echo chunk whose first
two expressions matched another hidden chunk used to borrow that chunk's identity.
Dynamic `opts_chunk$set` and user hooks can similarly reduce the echo or rename
`options$label` and `options$code`. Matching the displayed body cannot resolve
those cases safely and has been removed.

For the guarded computation pipeline, a per-process R adapter wraps the installed
knitr `call_block(block)` function. It verifies the original input file, original
parsed label and exact original body before options/hooks mutate them, invokes
the original function once, then wraps its returned Markdown with an invocation
receipt. The manifest binds source hash, chunk identity, slide, original label,
body and invocation. Nested/foreign knitting is refused. The original QMD,
working directory, basename, chunk options and source spans remain intact.

Receipt insertion occurs after the original return, including a cache hit. The
nonce does not enter knitr's cache options/hash or cached Markdown. A separate
output ledger requires every emitted receipt to reach AST capture once and in
order. Missing, foreign, repeated, malformed or stale receipts refuse publication.
Captured AST trust is attached privately in memory; a serialized AST or a filter
attribute cannot self-declare it. Existing bounded gt/Plotly adapters look through
one verified receipt only when its producer agrees with their original-source
proof.

User/profile startup selection preserves `R_PROFILE_USER` unset, empty, and
explicit relative values; original user profile errors propagate. A data-only R startup probe uses native `readRenviron` to resolve site/user
file selection and variable expansion. It runs without profiles or user default
packages. A site-profile chain preserves the effective user-profile selection,
including one made by the site profile itself; both original profiles and the
QMD execute only once. The actual computation receives the resolved environment
with `--no-environ`. No user startup files are rewritten. The helper's private
transport is removed and its environment values are not logged. This is a
separate R startup, not a second QMD computation. Authored-only documents skip it.
The adapter only changes the child computation process. The permanent tests cover original project-local and default user-home
profiles and user hooks coexisting with the adapter.

## Supported loop and safety checks

`tests/python_execution_test.ts` exercises a real SVG line plot and computed sum
from CSV, an authored paragraph, and mixed R/Python cells. It captures native
figure geometry, paragraph style and stdout style without rewriting QMD; previews
and applies the exact authored source patch; changes data from `1,2,3` to
`1,20,30`; and verifies that the actual plotted SVG path and sum change from
`6.0` to `51.0` while design, document ID and producer identities survive.
A computed-output edit becomes a synchronization conflict, never a Python source
patch. Explicit keep-source reconciliation restores the result. A cold relocation
with only QMD, data and sidecar rebuilds the same design and identity.

The example fixes SVG date metadata and SVG ID salt in its own Python code.
Matplotlib's default date/random IDs can make a reviewed reconciliation stale;
the core continues to reject a changed result rather than weaken that check.

R regressions cover interleaved echo/stdout, multiple producers/slides, hidden-code
figure plus stdout, partial/dynamic echo, hidden/visible/unevaluated decoys,
hook-renamed labels/code, unnamed chunks, and cache hits. A two-render cache probe
writes an execution counter exactly once while receiving fresh proof tokens in
both captures. Foreign `knit_child` output cannot borrow an original hidden chunk.

## Remaining transformation boundary

Computed documents currently refuse user Pandoc/Lua filters before execution.
A filter can detach receipts or exchange them between outputs; a receipt copied
to different output is not original producer proof. Effective QMD/project/profile/
metadata configuration is inspected, and only the exact installed internal
qbento guard/capture filter content is admitted. The selected HTML format is
checked when inspection exposes it, so a filter only in an inactive PDF format
is allowed. Quarto inspect has no `--to` override; if the forced HTML format is
absent from inspection, the gate conservatively checks the inspected formats.
This can refuse a filter on a format that the CLI would not execute. Authored-only
QMD retains its existing user-filter workflow.

The ordinary Quarto extension activation is documented separately in
[`PRODUCER-ACTIVATION.md`](PRODUCER-ACTIVATION.md). It uses the same original receipt and filter gate.
The opt-in `tests/python_quarto_execution_test.ts` also installs the actual
example extension and uses only ordinary `quarto render` for its two computations:
CSV changes alter the actual SVG path and sum, while saved figure geometry,
stdout style, docId and source bytes survive. This passed together with the
portable-package regression: **2 tests, 0 failures, 0 ignored, 18s** on 2026-10-13. The package regression
executes both the packaged CLI capture and an ordinary project installed from the
packaged runtime, checking one execution per render. The retained current log is
`/tmp/qbento-producer-resume-python-package.log`; it checks this lane
worktree before main integration, rather than the complete product.

R startup flags `--vanilla` or `--no-init-file` in
`QUARTO_KNITR_RSCRIPT_ARGS` disable the transport. Computed documents refuse those
flags before running chunks; the user's flags remain intact.

Future engines and arbitrary computed transformations need their own verified
transport, not an echo or proximity fallback.

## Current focused validation

The later [effective-Renviron regression](PRODUCER-ACTIVATION.md#effective-renviron-and-profile-precedence-2026-10-13)
passed 26 tests together after the startup correction, including these Python
CLI/ordinary and portable-package checks. Earlier results below retain their
original narrower scope.

On 2026-10-13, the six CLI/source/Python test files below passed together:
**24 tests, 0 failures, 0 ignored, 54s**. The current retained log is
`/tmp/qbento-producer-resume-core.log`. This validates producer receipt parsing,
original labels despite hooks/partial echo, rejection of foreign child knitting,
user profile behavior, cache hits, effective filter/startup refusal, source
patches and real Python changed-data execution. It does not replace the merged
product suite or native UI acceptance.

```sh
DENO_JOBS=2 NO_COLOR=1 QBENTO_PYTHON_EXECUTION_TEST=1 \
QBENTO_TEST_PYTHON=/usr/bin/python3 deno test --parallel \
  --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 \
  tests/producer_capture_test.ts tests/producer_execution_test.ts \
  tests/producer_filters_test.ts tests/computed_code_test.ts \
  tests/computed_code_execution_test.ts tests/python_execution_test.ts
```

The two ordinary/Python/package tests above passed in a separate current run.
The ordinary activation receipt records its separate 14-test run. The results
belong to this lane's committed runtime, before main integration.

## Reproduction

```sh
QBENTO_PYTHON_EXECUTION_TEST=1 QBENTO_TEST_PYTHON=/usr/bin/python3 \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/computed_code_test.ts \
  tests/computed_code_execution_test.ts tests/producer_capture_test.ts \
  tests/producer_execution_test.ts tests/producer_filters_test.ts \
  tests/producer_package_test.ts tests/python_execution_test.ts \
  tests/python_quarto_execution_test.ts
```

The Python test is opt-in because it requires a compatible installed interpreter
and Matplotlib/reticulate. When enabled, missing dependencies fail clearly; the
test never installs them. The portable package test verifies the R helper bytes
and invokes Quarto through the packaged runtime, demonstrating that the helper
is shipped and reachable offline.
