# Integrated Linux validation

The integrated runtime at `c22554621c4b5651d024a18e2c6af542824a90be` passed the
full suite on 2026-10-11: **332 tests passed, 4 test steps, 0 failures, 0
ignored tests**, in **8 minutes 34 seconds**, with process exit status **0**.
Subsequent integration-closeout changes are documentation only.

The environment was Linux x86_64, Deno 2.9.6, Quarto 1.10.19, R 4.6.1 and
Chromium 152.0.7977.82. Bento is pinned to
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (1.2.6).

## Full-suite invocation

```sh
QBENTO_BENTO_SOURCE=/tmp/qbento-upstream \
QBENTO_STUDIO_BROWSER_TEST=1 \
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

`QBENTO_BENTO_SOURCE` identifies the local checkout of the pinned upstream
revision for the optional mathematical-renderer comparison. The Studio flag
enables the real headless Chromium check. Both optional checks ran in this
receipt. Ordinary tests execute installed Quarto and supported R dependencies;
no environment manager was added.

The suite includes source-byte/provenance checks, retained design and pending
edits, safe synchronization and refusal cases, recovery and stale revisions,
structural edits, agent operations, annotations/registry, composed diagnostics,
rich-table capture, widgets and the protected local Studio server. Tests and
headless checks establish their documented fixture behavior, not unrestricted
conversion or platform-wide acceptance.

## Additional checks and usable artifact

- `deno task check` passed for the complete source tree.
- `deno lint src tests scripts` passed, checking 110 files.
- `deno fmt --check src tests scripts` passed, checking 111 files.
- The complete portable smoke passed with exit 0. Its 69-file package preserves
  saved design and pending content through state-only reconstruction, relocation
  and ordinary Quarto after removing the original portable runtime. See
  [the packaging contract](../PACKAGING.md).
- The generated local development package is `output/qbento-dev-c225546/`. Every
  payload SHA-256 and byte count was checked against its manifest; the actual
  launcher passed `doctor`.
- A separate copy of the canonical semantic example is
  `output/demo-c225546/deck.qmd`, with its local CSV and generated native HTML.
  The portable launcher rendered it with zero diagnostics and zero pending
  edits. Its Studio server returned HTTP 200. This extra copy is generated
  demonstration material, not a modification of the versioned example.

The raw full-suite, portable and static-check logs plus their SHA-256 inventory
are retained locally under `output/verification/c225546/receipt.json`. `output/`
is ignored by Git; the commands, versions and result summary here are the
versioned receipt.

## Native UI evidence and remaining boundaries

The coordinator separately inspected the real native editor for
[text insertion and sync](TEXT-INSERTION.md),
[registry changes with pending content](STUDIO-REGISTRY.md),
[diagnostic banner lifecycle](MISSING-DESIGN.md), and the previously recorded
semantic, component, chart/table, offline widget and PDF workflows. These are
Linux browser checks; headless execution still uses the actual bundled Bento
editor and rendering engine.

No hosted CI run, macOS/Windows execution, operating-system file-dialog
acceptance or public release is claimed. The native other-platform preflight and
packaging gates remain open; the current repository has no configured Git
remote. The exact public v1 scope and project license remain separate decisions.
This receipt does not declare the full product target complete.
