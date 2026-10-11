# QMD authoring and visual annotations

**Status:** this document describes the **intended Quarto-Bento contract**. Direct-object visual attributes on identified headings/single-object fenced divs now have integrated [projection and sync evidence](evidence/DESIGN.md). The component vocabulary and annotation levels below remain incomplete. Standard Pandoc/Quarto fenced div syntax underlies the examples; component-specific semantics are ours.

## Three modes

1. **Plain QMD:** headings, Markdown and executable chunks. Studio assigns visual design without cluttering QMD.
2. **Declarative components:** QMD declares the *semantic role* of a visual object; Studio owns most styling.
3. **Advanced QMD:** explicitly declare geometry/styles/effects; Studio can subsequently change these with field-level pending sync.

### Example: layout, chart and text card

````markdown
## Resultados {#resultados}

:::: {#results-grid .bento-layout layout="two-column"}

::: {#effects-chart .bento-chart}

```{r}
#| label: fig-effects
#| echo: false

plot_effects(modelo)
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

### Component vocabulary (target API)

| QMD component | Intended role / likely Bento projection |
|---|---|
| `.bento-layout` | Named reusable arrangement for a group (`layout="two-column"` etc.). |
| `.bento-card` | Styled group/card whose meaningful heading and body remain in QMD. |
| `.bento-kpi` | KPI/metric composition; literal or computed provenance must be retained. |
| `.bento-chart` | Native chart if faithful; SVG/static fallback otherwise. |
| `.bento-diagram` | Nodes/labels/connectors, composed from Bento elements when possible. |
| `.bento-timeline` | Sequence of annotated milestones and connecting shapes. |
| `.bento-code` | Displayed source-code component (distinct from a computed output). |

These are **Quarto-Bento abstractions**, not necessarily built-in Bento element types. The exact per-component schema, editable subset and conversion thresholds are implementation work.

```markdown
## Resultados {#resultados}

::: {#finding .bento-card x="84" y="166" w="530" h="320"}
### Hallazgo principal
Texto de la tarjeta.
:::
```

Attributes declared explicitly in QMD carry source ownership: when Bento changes their values, Studio shows pending sync for those exact fields. Without explicit attributes, geometry and styling are stored in `.qbento/`. Changes must not silently overwrite either source.

## ID and grouping conventions

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
as text objects. The `.bento-code` component wrapper remains future integration.
See [executed and native evidence](evidence/DISPLAYED-CODE.md).

### Stable identities

- Reuse explicit heading/block IDs and chunk labels when possible.
- Add stable `qb:*` source markers only when needed for round-trip; do not flood clean QMD with markers at initialization.
- Distinguish **semantic ID** (source content), **Bento element ID** (object on a particular slide), and **morph ID** (animation pairing across slides). A semantic figure may have multiple visual instances.
- A meaningful card/title/annotation created in Studio should map to a QMD fenced div or another faithful semantic construct **when synced**. Spatial proximity alone does not automatically imply semantic grouping.
- Purely decorative shapes/paths can remain entirely in `.qbento/`.

## Configurable QMD annotations

Proposed config (exact option parsing to verify). Quarto custom formats normally use a base-format suffix (such as `-html`); bare `format: bento` is **not assumed to work** merely because an extension is installed:

```yaml
format:
  qbento-html:   # provisional custom-format key; not an existing implementation
    annotations:
      visual: minimal  # none | minimal | detailed
```

| Level | Informational traces placed in QMD *during sync* |
|---|---|
| `none` | No optional visual-only markers; retain any technical IDs and semantic blocks necessary for round-trip. |
| `minimal` **(default)** | Lightweight per-slide signal, such as `## Resultados {#resultados .qbento-design}`, when there is external visual state. |
| `detailed` | Additional opted-in component/layout/style declarations or references, without dumping entire BentoDoc geometry into Markdown. |

These levels govern **optional descriptive annotations**, not whether authored text is synchronized. The `.qbento-design` class is a project convention and may be removed/updated if visual state changes; `.qbento/` remains authoritative for its details. Saving a Studio visual change does not itself imply editing QMD: any new annotations are applied at a controlled sync.

## Chunk annotations: unresolved exact syntax

Both a wrapper `::: {.bento-chart}` and a cell-class mapping are candidates for declaring chart intent. Do **not** freeze `#| bento: chart` as a supported Quarto option before validating knitr/Jupyter parsing and the extension's handling. Ordinary Quarto `label` and `echo` options already give useful semantics.

## Advanced source-side design

User-supplied QMD design attributes (including roles, layouts, coordinates, animation declarations) are allowed. Studio changes to **those specific sourced properties** must be reported as divergence and can be synced back. Source-owned explicit attributes and sidecar-owned other properties must compose deterministically.
