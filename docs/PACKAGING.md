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

Managed standalone HTML also carries an inert, readable JSON notice block in the
document head with the full Quarto-Bento MIT text labeled separately from the
supplied Bento MIT text, upstream notices, font provenance note and both OFL texts.
Studio and the isolated deck Presenter use
the same shell loader. Native Bento's pristine-shell serialization retains this
block in saved copies; the texts remain outside BentoDoc and do not affect slide
content. The vendored shell and its original NOTICE remain unchanged. This
preserves the project's declared license and supplied third-party notices without
claiming a complete third-party audit.

At the pinned revision, `slides/package.json` declares version `1.2.6`, but the
root entry (`packages[""]`) in the original `slides/package-lock.json` declares
`1.1.0`. The exact upstream files are preserved and independently hash-pinned;
the builder checks each recorded version against its own source file and checks
that the direct dependency roots match. The lockfile was not rewritten to hide
the upstream metadata difference.

The owner selected MIT for Quarto-Bento's own code and documentation on
2026-10-13, with copyright (c) 2026 Brian Norman Peña Calero. The full text is in
the [root LICENSE](../LICENSE), packaged at both `LICENSE` and `runtime/LICENSE`
and copied to an initialized extension's `runtime/LICENSE`. The shared shell
loader reads that runtime-relative resource lazily, records its SHA-256 and
includes its complete text as `Quarto-Bento/LICENSE` with a separate component
label. Bento's original license and pinned third-party files retain their terms.
This settled owner decision does not close the third-party review or public
release acceptance scope.

## Manual Linux CI and local smoke

[`.github/workflows/portable.yml`](../.github/workflows/portable.yml) defines a
manually dispatched authored-workflow smoke on `ubuntu-24.04`. It has no push or
pull-request trigger. The original three-platform matrix is retained in Git
history; the current workflow follows the owner's completed Linux-only scope.
macOS/Windows qualification is future work. No hosted run is claimed by this
configuration, and public source publication does not start one automatically.

The workflow installs Deno 2.9.6 and Quarto 1.10.19 on its temporary runner,
checks core/portable types, targeted runtime/tool formatting and lint, validates
the inventory and bounded launcher arguments, and runs the portable smoke.
It does not install R/TinyTeX, run the full computation/browser suite, publish
binaries or upload a package. Runtime use continues to rely on user-installed
dependencies. The workflow token has only `contents: read`, checkout credentials
are not persisted, and Git line-ending conversion is disabled to preserve
pinned payload bytes.

Actions remain pinned to their reviewed release commits:

| Action | Release | Immutable commit |
| --- | --- | --- |
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `denoland/setup-deno` | v2.0.5 | `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` |
| `quarto-dev/quarto-actions/setup` | v2.1.9 | `9e48da27e184aa238fcb49f5db75469626d43adb` |

Runner setup needs network access. The authored fixture uses local inputs and
no remote/npm Deno modules or computation packages. A fresh Deno cache and
`QUARTO_RUN_NO_NETWORK=true` constrain the ordinary smoke path; these are not an
OS-wide network isolation proof. See [publication scope](PUBLICATION.md).

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
unchanged QMD, saved state and existing HTML. The portable CLI smoke has authored paths for future platforms; the current
workflow and execution evidence cover Linux only. Windows batch invocation uses explicit
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
historical matrix prepared those native validation runs; its existence did not
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
See [its receipt](evidence/ORDINARY-INTEGRATED-LINUX.md). The usable directory
is `output/verification/portable-85da037/distribution/`; the sibling README
documents local launch commands. Older artifact receipts remain historical.

## Combined redesign Linux artifact

The clean `f06def7` development artifact contains **113 verified payload
files**; every payload byte also matches the later test-only revision `b5b6bbe`.
The real launcher passed relocation, retained pending edits and ordinary Quarto.
It rebuilt the reusable-layout example and the combined native
redesign/code-language fixture from source/assets/state only, preserving exact
emitted documents, docIds, typography and zero pending changes. See
[the combined redesign receipt](evidence/REDESIGN-INTEGRATED-LINUX.md). The
usable directory is `output/verification/portable-f06def7/distribution/`; its
sibling README and receipt contain commands, input inventories and hashes.

## Production archive notice supplement

The runtime also carries `vendor/bento/runtime-licenses.json`, a hash-pinned
supplement extracted offline from the exact 25 production-scoped npm archives
in Bento's pinned lockfile. Every archive is checked against its SHA-512
integrity before reading members. The supplement retains exact license/notice
files (including two nested reveal.js font license files), README license fences
and distribution copyright/license comments, with source byte ranges and hashes.
It travels inside the inert notice block retained by native Bento save.
Archive membership does not prove that every listed component ships in the shell;
NOTICE files may also describe development components. Full package license
texts remain absent from four archives: `@cfcs/core`, `croact`,
`croact-css-styled`, and `keycon`. This is recorded explicitly and does not close
the complete third-party review. The project license is settled above. The
[source-revision follow-up](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md) records
registry-linked commits, unavailable sources and version discrepancies; it does
not replace the archive facts or resolve the missing package texts.
To reproduce the extraction
without installing or downloading packages, run
`python3 scripts/extract-runtime-licenses.py --check --cache /path/to/npm-cache`;
the default operation is read-only, and `--write` explicitly replaces the
supplement. This script is checkout verification tooling, not a runtime command.

The earlier clean `7f68207` portable contains 114 verified payload files and includes the
shared notice-preserving shell loader. Its root `PACKAGING.md` is a standalone
usage guide, without links to missing checkout files. The artifact is at
`output/verification/portable-7f68207/distribution/`. Native serialization,
focused regressions and portable smoke are recorded in
[the distribution notice receipt](evidence/DISTRIBUTION-NOTICES.md).

The clean `3a19e7f` artifact adds the archive supplement and contains
115 verified files. It is at `output/verification/portable-3a19e7f/distribution/`.
The same receipt records exact-text review, native serialization/reopening,
package refusals and the updated local portable smoke.

The historical clean `74e552b` artifact includes the owner-selected MIT license in
both the package root and runtime and contains 117 verified files. It is at
`output/verification/portable-74e552b/distribution/`. The
[MIT carriage receipt](evidence/DISTRIBUTION-NOTICES.md#owner-selected-mit-license)
records native preservation, installation, relocation and exact license bytes.

## Latest Linux security baseline

Runtime `2ee7974` passed the full local Linux suite: 578 tests and four steps,
zero failures. Its clean portable directory has 117 independently verified
payload files and a source manifest with `dirty: false`; the local artifact is
`output/verification/portable-2ee7974/`. The portable smoke also passed CLI and
ordinary Quarto state-only reconstruction. These ignored local artifacts are
not attached to the public source repository. See the
[security and dependency receipt](evidence/SECURITY-LINUX.md) for scope, log hashes
and unresolved upstream build/license-source findings.
