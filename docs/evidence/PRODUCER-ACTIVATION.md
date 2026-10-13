# Original producers in ordinary Quarto rendering

**Status (2026-10-13): implemented and tested locally on Linux with Quarto
1.10.19, knitr 1.51 and R 4.6.1.** This extends the guarded
[`qbento-html` integration](QUARTO.md). It does not establish other-platform,
other-version or public-release acceptance.

## Problem and resulting behavior

Quarto's executed Markdown does not always retain a cell's original label.
Partial echo can show only a prefix of a chunk; two chunks can share that prefix
while returning different results. Comparing visible code cannot prove which
source produced the output. A figure ID also does not prove the producer of
adjacent stdout.

Both the CLI and the installed extension now receive an original execution
boundary from knitr before that identity disappears. Ordinary
`quarto render deck.qmd` continues to use knitr and execute the QMD once. A
chunk with `echo: !expr c(1,2)` and three print expressions assigns all five
emitted code/result objects to that chunk, including the third result whose code
is hidden. A later `echo: false` chunk retains its own identity. A hidden chunk
with the same visible code prefix is not selected as the producer.

The original QMD remains byte-identical. The extension does not install a
language environment, replace a profile file, add a setup chunk, launch a second
computation or require a shell wrapper.

## Activation and publication boundaries

The extension contributes a discovery module whose `claimsFile` and
`claimsLanguage` methods return false. Its `launch` method refuses selection; it
never replaces knitr. Quarto's
[execution-engine initialization interface](https://github.com/quarto-dev/quarto-cli/blob/main/llm-docs/quarto-api.md)
provides the parent-process initialization point. The installed implementation
and types were checked in `/opt/quarto/bin/quarto.js` and
`/opt/quarto/share/extension-build/quarto-types.d.ts`.

The small compatibility adapter in
[`producer-activation.js`](../../_extensions/qbento/producer-activation.js)
decorates the shared `quarto.system.execProcess` function. It changes the
environment only for Quarto's `rmd/rmd.R` request with action `execute`, input
at this project's root and a current source/PID receipt. Inspection, dependency
requests, other engines and user pre/post scripts keep their original process
environment. The adapter preserves the computation request, stdin and remaining process
options, and calls the original launcher once for the QMD. It resolves R startup
variables first with a separate data-only R process; that is an auxiliary startup,
not a second QMD computation.

This decoration is an explicitly tested compatibility adapter, not an upstream
producer-receipt API. Its `quartoRequired` is exactly `=1.10.19`; API
capability, project, source and process guards also refuse an unverified
activation. Supporting a different Quarto version requires fresh evidence for
its launch path. The CLI's independent execution adapter and its own guards
remain documented separately.

The guarded ordinary render follows these steps:

1. Pre-render resolves effective filter configuration and refuses unverified
   user filters in computed documents before any chunk executes. The exact
   internal guard/capture bytes are checked against pinned hashes. Inspection
   includes project, profile and metadata inheritance. Computed documents also
   refuse `QUARTO_KNITR_RSCRIPT_ARGS` values containing `--vanilla` or
   `--no-init-file` before computation, because those flags bypass the required
   R profile. The guard leaves the user's flags unchanged.
2. Pre-render writes an original-source manifest and an empty output ledger into
   `.qbento/quarto-stage/`. A hash of that manifest belongs to the current
   durable Quarto run receipt. Manifest and ledger must be ordinary unlinked
   files in a real stage directory.
3. A base-only R helper runs with `--vanilla --default-packages=NULL`, restores
   the original unset/empty/value startup selectors cleared by `--vanilla`, and
   uses native `readRenviron` for site/user environment files. It loads no site
   or user profile, user default package, workspace or QMD. Only environment
   changes made by those files reach the real child; probe-generated temporary
   variables are excluded. The private binary transport is removed immediately
   and its values are never printed. Authored-only documents need no R probe.
   The actual R process uses `--no-environ` with that effective environment;
   effective default-package selection is transported as an environment value
   so a command-line default does not reverse the native Renviron precedence.
   A small site-profile chain executes the original site profile once, retaining
   any user-profile selection it makes. When `--no-site-file` is selected, that
   chain is omitted. The user-profile adapter then chains the effective original
   user profile with the original distinction between an unset, empty or relative
   `R_PROFILE_USER`. The producer adapter
   verifies the original chunk label/body and the current knit input, calls the
   original `knitr:::call_block` once, and wraps its returned Markdown with a
   fresh invocation token. The separate ledger records those returned
   boundaries. The wrapper runs after knitr's cache handling, so a fresh token
   does not invalidate the computation cache.
4. Post-render checks source/run identity, the manifest hash, ledger order and
   each captured boundary. Every executed cell must remain inside a verified
   boundary. Only that checked consumer attaches the manifest to the AST's
   in-process trust map before projection. A serialized AST attribute cannot
   grant itself producer authority.
5. Successful publication removes the producer manifest/ledger and the run
   receipt. Failed runs retain the receipt and baseline for explicit recovery.
   Recovery first confirms that the original process stopped and removes only
   its derivative staging files; it preserves the final deck and native edits.

User pre/post hooks that override project defaults must retain the guarded
qbento hooks. For example, put `_extensions/qbento/pre.ts` before an additional
user pre-render script and retain `_extensions/qbento/post.ts` in post-render.
The default `qbento init` configuration already retains those hooks.

## Local validation

The dedicated
[`quarto_producer_activation_test.ts`](../../tests/quarto_producer_activation_test.ts)
and existing [`extension_test.ts`](../../tests/extension_test.ts) passed
together: **14 tests, 0 failures, 0 ignored, 54s**. The current worktree run on 2026-10-13 used:

```sh
DENO_JOBS=2 NO_COLOR=1 deno test --parallel \
  --allow-read --allow-write --allow-env --allow-run \
  tests/extension_test.ts tests/quarto_producer_activation_test.ts
```

The retained log is `/tmp/qbento-producer-resume-ordinary.log`; the runtime
was `818c7a1` plus the activation files committed with this receipt. This
focused run does not claim the later merged product state.

The new tests use project paths with spaces and real installed Quarto/R. They
verify partial echo with a hidden decoy, multiple producer outputs, no execution
on inspect, source byte preservation, unset/empty/relative and project-local
profiles, unchanged profile files, an intact cache across two renders with fresh
receipts, failed-execution recovery, filter and disabled-startup refusal before
execution, staging aliases, and original environments in user pre/post R
scripts.

The existing tests also retain changed-data SVG regeneration, saved geometry,
stable `docId`, uncaptured-HTML refusal, output-override refusal, rebuild
without old HTML, CLI rendering from an installed project, and native edits
written during a failed render. Type checking, linting and formatting passed for
the activation/integration paths. These are execution and core persistence
checks; they do not replace native visual acceptance or the product-wide Linux
suite.

Python through knitr/reticulate has its own real-execution regression in
[`python_quarto_execution_test.ts`](../../tests/python_quarto_execution_test.ts).
Jupyter and other execution engines require their own original-producer adapters
and evidence. Nested or foreign knit input and unverified output transformations
refuse explicitly; preserving their identity is an open technical gate rather
than an acceptance claim.

### Effective Renviron and profile precedence (2026-10-13)

An independent review reproduced a startup bypass: a project `.Renviron` setting
`R_PROFILE_USER` replaced the adapter and allowed computation without receipts.
The environment helper and site-profile chain now preserve that native selection
before the computation. Native-reference probes covered unset, empty, relative,
site-to-user file precedence, `--no-environ`, a site profile selecting the user
profile, `--no-site-file`, and authored documents with no R executable.

The current extended regression passed **26 tests, 0 failures, 0 ignored,
1m43s**. Its log is `/tmp/qbento-producer-environment-regression.log`:

```sh
DENO_JOBS=2 NO_COLOR=1 QBENTO_PYTHON_EXECUTION_TEST=1 \
QBENTO_TEST_PYTHON=/usr/bin/python3 deno test --parallel \
  --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 \
  tests/producer_environment_test.ts tests/producer_execution_test.ts \
  tests/producer_package_test.ts tests/extension_test.ts \
  tests/quarto_producer_activation_test.ts tests/python_execution_test.ts \
  tests/python_quarto_execution_test.ts
```

The permanent environment tests check six startup variants through both CLI and
ordinary Quarto, one site/user/chunk invocation per render, unchanged source and
startup files, native variable expansion, Renviron precedence over a command-line
default-package selection, no profile or user-package loading in the data-only
helper, and no new R dependency for authored-only source. Environment mutation
cases run in isolated Deno children because process environment changes otherwise
cross parallel test-module boundaries. Type checking, lint and formatting passed
for the changed TypeScript/JavaScript paths. These focused results still require
merged-product validation and independent review of the final commit.
