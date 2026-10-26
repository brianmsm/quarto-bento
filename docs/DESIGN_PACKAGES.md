# Reuse a course design across presentations

A design package is local JSON containing a named design registry. It lets a
course keep one reusable design file, for example
`themes/spp-bifactor.design.json`, and explicitly copy its definitions into each
session. Import uses the file's values; there is no external inheritance, remote
dependency, or automatic update. Version the shared package and each
presentation's `.qbento/design.json` with Git.

Without an active registry theme, Quarto-Bento uses its native neutral defaults:
white background (`#ffffff`), dark text (`#172a35`), teal accent (`#156f65`) and
`Arial, sans-serif`. A QMD's Reveal `theme:` value does not select a Bento
design. Choose and import a native package explicitly when a course identity is
required. Each presentation retains its own saved native overrides.

This is a native Quarto-Bento design workflow. Reveal.js themes, SCSS, CSS,
Metropolis, and `_brand.yml` are not automatically converted. A design adapted
from another format can be registered once and reused in later sessions. Inspect
that adaptation visually before distributing the package.

## Package contents

```json
{
  "format": "qbento/design",
  "version": 1,
  "name": "SPP · Bifactor",
  "registry": {
    "schemaVersion": 1,
    "themes": {
      "spp": {
        "background": "#ffffff",
        "color": "#172a35",
        "accent": "#aa3377",
        "fontFamily": "Arial, sans-serif"
      }
    },
    "activeTheme": "spp",
    "layouts": {
      "three-cards": { "columns": 3, "gap": 20, "padding": 10 }
    }
  }
}
```

The package contains the supported registry definitions, including named
layouts, themes and their validated style definitions. See
[the registry contract](DESIGN_REGISTRY.md) for the supported grammar.
Unsupported fields refuse; JSON data never runs code or installs fonts or
environments. Font families still require locally available fonts or the
existing bundled fonts. Arbitrary external assets are not packaged.

Export reads the current saved design registry, including a theme just saved or
imported before recalculation. It combines that theme's background, text color,
accent and font family with actual saved document-wide native theme overrides.
An older rendered default never overwrites a newer registry value. This includes
changes saved through Bento's native theme controls. Without a named theme,
export creates `exported`. Registered component styles and layout definitions
are retained.

Export does not infer a style from the first slide, a selected object or an
arbitrary collection of native edits. It never includes slide or object IDs,
slide content, object geometry, provenance, computed output, pending edits or
project state. A course design can therefore travel between sessions without
transferring session content or its editing identity.

## Start a new presentation with a shared design

A new QMD can already use the package's `bento-style` and `bento-variant`
selectors. Install the design before rendering that source for the first time,
using `initializeDesignPackage(source, package)` from
`src/core/design-initialize.ts`. Initialization validates the original source
selectors against the package and exclusively creates a new `.qbento/` directory
with its `design.json`. It returns the source and registry hashes and
`renderNeeded: true`. The next explicit render establishes the presentation's
own identity and project baseline using that design.

Initialization never adopts or replaces an existing `.qbento` path, including an
empty directory, a symbolic link or recovery files. Existing generated Bento
HTML and pending publication outputs in the source directory also refuse,
including a sibling presentation's output. Each presentation should have its own
directory. Use checked import below for an existing saved project.

Initialization records the selected QMD association in `project.json`. QMD,
saved deck state, document identity and generated HTML are not written during
initialization. An exclusive directory creation and atomic no-clobber
publication protect concurrent initializers and preserve concurrent files. The
source hash is checked before publication and completion.

An interrupted initialization retains a `design-save.json` recovery marker and
any `.design-initialize-…` candidate. Registry loading and rendering refuse
while that marker exists, rather than proceeding with a missing design. Preserve
these artifacts and inspect the recorded source hash, candidate path and
`afterHash`. Restore or finish the verified registry before deliberately
removing the owned staging file and marker. To abandon an initialization,
archive the newly created directory for inspection before explicitly starting
again; never discard an existing project's state or recovery files.

## Checked import

Render each destination presentation once to establish its own source binding,
document identity and baseline. Preview then shows the complete before and after
registries, the theme and layout names that will be removed, and that a render
is needed. Import replaces the entire destination registry. It does not silently
merge same-named definitions. Review removed names against any QMD references;
an undefined reference requires an explicit source/design correction. For
supported layouts with identified direct div children, the selected layout's
column count must also match those children. An incompatible replacement refuses
before initialization/import or Quarto execution; nested content and source
comments do not add columns.

Applying rechecks the destination document identity, saved revision, current QMD
hash, exact registry bytes and complete plan. Changed source, native saves,
registry changes, or a changed package require a fresh preview. Registry saving
uses the existing recoverable transaction and keeps before/after files and a
receipt in `.qbento/history/design-…/`.

Import saves only `.qbento/design.json` and that transaction history. Source,
generated HTML, state, pending semantic edits and saved visual overrides remain
untouched. Recalculate explicitly after applying to see the new defaults.
Existing source-owned styles and retained native overrides continue to take
precedence. Importing another design is not an operation to reset those
overrides.

Update a course package by exporting a newly reviewed design, then preview and
apply that new version in each intended session. Already imported sessions do
not change automatically.

## Core operations for integrations

The UI and CLI can use the same JSON core in `src/core/design-package.ts`:

- `validateDesignPackage(value)` validates and returns independent JSON data.
- `readDesignJsonFile(path, maximum?)` reads bounded local JSON for
  integrations.
- `readDesignPackageFile(path)` reads and validates a bounded local package
  file.
- `exportDesignPackage(source, name)` produces a package without writing it.
- `previewDesignImport(source, package)` produces a deterministic read-only
  plan.
- `applyDesignImport(source, plan)` validates the preview and saves its
  registry.
- `readDesignImportPlanFile(path)` reads a bounded saved plan; application still
  rebuilds and checks its fields against the current project.

Packages are limited to 256 KiB, including the envelope, and names to 120
characters without control characters. Saved plans have a bounded size for their
package and before/after registry snapshots. Readers refuse malformed
UTF-8/JSON, unsupported schemas, nonregular files, symbolic links and hard
links. CLI design results (including exported packages and saved import plans)
and Studio package downloads use compact JSON with a final newline. The size
check includes that newline; indentation must not make an otherwise valid export
exceed its reader's byte limit. Review views still format the parsed JSON for
inspection. Initialization and registry saves retain indented JSON when it fits,
and otherwise store compact JSON within the same 256 KiB limit. Formatting
therefore cannot prevent an accepted package from being stored. Registries whose
compact JSON exceeds the limit still refuse before writing project files.

These operations need no Quarto execution or cloud connection. Their import
receipt reports `renderNeeded: true`; execution remains a separate explicit
operation using the destination's compatible computation environment.
