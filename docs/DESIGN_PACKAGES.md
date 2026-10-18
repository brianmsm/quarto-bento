# Reuse a course design across presentations

A design package is local JSON containing a named design registry. It lets a
course keep one reusable design file, for example
`themes/spp-bifactor.design.json`, and explicitly copy its definitions into each
session. Import uses the file's values; there is no external inheritance, remote
dependency, or automatic update. Version the shared package and each
presentation's `.qbento/design.json` with Git.

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

## Checked import

Render each destination presentation once to establish its own source binding,
document identity and baseline. Preview then shows the complete before and after
registries, the theme and layout names that will be removed, and that a render
is needed. Import replaces the entire destination registry. It does not silently
merge same-named definitions. Review removed names against any QMD references;
an undefined reference requires an explicit source/design correction.

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
links.

These operations need no Quarto execution or cloud connection. Their import
receipt reports `renderNeeded: true`; execution remains a separate explicit
operation using the destination's compatible computation environment.
