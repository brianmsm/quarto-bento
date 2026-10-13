# QMD authoring and visual annotations

**Status:** this document defines the **target authoring contract** and
distinguishes implemented subsets below. Direct-object visual attributes,
plain-QMD identity acquisition, `.bento-kpi`, cards, two-column layouts,
displayed code and the `none`/`minimal`/`detailed` informational annotations
have bounded Linux implementation evidence. `.bento-diagram` and
`.bento-timeline` also have bounded source adapters. Studio supports explicit
authored card/KPI creation with reviewed source promotion. This flow has Linux
headless acceptance through Studio and the pinned Bento editor; see the [native
creation receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).
The receipt does not claim foreground desktop or other-platform acceptance.
Standard Pandoc/Quarto fenced div syntax underlies the examples;
component-specific semantics are ours.

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
instead consumes explicit simple table data and supports measured card/layout
slots; see its implemented contract below.

### Component vocabulary and status

| QMD component | Role and current status |
|---|---|
| `.bento-layout` | Implemented `two-column` arrangement with two identified direct children. |
| `.bento-card` | Implemented bounded card with source-backed content and decorative background. |
| `.bento-kpi` | Bounded source metric; Studio creates literal-value KPIs through reviewed promotion. |
| `.bento-chart` | Implemented native bar/straight-line subset with identified source data. |
| `.bento-diagram` | Bounded identified nodes and source-declared DAG edges; see [Linux evidence](evidence/GRAPHS.md). |
| `.bento-timeline` | Bounded identified milestones with source-order adjacency; see [Linux evidence](evidence/GRAPHS.md). |
| `.bento-code` | Implemented wrapper for one displayed, non-executable code fence. |

These are **Quarto-Bento abstractions**, not necessarily built-in Bento element
types. See the evidence links for implemented schemas and refusal boundaries.
Target-only entries and target attributes elsewhere in this document are not
accepted source syntax yet.

### Source KPI (`.bento-kpi`, implemented subset)

An identified KPI may be standalone or inside verified original cards/layouts
on its source slide. It contains
two or three direct, identified fenced-div children, in this order:
`bento-role="label"`, `bento-role="value"`, and optional
`bento-role="detail"`. Each child has exactly one paragraph; each role ID is
globally unique and the role containers have no extra classes. The value is
literal text or one supported single-line Quarto inline expression. The adapter
retains computed provenance and never writes a rendered number over its
producing source. It does not infer labels, coerce or round values, or support
arbitrary nested component membership. See [composed KPI source checks and
measured metrics](evidence/COMPOSED-KPIS.md), the exact [KPI schema and refusals](evidence/KPI.md),
its [canonical example](../examples/kpi/deck.qmd), and [native
acceptance](evidence/PLAIN-KPI-NATIVE.md). Studio-created KPIs use the
separate bounded flow below and always begin with authored literal text; they
do not create or modify a Quarto computation.

### Source diagrams and timelines (bounded subset)

Each identified top-level `.bento-diagram` contains 2–6 identified direct
`.bento-node` children, each with exactly one authored literal paragraph. Its
identified direct `.bento-edge` children name `from` and `to` IDs belonging to
nodes in that same diagram and allow zero or one authored literal label
paragraph. The implemented layout accepts a directed acyclic graph with at most
three topological columns, two nodes per column, and eight distinct edges;
paths must route clearly without crossing unrelated edges, passing through
foreign nodes, or overflowing measured text.

Each identified top-level `.bento-timeline` contains 2–6 identified direct
`.bento-milestone` children with one authored literal paragraph each. Their
lexical QMD order defines the sequence and derived links. Moving a timeline link
in native z-order does not change that sequence; a native endpoint edit on a
derived timeline link remains pending and must be restored before publication.
The pinned native editor currently removes a diagram endpoint binding when it
is dragged rather than reassigning it. Review refuses that incomplete change.
Use native Undo to restore it, or open Studio's **Relaciones** controls and
select the source slide, diagram, connection, and distinct **Desde**/**Hacia**
nodes to reconnect it explicitly. Node choices display their literal labels
and source IDs. Timeline entries appear in the same dialog as a read-only
sequence; their endpoint controls are disabled because adjacency is derived
from lexical QMD milestone order. Diagram edge endpoints are QMD-owned meaning;
connector anchor sides, positions, colors, typography and stacking are visual
state.

Opening **Relaciones** first saves current native editor changes to `.qbento/`
and reads a checked project/source snapshot. **Guardar relación pendiente**
stores the selected `from` and `to` endpoints together as one project update,
retaining each visual anchor side. The request is checked against `docId`,
project revision, source hash, mapped graph membership, and distinct nodes in
the same diagram. A stale dialog/source, source conflict, or missing graph
member refuses the relationship Save. Sync also checks that the pending
relationship still matches the saved native connector and that its proposed
topology is supported before it can patch QMD. Thus project Save, source
Sync/Apply, and QMD execution are separate: relationship Save changes only
pending project state, reviewed Apply changes QMD, and **Recalculate** executes
it. Timeline relationships cannot be edited in this dialog; reorder the
milestone blocks in QMD and recalculate instead.

Both adapters reject computed/dynamic labels, arbitrary HTML, nested graph
components, automatic native-to-source membership inference, and universal
graph layout. Reordering timeline blocks in QMD changes adjacency while
existing node identities and design are retained. See the canonical
[example](../examples/source-graphs/README.md) and [Linux validation and native
DOM receipt](evidence/GRAPHS.md).

### Studio-authored cards and KPIs (bounded creation flow)

Studio can explicitly create a card or KPI on an existing QMD-backed slide. A
card uses `title` and `body`; a KPI uses `label`, `value`, and optional `detail`.
Fields are authored text in one supported paragraph, and a card title is one
line. The KPI value entered here is literal text. Use the source `.bento-kpi`
contract above when the value must be computed. The creation action declares
these roles and identities itself; it does not infer a component from
proximity, native grouping, or an arbitrary collection of objects.

Reviewed promotion writes these bounded source forms with generated IDs; each
role container holds one authored paragraph:

````qmd
:::: {#studio-card .bento-card}

### Summary {#studio-card-title}

::: {#studio-card-body}
An authored conclusion.
:::

::::

:::: {#studio-kpi .bento-kpi}

::: {#studio-kpi-label bento-role="label"}
Participants
:::

::: {#studio-kpi-value bento-role="value"}
250
:::

::: {#studio-kpi-detail bento-role="detail"}
Complete cases
:::

::::
````

Save persists the new native members, their recoverable snapshots and the
component's measured projection frame in `.qbento/`, without patching QMD. Sync
must approve the full pending member set for that component; partial selection
is rejected. The reviewed insertion uses the exact card/KPI source schema and
retains the authored members' visual state. The projection frame used to lay
out future source renders is kept separately from the mutable native background
geometry, which remains visual design state. Before source promotion, missing
members can be restored from the saved snapshots or the pending creation can be
discarded; incompatible retyped or extra grouped objects need native resolution
or explicit discard. The Studio client and contract have focused automated
tests, and the real Studio/pinned-editor flow has Linux headless acceptance; see
the [native creation receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).

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
image, plain table, chart and decorative rectangle types. Tables are projected at the
final slot width with their native font/padding and complete row height; their
boxes are never shrunk independently of internal metrics. An identified table
wrapper can be a card child or layout child, including a card within a layout.
Card headings/paragraphs may be separate siblings of that wrapper. A table
wrapper containing extra semantic siblings refuses `COMPONENT_TABLE_SUBTREE`;
move those siblings into separate card children. Native bar/line charts fill
their final slots with axis and legend metrics checked before publication;
see [composed chart evidence](evidence/COMPOSED-CHARTS.md). Embeds or raw native
SVG objects still refuse `COMPONENT_CONTENT_LAYOUT_UNSUPPORTED`; SVG figures
projected as images remain supported. See
[composed table evidence](evidence/COMPOSED-TABLES.md).

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
sync remains unsupported. Plain tables and native bar/line charts support
bounded card/layout composition. Charts require at least 242px height and enough
width for all category labels and the full legend; they retain their native
14px typography and are never fitted by shrinking only the outer box. See
[composed chart evidence](evidence/COMPOSED-CHARTS.md) and
[the composed example](../examples/composed-charts/deck.qmd).

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
review and sync replace only an existing notes body's bytes. Clearing the field
retains the empty identified div. Notes can also be created directly in Bento on
an existing or newly created slide. Review shows the exact new identified notes
div and any necessary source identity acquisition before Apply writes QMD.
Creation requires an unchanged executed source baseline without another notes
container in that slide. Rich Markdown, executable inline expressions, multiple
notes containers and ambiguous source refuse this round-trip. The whitespace,
execution and native acceptance limits are documented in
[notes evidence](evidence/NOTES.md).

### Stable identities

- Reuse explicit heading/block IDs and chunk labels when possible.
- Plain headings and paragraphs can be projected without explicit source IDs. When a reviewed source change needs stable bindings, the sync plan can propose identity patches for affected and untouched weak bindings. These are visible source changes: Save and render never pin identities implicitly. Explicit IDs remain useful, and a change to an existing identity is never treated as automatic authorization to rebind saved design. See [plain-QMD evidence](evidence/PLAIN-QMD.md).
- Add stable `qb:*` source markers only when needed for round-trip; do not flood clean QMD with markers at initialization.
- Distinguish **semantic ID** (source content), **Bento element ID** (object on a particular slide), and **morph ID** (animation pairing across slides). A semantic figure may have multiple visual instances.
- Implemented subset: **Añadir componente** creates explicit authored
  cards/KPIs with the bounded roles described above; reviewed sync maps them to
  the exact QMD fenced-div schema. Spatial proximity or native grouping alone
  never establishes membership. The bounded headless Linux editor acceptance is
  recorded in the [component creation receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).
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

Optional annotation updates require an explicit heading attribute ID such as
`{#resultados}`. Technical `qb:*` markers are retained, but annotation sync
never pins an identity implicitly. Separately, the reviewed plain-QMD identity
phase can propose source IDs before annotation patches in the same complete
plan; neither phase applies automatically. Unmapped slides, attributes outside
the bounded source parser, or existing weak provenance that cannot safely
survive a source hash change produce visible omission diagnostics. Adding an ID
by itself does not authorize rebinding retained design.

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
