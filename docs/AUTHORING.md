# QMD authoring and visual annotations

**Status:** this document describes the **intended Quarto-Bento contract**. Direct-object visual attributes on identified headings/single-object fenced divs now have integrated [projection and sync evidence](evidence/DESIGN.md). Identified cards, two-column layouts and displayed-code components now have [executed component evidence](evidence/COMPONENTS.md); the remaining vocabulary and annotation levels are incomplete. Standard Pandoc/Quarto fenced div syntax underlies the examples; component-specific semantics are ours.

## Three modes

1. **Plain QMD:** headings, Markdown and executable chunks. Studio assigns visual design without cluttering QMD.
2. **Declarative components:** QMD declares the *semantic role* of a visual object; Studio owns most styling.
3. **Advanced QMD:** explicitly declare geometry/styles/effects; Studio can subsequently change these with field-level pending sync.

### Example: layout, computed figure and text card

````markdown
## Resultados {#resultados}

:::: {#results-grid .bento-layout bento-layout-name="two-column"}

::: {#effects-figure .bento-card}

```{r}
#| label: fig-effects
#| echo: false
#| dev: svg

plot(c(0.18, 0.32, 0.47))
```

:::

::: {#indirect-effect .bento-card}

### Efecto indirecto

**β = .32**

IC 95% [.18, .47]

:::

::::
````

Here `β = .32` is a **literal**, not computed. For data-driven text, use a Quarto inline expression in the QMD instead:

```markdown
**β = `r round(beta_indirecto, 2)`**
```

With `beta_indirecto` computed upstream, changing the data updates the displayed value while retaining its visual design.

This example uses a computed SVG image inside a card. Native `.bento-chart`
instead consumes explicit simple table data and currently belongs outside
cards/layouts; see its implemented contract below.

### Component vocabulary (target API)

| QMD component | Intended role / likely Bento projection |
|---|---|
| `.bento-layout` | Named reusable arrangement for a group (`bento-layout-name="two-column"` etc.). |
| `.bento-card` | Styled group/card whose meaningful heading and body remain in QMD. |
| `.bento-kpi` | KPI/metric composition; literal or computed provenance must be retained. |
| `.bento-chart` | Native chart if faithful; SVG/static fallback otherwise. |
| `.bento-diagram` | Nodes/labels/connectors, composed from Bento elements when possible. |
| `.bento-timeline` | Sequence of annotated milestones and connecting shapes. |
| `.bento-code` | Displayed source-code component (distinct from a computed output). |

These are **Quarto-Bento abstractions**, not necessarily built-in Bento element types. The exact per-component schema, editable subset and conversion thresholds are implementation work.

### Implemented component subset

`.bento-card` is an identified fenced div containing supported authored headings,
paragraphs, displayed code, and source-mapped computed figures. It produces a
native decorative background and source-backed child objects. Internal headings
remain card content, including a nested H2; they do not create slides. Card text
edits use bounded source patches. Explicit background fill/stroke properties can
sync to the original card opener.

`.bento-layout` requires `bento-layout-name="two-column"` and exactly two identified
direct fenced-div children. Reuse this name across source components. It uses
native grouped objects with proportional geometry; a flat native `groupId`
represents the outer component, while source provenance retains the nested
containers. Custom layout/theme registries and nested native grouping are not
claimed here. **Use the namespaced attribute:** Quarto 1.10.19 already interprets
`layout=` as its JSON layout syntax. The former proposed `layout="two-column"`
spelling now refuses before computation in both CLI and installed Quarto hooks.

Attributes for a coupled parent frame produce source-owned child geometry.
Moving one child cannot establish a safe inverse update to that parent. Such
edits remain recoverable pending changes and refuse source sync with
`UNMAPPED_DESIGN`; the same applies to a parent style inherited by multiple
children. Attributes with one faithful target (such as card background fill or
one code wrapper's font size) use the existing bounded attribute sync. Declare
geometry on the containing component: explicit geometry on children that would
be overwritten by parent placement refuses. Proportional fitting also scales
pixel typography; an explicitly declared child font size/radius/stroke width
that a parent would rescale refuses rather than ignoring the declaration or
clipping content. Unspecified native geometry/styles
remain sidecar overrides and survive regeneration.

````markdown
::: {#shown .bento-code x="210" font-size="22"}

```{.python}
print("hello")
```

:::
````

This wrapper maps its code body's provenance to the original displayed fence.
A wrapper around an executable `{r}` chunk refuses, preserving the distinction
between displayed source and execution outputs. Unknown components, unsupported
content, conflicting ownership and layouts with the wrong child count refuse
explicitly. Component composition is closed to adapted native text, code,
image and decorative rectangle types. Tables/charts/embeds or raw native SVG
objects inside a component currently refuse `COMPONENT_CONTENT_LAYOUT_UNSUPPORTED`
until their internal metrics have a measured layout adapter; SVG figures
projected as images remain supported.

```markdown
## Resultados {#resultados}

::: {#finding .bento-card x="84" y="166" w="530" h="320"}
### Hallazgo principal
Texto de la tarjeta.
:::
```

Attributes declared explicitly in QMD carry source ownership: when Bento changes their values, Studio shows pending sync for those exact fields. Without explicit attributes, geometry and styling are stored in `.qbento/`. Changes must not silently overwrite either source.

## ID and grouping conventions

### Tables and native charts (implemented subset)

One plain pipe table in an identified div projects to a native table. Literal
cells retain their exact text; an identified wrapper around one labelled
`knitr::kable(..., format="pipe")` producer retains computed provenance.
Geometry and table-wide styles persist across data changes. Cell edits stay
recoverable as pending changes; reverse cell-to-QMD synchronization is not yet
implemented. Rich cells, captions, spans and unfaithful initial layout refuse.
See [table limits and native evidence](evidence/TABLES.md) and
`examples/native-tables/deck.qmd`.

For a native chart, declare its kind and give it a table with an empty category
header and named numeric series:

```markdown
::: {#effects .bento-chart bento-chart-kind="bar"}
| | Effect | Other |
| --- | ---: | ---: |
| Alpha | -2.5 | 1.25 |
| Beta | 0 | 3 |
:::
```

`bar` and straight `line` are supported in the bounded numeric/label subset in
[chart evidence](evidence/CHARTS.md). A labelled computed `kable` producer inside
the same wrapper is also supported; see `examples/native-charts/deck.qmd`.
Missing values, a meaningful category header that the pinned renderer cannot
display, excessive precision or ambiguous provenance refuse explicitly. Chart
options remain semantic: native option edits become pending changes or computed
conflicts; they cannot freeze old data as visual overrides. Reverse chart-data
sync remains unsupported. Tables and charts inside card/layout components still
refuse until their internal sizing is adapted.

### Displayed code (implemented subset)

An identified non-executable fenced block projects to Bento's native code object:

````markdown
```{#example .r font-size="24"}
modelo <- lm(y ~ x, data = datos)
summary(modelo)
```
````

Native content edits are saved as pending changes, reviewed and synchronized only
to that fence's body. The language class is retained on regeneration; changing
the native language selection currently remains pending and refuses reverse
conversion. A runnable Quarto chunk such as `{r}` is distinct: its echoed code
has computed provenance and cannot be synchronized as displayed authored code.
Source-owned compatible typography/geometry uses the same attribute-review flow
as text objects. The identified `.bento-code` wrapper around one displayed, non-executable fence is supported; see the component subset below.
See [executed and native evidence](evidence/DISPLAYED-CODE.md).

### Speaker notes (implemented subset)

Use one identified, top-level notes div under an identified slide:

```markdown
## Results {#results}

::: {#results-notes .notes}
Explain the result.

Pause for questions.
:::
```

The native notes field contains plain text. Save preserves pending changes;
review and sync replace only the notes body's bytes. Clearing the field retains
the empty identified div. Rich Markdown, executable inline expressions, multiple
notes blocks on the same slide and unbound notes refuse this round-trip. Create
the identified block in QMD first if none exists. The exact whitespace and
execution limits are documented in [notes evidence](evidence/NOTES.md).

### Stable identities

- Reuse explicit heading/block IDs and chunk labels when possible.
- Add stable `qb:*` source markers only when needed for round-trip; do not flood clean QMD with markers at initialization.
- Distinguish **semantic ID** (source content), **Bento element ID** (object on a particular slide), and **morph ID** (animation pairing across slides). A semantic figure may have multiple visual instances.
- A meaningful card/title/annotation created in Studio should map to a QMD fenced div or another faithful semantic construct **when synced**. Spatial proximity alone does not automatically imply semantic grouping.
- Purely decorative shapes/paths can remain entirely in `.qbento/`.

## Configurable QMD annotations

The implemented setting is a **top-level scalar in the original QMD frontmatter**:

```yaml
---
title: Resultados
qbento-annotations: minimal  # none | minimal | detailed
---
```

`minimal` is the default when this key is absent. Plain or quoted keys/values are
accepted. The setting is read from original YAML with Quarto's Pandoc metadata
reader; source bodies, chunks, execution metadata and project hooks are not run
by this configuration check. Duplicate declarations, unsupported levels,
malformed YAML and non-scalar/indirect declarations refuse with an actionable
configuration diagnostic. Nested `format: qbento-html: annotations: visual:` was
an earlier design proposal and is **not an implemented setting**; `_quarto.yml`
is not a source of this option in this first implementation.

| Level | Informational traces placed in QMD *during approved sync* |
|---|---|
| `none` | Remove supported optional `.qbento-design` heading classes and descriptive reference comments; retain technical IDs, semantic blocks and source-owned visual attributes. |
| `minimal` **(default)** | Add `.qbento-design` to an already identified slide heading when that slide has external visual state; remove it when that state is absent. |
| `detailed` | The same class plus a controlled, one-line reference comment identifying the slide, sidecar paths and categories of external design; no geometry or source ownership declarations are copied. |

For example, detailed sync can propose these exact fragments:

```markdown
## Resultados {#resultados .qbento-design}
<!-- qbento-design: {"features":["overrides"],"references":[".qbento/state.json"],"slideId":"resultados","version":1} -->
```

External state includes retained visual overrides, decorations, stacking and
native creation design. An active theme in the validated `.qbento/design.json`
registry signals all original slides; a referenced registered layout signals
its original slide. Unused registry entries do not produce traces. References
point only to `.qbento/state.json` or `.qbento/design.json`; categories carry no
style values and do not become source-owned properties.

**Save and render never add or remove these traces.** Use the ordinary controlled
sync preview/apply, including when there are no semantic pending changes. The
preview exposes every annotation patch alongside semantic patches, and apply
uses the same recoverable source/state transaction. A change to the original
QMD, saved state or exact registry bytes invalidates the reviewed plan.

Optional annotation updates require an existing explicit heading attribute ID
such as `{#resultados}`. Technical `qb:*` markers are retained, but annotation
sync never pins an identity implicitly. Unmapped slides, attributes outside the
bounded source parser, or existing weak provenance that cannot safely survive a
source hash change produce visible omission diagnostics. Compatible semantic
sync remains available. Existing weak identities need an explicit, verified
migration before optional traces can be enabled; simply adding an ID does not
automatically authorize rebinding retained design.

The reserved reference namespace is strict: malformed, conflicting, duplicated
or misplaced `qbento-design` comments are preserved and refuse sync instead of
being guessed or overwritten. Namespace-looking text inside YAML, literal code,
chunks and display math remains literal. These levels govern **optional
descriptive annotations**, not authored semantic synchronization. See the
[annotation evidence](evidence/ANNOTATIONS.md) for verification and limits.

## Chunk annotations: unresolved exact syntax

Both a wrapper `::: {.bento-chart}` and a cell-class mapping are candidates for declaring chart intent. Do **not** freeze `#| bento: chart` as a supported Quarto option before validating knitr/Jupyter parsing and the extension's handling. Ordinary Quarto `label` and `echo` options already give useful semantics.

## Advanced source-side design

User-supplied QMD design attributes (including roles, layouts, coordinates, animation declarations) are allowed. Studio changes to **those specific sourced properties** must be reported as divergence and can be synced back. Source-owned explicit attributes and sidecar-owned other properties must compose deterministically.

## Local layout and theme registry

The implemented optional `.qbento/design.json` registry selects a basic theme
and reusable named column layouts. Use `bento-layout-name` in QMD; keep explicit
QMD design ownership separate from native sparse overrides. See the
[registry schema and authority contract](DESIGN_REGISTRY.md) and
[executed/native evidence](evidence/DESIGN_REGISTRY.md).
