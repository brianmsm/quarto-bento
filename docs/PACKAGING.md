# Portable development directory

This package is a local development artifact, not a v1 release or a native
installer. It contains the current TypeScript runtime, Lua filters, offline
Quarto extension, pinned Bento shell/schema, upstream license and notices, Unix
and Windows command launchers, and a sorted SHA256 inventory. It requires
installed Deno 2, Quarto (tested with 1.10.19), and the language/packages used
by the user's QMD. It does not install or manage these dependencies.

From a source checkout, create a **new** directory whose parent already exists:

```sh
deno run --no-config --allow-read --allow-write scripts/package.ts '/tmp/qbento development'
```

The builder refuses an existing destination, an input symlink, an unexpected
runtime file, or a Bento shell inconsistent with `vendor/bento/pin.json`. It
copies an explicit runtime inventory; it does not copy `.git`, worktrees, user
configuration, fixtures, caches, `node_modules`, or generated presentations. No
timestamps or absolute source paths are written to `manifest.json`. Identical
input bytes produce identical package files and inventory; this is not a claim
of reproducible compilation of Bento upstream.

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
There are no remote Deno imports or npm dependencies in the packaged runtime.
Ordinary workflow remains offline with compatible installed computation packages
and local input assets.

`init` copies the self-contained extension into the user's project and refuses
to replace existing Quarto configuration or an installed extension. Its ordinary
`quarto render` preflight is currently verified only on Linux; macOS and Windows
remain pending native validation. Having a Windows launcher does not establish
Windows runtime support. Linux relocation tests exercise `doctor`, `render`,
`validate`, `init`, and ordinary `quarto render` with a fresh Deno cache and
access to the source checkout denied for the packaged CLI. With Quarto 1.10.19,
ordinary extension hooks fail in project-directory paths containing spaces; use
`qbento render` there. Ordinary integration is tested after relocating the
installed project into a directory without spaces (the QMD filename retains
spaces), then removing the portable runtime.

`manifest.json` lists each payload file's relative path, byte count, SHA256 and
executable flag. The manifest itself is excluded to avoid a recursive self-hash.
It detects differences when independently checked against a trusted inventory;
it is not a signed authenticity guarantee. Concurrent changes to the source
checkout during packaging are unsupported; build from a reviewed, stable tree.

The Bento shell is pinned to the revision recorded in the inventory. Retain
`runtime/vendor/bento/LICENSE` and `THIRD_PARTY_NOTICES.md`; the shell also
embeds upstream notices. The source checkout currently has no root LICENSE
declaring terms for Quarto-Bento's own code. This artifact does not assign those
terms and must not be presented as a publicly licensed release without resolving
that project decision. Bundled font and third-party notice completeness remains
part of release review.
