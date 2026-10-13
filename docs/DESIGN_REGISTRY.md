# Local design registry

The implemented registry is optional JSON data at `.qbento/design.json`, next to
`.qbento/state.json`. It supplies reusable layout definitions and a selected
basic theme. It does not execute code, select remote files or manage
environments. The ordinary `qbento render deck.qmd` and installed `qbento-html`
Quarto workflow both load and validate it before computation.

```json
{
  "schemaVersion": 1,
  "layouts": {
    "three": { "columns": 3, "gap": 20, "padding": 10 }
  },
  "themes": {
    "forest": {
      "background": "#e8fff0",
      "color": "#123a24",
      "accent": "#26734a",
      "fontFamily": "Arial, sans-serif"
    }
  },
  "activeTheme": "forest"
}
```

Select a layout in QMD with an identified component and identified children:

```text
## Results {#results}

:::: {#summary .bento-layout bento-layout-name="three"}

::: {#first .bento-card}
### First
A finding.
:::

::: {#second .bento-card}
### Second
Another finding.
:::

::: {#third .bento-card}
### Third
A final finding.
:::

::::
```

Names use lowercase letters, digits and hyphens, start with a letter and have at
most 64 characters. There may be at most 64 layouts and 32 themes. Columns are
an integer from 1 to 6; gap and padding are finite pixels from 0 to 1000. The
exact number of children must match the columns. `two-column` remains a built-in
name and cannot be redefined. Supported placement covers measured text,
displayed code, images and decorative shapes. Plain native tables and bounded
bar/line charts also compose using their verified internal metrics; see the
[table](evidence/COMPOSED-TABLES.md) and [chart](evidence/COMPOSED-CHARTS.md)
receipts. Embeds, media and raw SVG objects still refuse component composition
until their internal metrics are adapted. Content exceeding a frame refuses
instead of shrinking to unreadable text. This registry is separate from Bento's
native reusable slide templates.

Studio also applies these definitions to existing free content through **Aplicar
diseño**. Its managed Bento **Apply layout** button opens the same selector.
Pick a saved slide and a layout, then assign each intended object to a column;
an object starts at **Conservar posición**, never in an inferred slot. Titles
stay outside the content frame. Selected objects retain IDs, content,
provenance, order, grouping and typography. Each column stacks its explicit
members in the current native order, allocating equal-height slots; a simple
table uses only the height required by its rows. Images and their captions are
separate explicit choices. The preview lists the resulting frames before
applying them.

Applying is a snapshot of the current definition: it saves geometry as ordinary
visual overrides and preserves prior pending edits. Redefining the registry
later requires applying it again to free objects; source components with
`bento-layout-name` continue using regenerated layout defaults. Explicit QMD
geometry remains source-owned and becomes pending. A coupled parent frame still
cannot be reverse-mapped from a child's movement; review refuses
`UNMAPPED_DESIGN` while retaining that movement. No placeholder text, cloned
source objects or new semantic membership are created.

The action supports ordinary text, displayed code, images, simple native tables
and bounded bar/line charts. Table cells must retain the adapter's plain-text
metrics; charts must retain the bounded native option grammar. Rotation or theme
references deriving their frame/metrics need explicit resolution first. Tables
and charts validate actual internal metrics at the final selected size, rather
than scaling their boxes alone. Subsequent table/chart content that exceeds a
saved frame emits `NATIVE_CONTENT_OVERFLOW` after recomputation; unsupported
custom metrics emit `NATIVE_CONTENT_UNMEASURED`. Neither warning changes saved
geometry. Text/code content overflow is handled by the separate native content
measurement layer, not by the layout placement calculation.

The selector saves live native edits before reading its choices. It checks the
saved document ID, revision, current projected source hash and exact registry
bytes during preview and application. Externally changed QMD must be recomputed
before its old objects can be assigned: weak source identities may contain byte
offsets, including a title's identity. Duplicate, foreign, missing or title IDs,
a changed registry, and uncaptured HTML edits refuse without replacing source,
output or saved state. See the
[reusable layout receipt](evidence/REUSABLE-LAYOUTS.md) and
[plain deck example](../examples/reusable-layouts/README.md).

The theme subset accepts only `background`, `color`, `accent` and `fontFamily`,
using the same bounded value validation as QMD design attributes. Other fields
and unknown schema versions refuse. When themes are declared, choose
`activeTheme` explicitly; JSON key order never selects a theme. The fixed file
is limited to 256 KiB and must be a regular file, without symbolic/hard links.
Changing, adding or removing it during a checked render aborts publication with
`DESIGN_REGISTRY_CHANGED`, including changes made by an executed producer.

Registry values are regenerated defaults. Explicit QMD design attributes own
those fields; native edits to them remain recoverable pending changes requiring
an explicit source operation. Other native visual fields are sparse overrides in
`.qbento/state.json`. Changing a selected registry theme updates unoverridden
fields. Saving a native Theme palette edit preserves that edit in state; it does
not rewrite the named registry. Studio's **Diseños y temas** form edits named
layouts, named themes and the explicit active theme. **Guardar diseños** saves
the registry alone; **Recalcular** applies it to the deck while retaining saved
overrides and pending semantics. The form does not rewrite QMD layout references
when a name changes. Direct JSON editing remains supported.

Studio checks the loaded registry bytes, project identity and revision before
saving. If another editor changes them, the draft remains available and the save
refuses; **Descartar borrador y recargar registro** explicitly replaces the
draft. Interrupted publication can leave a durable `design-save.json` marker:
reads and renders then refuse until the documented manual recovery preserves the
competing versions. The generic `qbento recover` command does not handle this
separate journal. See
[Studio registry evidence and recovery](evidence/STUDIO-REGISTRY.md).

Native palette and code-palette fields also survive recomputation. Literal
colors without `themeRefs` stay independent: changing the native document accent
alone does not automatically recolor all existing literals. Native palette
references on objects without explicit QMD design attributes may derive their
visual colors using the pinned Bento resolver. As a conservative ownership
boundary, the entire `themeRefs` map on an object with **any** explicit QMD
design attribute is source-owned. New or changed references are saved pending;
recompute refuses `UNMAPPED_DESIGN` until the reference is removed or resolved
explicitly. There is no guessed inverse QMD patch for that map. References
cannot derive semantic content, identity or resource paths on slides, elements
or native layout templates; Save/capture/recompute reject
`UNSUPPORTED_THEME_REFERENCE`.

Keep QMD, local input/assets, `.qbento/design.json` and `.qbento/state.json` in
a rebuildable project. A tested relocation rebuilt without generated HTML or
build files while retaining `docId`, native overrides and the emitted document.
Fonts still use the platform's locally installed fonts and fallbacks; the
registry does not install or fetch fonts. Native motion fields remain visual
state. See the
[executed and native acceptance evidence](evidence/DESIGN_REGISTRY.md) for the
specific palette, reveal, fade/count-up and morph behaviors actually validated.
