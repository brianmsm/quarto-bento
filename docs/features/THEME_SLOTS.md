# Reusable slide slots and variant styles

This source addition completes the reusable design vocabulary with named slide
slots and variant-specific role styles. It keeps registry and design-package
schema version 1, the pinned Bento runtime and the existing checked import/save
workflow. It adds no CSS execution, semantic templates or automatic inheritance
between files.

A variant may override `styles` for the same `title`, `heading`, `body`, `code`
and `card` roles as the theme. For example, a dark variant can choose light body
and code text independently of another slide. Existing variant `title` settings
remain compatible and take precedence over its title role defaults.

```json
{
  "background": "#243a42",
  "styles": {
    "title": { "color": "#ffffff" },
    "body": { "color": "#ffffff" },
    "code": { "color": "#ffffff" }
  },
  "slots": {
    "citation": {
      "frame": { "x": 64, "y": 675, "w": 1152, "h": 25 },
      "style": "light-citation"
    },
    "task": {
      "frame": { "x": 64, "y": 580, "w": 1152, "h": 75 },
      "style": "light-task"
    },
    "comparisons": {
      "frame": { "x": 64, "y": 180, "w": 1152, "h": 340 },
      "layout": "columns",
      "gap": 32
    }
  }
}
```

This is the value of one entry in `theme.variants`; `light-citation` and
`light-task` must be declared in the theme's `namedStyles`. Different variants
can select different named styles for the same slot name. Slots contain no
course text or source IDs.

Select the variant on the original top-level slide heading and a slot on an
identified top-level fenced div:

```qmd
## Interpretation {#interpretation bento-variant="dark"}

::: {#interpretation-task bento-slot="task"}
Explain the result before continuing.
:::

::: {#interpretation-citation bento-slot="citation"}
Source: the original course reference.
:::
```

`bento-slot` is explicit: an ID containing `citation` does not implicitly select
a role. Each slot can be selected once per slide. A slot without `layout` holds
one supported subtree, such as a text wrapper, displayed code wrapper, card or
compatible computed output. An optional named style must match the original
text/code/card target; mixed or computed subtrees can use role defaults without
a slot-specific named style.

For repetition, `layout: "rows"` or `"columns"` divides the frame evenly between
one to six identified direct div children. The gap defaults to 16 px. These
children can contain supported text, code or native components. A named style
on the row/column slot must match **every** original child target: use a text
style for authored text children or a code style for displayed-code children,
not a card style on the whole row/column wrapper. Mixed children, computed
outputs and card children can use role defaults with no slot-wide named style.
A single, non-row/column slot can target a card with a named card style.
Card defaults apply only to their bounded supported children; they are not
general recursive style inheritance for arbitrary descendants.

Row/column slots preserve original child identities and order; they do not
infer grouping from proximity. Nested absolute slots, unknown names, duplicate
uses, incompatible styles and impossible gaps refuse with a source/design
diagnostic. A row/column slot is a plain wrapper, not another `.bento-*`
component.

Slot frames are absolute positions on the existing 1280 × 720 canvas, with at
most 32 named slots per variant. Each frame must fit that canvas. Content must
fit the selected frame or row/column; there is no automatic font shrinking.
Native text measurements remain the authority for font-dependent overflow. Slots
do not advance ordinary slide flow: authors should place all independent regions
explicitly or reserve a non-overlapping ordinary content frame.

The style order remains role defaults, inherited/slot style, explicit named
source style, explicit source attributes and retained native overrides. Frame
and style defaults from a slot do not become source-owned fields. Native saved
adjustments remain editable and survive package updates and recalculation.
Explicit source visual fields retain their existing ownership. Computed content
retains its producer and never becomes executable source through
synchronization.

The selector is recovered from the exact original QMD when Quarto erases it; a
filter cannot forge another slot on the executed wrapper. Source preflight runs
before computation and before checked design initialization/import. A new
presentation receives its own document identity even when it uses the same
package as another session.
