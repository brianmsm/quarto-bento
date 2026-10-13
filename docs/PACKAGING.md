# Portable development directory

This package is a local development artifact, not a v1 release or a native
installer. It contains the current TypeScript runtime, Lua filters, offline
Quarto extension, pinned Bento shell/schema and provenance, upstream license and
notices, the complete OFL texts and authored provenance note for the two
embedded fonts, Unix and Windows command launchers, and a sorted SHA256
inventory. It requires installed Deno 2, Quarto (tested with 1.10.19), and the
language/packages used by the user's QMD. It does not install or manage these
dependencies.

From a source checkout, create a **new** directory whose parent already exists:

```sh
deno run --no-config --allow-read --allow-write --allow-run=git scripts/package.ts '/tmp/qbento development'
```

The builder refuses an existing destination, an input symlink, an unexpected
runtime file, or a pinned Bento asset inconsistent with `vendor/bento/pin.json`.
It copies an explicit runtime inventory; it does not copy `.git`, worktrees,
user configuration, fixtures, caches, `node_modules`, or generated
presentations. No timestamps or absolute source paths are written to
`manifest.json`. Identical input bytes produce identical package files and
inventory; this is not a claim of reproducible compilation of Bento upstream.
The `--allow-run=git` permission is used only by the package builder to record
the source checkout commit and Git dirty state; it is not used by the installed
launcher. When Git cannot identify the source root and status, the manifest
records an explicit `qbentoSource.kind: "unknown"` reason. Run without this
permission only when an unknown source record is intended.

Move or archive this entire directory. On Unix, preserve the executable bit on
`bin/qbento` (for example, with tar), or invoke it with `sh`. Run from your
project directory; paths containing spaces must be quoted:

```sh
'/tmp/qbento development/bin/qbento' doctor
'/tmp/qbento development/bin/qbento' render 'slides with spaces.qmd'
'/tmp/qbento development/bin/qbento' edit 'slides with spaces.qmd'
'/tmp/qbento development/bin/qbento' init 'slides with spaces.qmd'
```

On Windows, the corresponding command is:

```bat
"C:\qbento development\bin\qbento.cmd" doctor
"C:\qbento development\bin\qbento.cmd" render "slides with spaces.qmd"
```

Both launchers use installed `deno` on PATH, disable automatic Deno
configuration and remote/npm module resolution, preserve the caller's working
directory, and forward arguments and exit status. Their permissions match the
development CLI: read/write files, execute user computations, inspect
environment, and serve Studio on IPv4 loopback. Only run trusted QMD and code.
There are no remote Deno imports or installed npm dependencies required by the
packaged runtime. The pinned Bento npm manifest and lockfile are included under
`runtime/vendor/bento/provenance/` as read-only provenance data; the launcher
does not consult them, install packages, or access a registry. Ordinary workflow
remains offline with compatible installed computation packages and local input
assets.

`init` copies the self-contained extension into the user's project and refuses
to replace existing Quarto configuration or an installed extension. Its ordinary
`quarto render` preflight is currently verified only on Linux; macOS and Windows
remain pending native validation. Having a Windows launcher does not establish
Windows runtime support. Linux relocation tests exercise `doctor`, `render`,
`validate`, `init`, and ordinary `quarto render` with a fresh Deno cache and
access to the source checkout denied for the packaged CLI. Ordinary integration
is tested after relocating the installed project into another directory with
spaces, removing the generated HTML and removing the portable runtime. Fixed
project-relative hooks also support spaces and quotes in project/source paths;
the measured Quarto hook correction is recorded in `docs/evidence/QUARTO.md` in
the source checkout.

`manifest.json` schema version 2 lists each payload file's relative path, byte
count, SHA256 and executable flag, plus the Quarto-Bento source Git commit and
whether the checkout has tracked, staged, or non-ignored untracked changes. The
dirty bit comes from `git status --porcelain=v1 --untracked-files=all`; an
unavailable Git result is recorded as `unknown`, never guessed clean. The
manifest itself is excluded to avoid a recursive self-hash. It detects
differences when independently checked against a trusted inventory; it is not a
signed authenticity guarantee. Concurrent changes to the source checkout during
packaging are unsupported; build from a reviewed, stable tree.

The Bento shell, schema, upstream MIT license, upstream third-party notice,
`slides/package.json`, and `slides/package-lock.json` are tied to the revision
in `runtime/vendor/bento/pin.json` by their pinned SHA256 values. The package
builder checks the shell and each pinned upstream/provenance file before
creating its destination. It also verifies the authored font provenance note and
each full font-license file against their recorded hashes and official,
commit-specific source URLs. The offline `runtime-dependencies.json` inventory
records the three direct dependencies from Bento's `slides/package.json` and the
lockfile's production entries (`dev` not true), with exact versions, declared
license metadata and lockfile paths. The builder cross-checks the inventory
against the included Bento package manifest and lockfile and verifies that those
direct roots agree. This is a traceable dependency inventory, not a claim that
every production-scoped entry contributes bytes to the shell or a complete legal
audit. The unchanged shell also embeds Bento's original third-party attribution
text.

The two embedded font assets are identified by their names in Bento's pinned
font source, Latin subset, WOFF2 byte count and SHA256. Their exact upstream
release identifiers are absent from that source and remain explicitly unknown.
The full official Fraunces and Instrument Sans SIL Open Font License 1.1 texts
are included under `runtime/vendor/bento/font-licenses/`. The authored
`runtime/vendor/bento/FONT_NOTICES.md` records that Bento's unchanged notice
says Fraunces copyright 2020 while the official OFL header says 2018; it
preserves both attributions and leaves Bento's supplied notice and shell
unchanged. The Instrument Sans attribution is Copyright 2022 in both places.
These records cover the two named fonts; they do not establish a complete legal
review of Bento's other components or decide Quarto-Bento's own licensing.
Remaining unknown font releases and the broader notice review are explicit in
the inventory.

At the pinned revision, `slides/package.json` declares version `1.2.6`, but the
root entry (`packages[""]`) in the original `slides/package-lock.json` declares
`1.1.0`. The exact upstream files are preserved and independently hash-pinned;
the builder checks each recorded version against its own source file and checks
that the direct dependency roots match. The lockfile was not rewritten to hide
the upstream metadata difference.

The source checkout currently has no root LICENSE declaring terms for
Quarto-Bento's own code. This artifact does not assign those terms and must not
be presented as a publicly licensed release without resolving that project
decision.

## Authored portability CI and local smoke

In the source checkout,
[`.github/workflows/portable.yml`](../.github/workflows/portable.yml) defines an
independent matrix on `ubuntu-24.04`, `macos-15-intel` and `windows-2022`, using
[GitHub's documented runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It runs on pull requests, pushes to `main` and manual dispatch. Each job checks
core and portable-tool types, runtime/tool formatting and lint, the existing
portable inventory/refusal test, bounded Windows smoke argument tests, and a
real authored QMD smoke. It does not run the broader computation/R suite,
install R or TinyTeX, publish a release, or upload a package.

CI preparation explicitly installs **Deno 2.9.6** and **Quarto 1.10.19** in the
runner. This is CI setup; `qbento`, its launchers and the local smoke continue
to use dependencies already supplied by the user. The smoke checks the actual
versions returned by `doctor`; an incorrect installation fails instead of
silently widening the test baseline. Actions are pinned to release commits
verified from their primary release pages:

| Action                            | Release                                                              | Immutable commit                           |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `actions/checkout`                | [v4.2.2](https://github.com/actions/checkout/releases/tag/v4.2.2)    | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `denoland/setup-deno`             | [v2.0.5](https://github.com/denoland/setup-deno/releases/tag/v2.0.5) | `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` |
| `quarto-dev/quarto-actions/setup` | [v2.1.9](https://github.com/quarto-dev/quarto-actions/releases)      | `9e48da27e184aa238fcb49f5db75469626d43adb` |

The setup inputs are described by
[Deno's action](https://github.com/denoland/setup-deno) and
[Quarto's pinned setup action](https://raw.githubusercontent.com/quarto-dev/quarto-actions/9e48da27e184aa238fcb49f5db75469626d43adb/setup/action.yml).
On Windows that action delegates to its PowerShell installation script using
Scoop and forwards the requested Quarto version. Scoop is temporary CI-runner
preparation, outside the portable payload and ordinary user workflow; `doctor`
checks the installed version before the smoke proceeds. The ephemeral runner
disables Git automatic line-ending conversion before checkout so the pinned
shell bytes and inventory remain exact on Windows; see
[Git's line-ending settings](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreautocrlf).
Checkout credentials are not persisted and the workflow token has only
`contents: read`. The install phase needs network access; the authored fixture
uses no remote inputs, remote/npm Deno imports, or computation packages. A fresh
cache and `QUARTO_RUN_NO_NETWORK=true` constrain the ordinary test path; these
checks are not an OS-wide network isolation proof.

Run the same smoke locally, from a source checkout with those installed
versions:

```sh
deno run --no-config --no-remote --no-npm --allow-read --allow-write --allow-run --allow-env scripts/portable-check.ts
```

The script only creates and cleans its own temporary directory. It builds the
existing package, relocates it into a path with spaces, invokes the actual Unix
or Windows launcher, and checks `doctor`, `render`, `validate`, failed-command
exit status, `get`, `patch`, and `init`. Its explicit-ID authored fixture uses
CRLF and Unicode, without executable chunks. A caller `deno.json` pointing a
built-in import at a hostile URL must not affect the launchers. Save retains a
visual override and an authored pending edit while QMD bytes remain unchanged.

For a clean rebuild, the smoke copies only the QMD and
`.qbento/{project.json,state.json}` into another directory with spaces and
removes the original project, including generated HTML, execution caches and
history. Fresh rendering must preserve `docId`, geometry, font size, pending
identity/content/status and the original QMD bytes. This minimal state inventory
is sufficient for this text-only fixture; real projects still need their input
assets and any versioned registry/widget state. It is not a general migration or
Git packaging command.

After `init`, the installed project moves again and the portable distribution is
deleted. Linux removes the generated HTML and proves that ordinary
`quarto render` rebuilds through the self-contained installed extension while
retaining the saved design and pending edit. On macOS/Windows the current
ordinary-invocation guard intentionally refuses with
`QUARTO_EXTENSION_PLATFORM`; the smoke requires that diagnostic and verifies
unchanged QMD, saved state and existing HTML. The portable CLI smoke remains a
positive test on all matrix platforms. Windows batch invocation uses explicit
`cmd.exe /d /s /v:off /c` with bounded quoted tokens; its utility tests check
construction/refusal, not native Windows behavior. See
[Microsoft's cmd documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)
and [Deno command options](https://docs.deno.com/api/deno/subprocess/).

**Local evidence (2026-10-11):** Linux x86_64 with Deno 2.9.6 and Quarto 1.10.19
passed the complete smoke, including clean state-only reconstruction and
ordinary Quarto after both project relocation and portable-runtime removal. The
existing two packaging tests passed in Linux; the two new bounded batch utility
tests and type/lint/format/shell syntax checks passed. No hosted Action was
dispatched, and macOS/Windows have not been executed in this session. The
committed matrix prepares those native validation runs; its existence does not
establish native support. These are CLI, source-byte and document/state
assertions, without browser visual evidence, PDF/widget coverage or a v1 release
claim. Ordinary integration on macOS/Windows remains deliberately unsupported
until its process/output preflight is implemented and validated there.

The coordinator repeated the complete Linux smoke on runtime
`75edcdf0dc2b04d09d6314c0630f694693c55f8e`, including source graph scope,
retained KPI appearance, explicit Studio components and Chromium startup
readiness. The portable inventory contained **91 payload files**; all launcher,
retained-pending-edit, state-only rebuild and relocated ordinary-Quarto
assertions passed with process exit **0** in 6.92 seconds. The local raw receipt
is `output/verification/75edcdf/portable.log`. The prior 69-file receipt at
`c225546` remains historical evidence. These checks extend the Linux receipt
without changing the other-platform qualification boundary.

## Previous ordinary-authoring Linux artifact

The `85da037` development artifact contains 108 verified files and records the
exact clean source revision. Its real launcher rebuilt the native table and
image-caption fixtures from source/assets/state only, retaining exact emitted
documents, docIds and zero pending changes; the table executed R once. The
portable smoke also passed relocation and ordinary Quarto with pending edits.
See [its receipt](evidence/ORDINARY-INTEGRATED-LINUX.md). The usable
directory is `output/verification/portable-85da037/distribution/`; the sibling
README documents local launch commands. Older artifact receipts remain historical.

## Current combined Linux artifact

The clean `f06def7` development artifact contains **113 verified payload files**;
every payload byte also matches the later test-only revision `b5b6bbe`. The real
launcher passed relocation, retained pending edits and ordinary Quarto. It
rebuilt the reusable-layout example and the combined native redesign/code-language
fixture from source/assets/state only, preserving exact emitted documents,
docIds, typography and zero pending changes. See
[the combined redesign receipt](evidence/REDESIGN-INTEGRATED-LINUX.md).
The usable directory is `output/verification/portable-f06def7/distribution/`;
its sibling README and receipt contain commands, input inventories and hashes.
