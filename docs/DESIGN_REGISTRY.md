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
displayed code, images and decorative shapes. Native tables/charts, embeds,
media and raw SVG objects still refuse component composition until their
internal metrics are adapted. Content exceeding a frame refuses instead of
shrinking to unreadable text. This registry is separate from Bento's native
reusable slide templates.

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
not rewrite the named registry. Editing this JSON locally is the registry
editing interface. No native registry picker/editor is claimed.

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
