# Executed source-component integration

Validated on Linux with Deno 2.9.6, Quarto 1.10.19 and the existing pinned Bento
1.2.6 shell. This evidence concerns source projection, durable state, bounded
sync and actual Quarto recomputation. It does not establish native interaction,
visual typography fidelity, custom registry persistence or platform completion.

Run from a compatible checkout:

```sh
deno test --allow-read --allow-write --allow-run --allow-env tests/components_execution_test.ts
deno test --allow-read --allow-write --allow-run --allow-env tests/design_test.ts tests/design_execution_test.ts tests/displayed_code_test.ts
```

Seven focused component tests prove:

- A named two-column layout with identified card children projects to native
  groups/backgrounds. Internal H2 and H3 headings remain on one slide and bind
  to the original card heading spans, including an unlabelled heading.
- A literal card body and its source-owned background fill synchronize only
  their bounded original spans. Changed CSV data changes the computed SVG;
  native geometry and typography overrides survive with stable `docId`.
- Parent frame attributes and typography inherited by several children are
  source-owned. A native child change is saved/reopened/recomputed as
  recoverable pending content; sync refuses `UNMAPPED_DESIGN` instead of
  guessing a parent patch or losing the edit.
- One `.bento-code` wrapper retains exact authored displayed-code provenance and
  language. Its native content/explicit wrapper x coordinate sync safely.
  Executable code wrappers, competing child geometry, unknown layout names and
  wrong column counts refuse.
- Proportional fitting scales native code's pixel font size with its box while
  retaining its unitless line-height ratio. Eight displayed lines fit the
  computed box. An explicit child font-size declaration that parent placement
  would change refuses rather than clipping or silently altering it.
- Legacy `layout="two-column"` refuses before computation in both core render
  and an installed ordinary Quarto pre-render hook. A producer that creates a
  file does not run; QMD remains byte-identical.

The final focused run passed **20 tests, 0 failures** in 1 minute 31 seconds:
seven component tests plus thirteen existing design and displayed-code
regressions. Type checking, lint and formatting checks also passed. The entire
repository suite was not run for this isolated component change.

## Quarto attribute discovery

The original target example `layout="two-column"` collides with Quarto's own
layout attribute. Actual renders with both H2 and H3 internal headings reached
Quarto's `main.lua` `parseLayoutWidths` and failed in `_json.lua` with
`invalid literal 'two-column'`; one process grew in memory before failure and
was stopped. That does **not** establish a heading-level limitation. Replacing
only the attribute with `bento-layout-name="two-column"` completed the same
executed component workflow, including the nested H2, in seven seconds.

Supported source syntax therefore uses the namespaced attribute. This is a
validated technical spelling of the agreed named-layout behavior, not a change
of source authority or loss policy. No additional Quarto adapter, source rewrite
or upstream fork was introduced.

## Bounded scope

Cards arrange supported child subtrees inside a frame and may use a decorative
native rectangle. Their background has verified original container provenance;
it is never a fabricated authored paragraph. Semantic children keep separate
source identities and computed producer proof. Native grouping is flat; the
source and metadata retain semantic nesting.

The built-in two-column layout is reusable by name. Arbitrary layout/theme
registries, nonlinear group transforms, child-to-parent geometry inference, full
source sync of inherited styles, animation layout authoring and annotation
levels remain open. Unsupported conversions remain explicit diagnostics.

## Independent native DOM regression

An independent review rendered eight displayed code lines in a two-column card
with the pinned shell and Chromium. Before the correction, only box geometry was
scaled: native code had height 125.52 px and font size 24 px, and its 240 px
`pre` was clipped by `overflow:hidden`. Proportional fitting now scales pixel
font size, letter spacing, radius and stroke width with the frame; unitless line
height stays unchanged. The same rendered fixture had font size 11.15755 px,
`pre` height 112 px, and client/scroll height 126 px in both editor and
thumbnail; all eight lines remained within the box. This is DOM/runtime
evidence, not a visual approval claim.

Types whose internal metrics are not adapted (including native tables/charts,
embeds and raw SVG objects) refuse `COMPONENT_CONTENT_LAYOUT_UNSUPPORTED` inside
these components. Static computed SVG projected as an image remains supported.
This prevents later projector branches from silently admitting clipped content.

## Coordinator visual finding: default composition still open

The integrated two-column fixture with a literal heading/body card and an
R-generated SVG card was rendered in native Chromium and visually inspected.
`output/playwright/native-components-initial.png` shows that the card's content
was proportionally reduced again when the completed card entered its column.
The resulting text and figure were too small, despite fitting inside their
boxes. This is an outstanding composition issue, not visual acceptance. The
follow-up must lay out children in their final column frame and recheck both
code lines and text/figure readability. The earlier safe-sync and provenance
evidence remains valid within its stated scope.
