# Reuse a design in Studio

Quarto-Bento Studio can export a project's reusable layouts and themes as a
portable design package, then preview and apply that package to another project.
A package contains design data only. It does not include QMD, generated slides,
`.qbento/state.json`, pending edits, input files, fonts or executable code.

## Export a design

Open **Diseños y temas** and use the design package controls to enter a name and
choose **Descargar diseño**. Studio saves pending native editor changes before
requesting the package. It downloads a UTF-8 JSON file with the package name;
export does not change the project registry or recalculate the deck.

Export is refused while the registry form contains an unsaved draft. Save the
draft with **Guardar diseños**, or explicitly discard and reload it before
exporting. This avoids silently dropping form edits or exporting a registry
state that differs from the open editor.

The version 1 package shape is:

```json
{
  "format": "qbento/design",
  "version": 1,
  "name": "SPP Bifactor",
  "registry": {
    "schemaVersion": 1,
    "layouts": {
      "triad": { "columns": 3, "gap": 24, "padding": 8 }
    },
    "themes": {
      "spp": {
        "background": "#ffffff",
        "color": "#172a35",
        "accent": "#156f65",
        "fontFamily": "Arial, sans-serif"
      }
    },
    "activeTheme": "spp"
  }
}
```

The package preserves advanced theme properties supported by the registry,
including `styles`, `namedStyles`, `variants` and `defaultVariant`. Fonts are
referenced by family name; the package does not install or fetch font files.

## Import and apply

Choose a local `.json` package, then request **Vista previa**. Studio first
saves pending native changes and binds the preview to the current project ID,
revision and registry hash. The preview shows the complete current and proposed
registries, each removed layout or theme with its current definition, and
whether recalculation is needed.

**Aplicar diseño** is a separate, explicit action. It replaces the project's
whole `.qbento/design.json` registry, after checking that the preview still
matches the project and package. The operation does not change QMD, saved native
state, pending semantic edits or generated HTML. Studio reloads the registry
editor after a successful apply. Press **Recalcular** to apply the selected
registry defaults to the presentation while preserving saved overrides and
pending edits.

The replacement can remove layouts or themes that existed only in the target
project. Review the removal list before applying; change QMD references to a
renamed or removed layout separately if necessary. A stale preview must be
regenerated after any project save. Unsupported package versions or invalid
registry values are rejected, and an invalid file never enables Apply.

If the registry editor has an unsaved draft, package export, preview and apply
are refused. Save or explicitly discard that draft first. A draft typed while a
request is in progress remains in the form; Studio does not reset it to make an
import appear successful.

## Adapting another slide theme

Reveal.js themes and CSS are not Bento design packages. Their CSS selects and
styles Reveal's HTML structure, while Bento uses native objects, layouts and
theme data. Importing the CSS unchanged does not reproduce it in Bento. Convert
the parts that matter into supported Quarto-Bento theme properties and layouts,
preview the result on representative slides, and export the accepted package
once. Later sessions can select that package without repeating the conversion.
