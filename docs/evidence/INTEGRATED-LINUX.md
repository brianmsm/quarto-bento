# Integrated Linux validation

This is the historical `75edcdf` receipt. The newer combined runtime, ordinary
authoring workflows and portable package are recorded in
[the 2026-10-13 receipt](ORDINARY-INTEGRATED-LINUX.md).

The integrated runtime
`75edcdf0dc2b04d09d6314c0630f694693c55f8e` passed the complete suite on
2026-10-11: **430 tests passed, 4 test steps, 0 failures, 0 ignored
tests**, in **9m44s**, with process exit status **0**. All optional pinned
math, Studio and Relations browser checks ran. Two independent test modules ran
concurrently using `DENO_JOBS=2`.

The earlier `260bc8f` attempt exposed three obsolete test expectations and an
intermittent Chromium startup failure. The expectations were updated while
retaining their negative assertions; the startup race was reproduced, corrected
and independently reviewed before this passing full run. See
[startup evidence](CHROMIUM-STARTUP.md).

The environment is Linux x86_64, Deno 2.9.6, Quarto 1.10.19, R 4.6.1 and
Chromium 152.0.7977.82. Bento is pinned to
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (1.2.6). Subsequent closeout changes
are documentation only; the runtime and tests are unchanged from `75edcdf`.

## Full-suite invocation

```sh
QBENTO_BENTO_SOURCE=/tmp/qbento-upstream \
QBENTO_STUDIO_BROWSER_TEST=1 \
QBENTO_RELATIONS_BROWSER=1 \
DENO_JOBS=2 \
deno test --parallel --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

`QBENTO_BENTO_SOURCE` identifies the local checkout of the pinned upstream
revision for the mathematical-renderer comparison. The Studio and Relations
flags enable the real headless Chromium checks; `DENO_JOBS=2` limits independent
test modules to two workers. Ordinary tests execute installed Quarto and
supported R dependencies; no environment manager was added.

The suite covers source-byte/provenance checks, retained design and pending
edits, safe synchronization and refusal cases, recovery and stale revisions,
structural edits, agent operations, annotations/registry, composed diagnostics,
rich-table capture, widgets and the protected local Studio server. New coverage
includes ordinary QMD identity acquisition, confirmed source-element deletion,
source and Studio-created KPIs, native transparent spans, graph relationships,
weak-heading source scopes and combined component/graph synchronization.

These assertions establish their documented fixture behavior. They do not
establish unrestricted conversion or platform-wide acceptance.

## Additional checks and usable artifacts

- `deno task check` passed for the complete source tree.
- `deno lint src tests scripts` passed, checking **158 files**.
- `deno fmt --check src tests scripts` passed, checking **159 files**.
- `git diff --check` passed.
- The complete portable smoke passed with exit **0** in **6.92 seconds**. Its
  **91-file** package retains saved design and pending content through state-only
  reconstruction, relocation and ordinary Quarto after deleting the original
  portable runtime. See [the packaging contract](../PACKAGING.md).
- The usable development directory is `output/qbento-dev-75edcdf/`; its archive
  is `output/qbento-dev-75edcdf.tar.gz`. Every payload SHA-256, byte count and
  executable flag was independently checked against the manifest. The actual
  launcher passed `doctor` with the versions above.
- `output/demo-75edcdf/` was rebuilt by that launcher from only `deck.qmd`,
  `data.csv` and `.qbento/{project.json,state.json}` copied from the native
  component acceptance project. The previous HTML, history and execution caches
  were not copied. The complete emitted native document remained exact,
  including both promoted components and the computed figure. QMD bytes and
  `docId` were unchanged, and revision 12 had **zero pending edits**. Its README
  gives commands to open and rebuild the demo.

The raw suite, portable, static and artifact logs are indexed locally by
`output/verification/75edcdf/receipt.json`, including a SHA-256 log inventory.
`output/` is ignored by Git; this versioned receipt records commands, versions,
scope and results. The artifact receipt
contains manifest/archive hashes and the demo source hash. The older
`output/verification/c225546/receipt.json` remains historical evidence.

## Native UI evidence and remaining boundaries

The coordinator separately operated and visually inspected the real Studio
client and pinned Bento editor for
[ordinary-QMD and source KPI workflows](PLAIN-KPI-NATIVE.md),
[explicit card/KPI creation and recovery](COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux),
[diagram relationship controls](GRAPHS.md#explicit-relationship-controls-accepted-on-linux),
[confirmed source-element deletion](ELEMENT-DELETION.md),
[text insertion and sync](TEXT-INSERTION.md),
[registry changes with pending content](STUDIO-REGISTRY.md),
[diagnostic banner lifecycle](MISSING-DESIGN.md), and the earlier semantic,
component, chart/table, offline widget and PDF workflows. Those native receipts
record their own runtime revisions; the final integrated suite and portable
rebuild complement them rather than relabeling all earlier UI checks as having
run on the final SHA.

Headless Chromium uses the actual bundled editor and rendering engine without
taking the desktop mouse or keyboard. This is Linux browser evidence;
operating-system file dialogs are a separate validation layer. Computation
receipts here principally use R, not every Quarto language/dependency stack.

The owner limited this pass to local Linux. Hosted CI, macOS/Windows and native
other-platform preflight remain deferred; the repository has no Git remote.
The bounded codecs/adapters still refuse unsupported content and ambiguous
source edits. Complete dependency/license review and a frozen public release
scope remain separate gates. This closes neither the entire product horizon
nor a public v1 release.
