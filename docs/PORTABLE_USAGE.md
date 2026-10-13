# Using the portable development directory

This directory is a local development build, not a public v1 release or an
installer. Keep the complete directory together when moving it. It requires
installed Deno 2, Quarto and the language packages used by your QMD. It does not
install or manage computation environments. Only run trusted QMD and code.

From your project directory, use the launcher's absolute path (quote spaces):

```sh
'/path/to/qbento development/bin/qbento' doctor
'/path/to/qbento development/bin/qbento' render 'presentation.qmd'
'/path/to/qbento development/bin/qbento' edit 'presentation.qmd'
```

On Windows, the corresponding launcher is `bin\qbento.cmd`. Its presence does
not establish native Windows validation. This build has local Linux evidence;
macOS/Windows execution and hosted CI remain deferred. Preserve the Unix
executable bit when archiving, or invoke `bin/qbento` with `sh`.

`edit` prints a local Studio URL. **Guardar proyecto** saves design and pending
content to `.qbento/`, leaving QMD unchanged. Review the proposed source changes
before applying sync; **Recalcular** executes QMD and combines its results with
saved design. Save, sync and render are separate operations. Capture edits made
to a standalone HTML copy with `capture presentation.qmd edited-copy.html`
before rendering; capture requires a matching project publication receipt.

For reconstruction, keep QMD, input data/assets and versioned `.qbento/`
project/state files, plus any design registry or widget resources your project
uses. The generated HTML is rebuildable. Computation dependencies remain your
responsibility; cross-platform pixel identity is not promised.

`init presentation.qmd` installs the self-contained Quarto extension into the
project without replacing existing configuration. Ordinary `quarto render`
integration is currently validated only on Linux. The installed extension is
independent of this portable directory after successful initialization.

The root `manifest.json` records the source revision and each payload's path,
size, hash and executable flag. It is an integrity inventory, not a signature.
The runtime includes Bento's pinned license/notices, font license texts and
dependency provenance under `runtime/vendor/bento/`. These do not assign a
license to Quarto-Bento's own code. Its project licensing and public release
scope remain unresolved.

The full source checkout contains development, acceptance and CI documentation.
Those source-only files and verification artifacts are not part of this
portable directory.
