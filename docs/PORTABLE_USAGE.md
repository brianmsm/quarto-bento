# Using the portable development directory

This guide describes the 0.2.0 portable development directory, not a public
portable binary release, stable v1 release or installer. Keep the complete
directory together when moving it. It requires
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
macOS/Windows execution remains future work. The public source repository has a
manual Linux smoke workflow; no hosted result is inferred from its presence.
Preserve the Unix executable bit when archiving, or invoke `bin/qbento` with
`sh`.

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

Version 0.2.0's
[execution layout](https://github.com/brianmsm/quarto-bento/blob/main/docs/EXECUTION_LAYOUT.md)
and [theme slots](https://github.com/brianmsm/quarto-bento/blob/main/docs/features/THEME_SLOTS.md)
describe bounded composition. Inline Plotly interaction retains a static
image/PDF fallback;
scroll viewports retain full native data and static continuations. Local
`widget-src` imports are inert bounded Plotly data, not arbitrary HTML execution.
Use the build's manifest and matching acceptance evidence to identify its scope.

`init presentation.qmd` installs the self-contained Quarto extension into the
project without replacing existing configuration. Ordinary `quarto render`
integration is currently validated only on Linux. The installed extension is
independent of this portable directory after successful initialization.

The root `manifest.json` records the source revision and each payload's path,
size, hash and executable flag. It is an integrity inventory, not a signature.
Quarto-Bento's own code and documentation use the MIT License, copyright (c)
2026 Brian Norman Peña Calero. The full terms are in the root `LICENSE` and
`runtime/LICENSE`; initialization also copies them into the installed
extension's `runtime/LICENSE`. Generated HTML retains the full project license
with a separate `Quarto-Bento` label. Bento's pinned licenses/notices, font
texts and dependency provenance remain under `runtime/vendor/bento/` with their
own terms. The complete third-party review and versioned v1 scope remain open.
The public source repository documents current Linux behavior and these
remaining provenance limits; public source availability does not declare a
stable release.

The full source checkout contains development, acceptance and CI documentation.
Those source-only files and verification artifacts are not part of this portable
directory. The separate
[npm CLI package version 0.2.0](https://www.npmjs.com/package/@brianmsm/quarto-bento/v/0.2.0)
wraps the matching portable runtime with a `qbento` launcher. Its version-specific
README provides installation commands and external Node, Deno and Quarto
requirements. Installing a new wrapper does not update other portable directories
or older CLI installations.
