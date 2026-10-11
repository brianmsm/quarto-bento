# Native tables inside cards and layouts — Linux receipt

Runtime and regression implementation:
`884629dac294971c929474dd46db6c7ec86a5bca` (on `c846e1f`, based on integrated
list baseline `65e27c5`). This receipt covers bounded plain authored/computed
tables inside source cards and layouts. It does not close native chart/KPI
composition, arbitrary table conversion, or full product/cross-platform
acceptance.

## Projection contract

`projectTable` now receives the final component content frame. It checks every
column against that width using the existing conservative single-line bound,
keeps the native font/padding/border metrics, and requires the full intrinsic
row height to fit both the frame and slide. Native tables participate in
component placement by translation with exactly unit scale. Floating-point
coordinate subtraction has a 0.01px comparison tolerance; even within that
tolerance the code uses scale `1`, preserving the exact table metrics.

For card rows, the adapter measures a table through its complete transparent
source/execution wrapper chain before allocating the card's children. It does
not allocate the former generic 90px row to a 168px table. Extra semantic
siblings inside the table wrapper refuse `COMPONENT_TABLE_SUBTREE`; the source
author can put adjacent headings/paragraphs in separate card children. No child
is silently omitted to make the table fit. Standalone table behavior and
`validateAuthoredTable`/`tableProducer` source checks remain in force.

The unchanged state contract treats table rows/header/columns as semantic.
Visual geometry and table-wide style changes remain design, unless explicitly
owned by QMD. A source-owned child displacement remains pending and refuses a
guessed parent attribute sync. Authored cell edits remain recoverable pending
changes; computed cell edits remain conflicts. No new reverse cell codec or
computed-data detachment is implied.

## Reproducible example and tests

[Example QMD](../../examples/composed-tables/deck.qmd) and
[CSV](../../examples/composed-tables/data.csv) produce an authored table and a
labelled R/knitr table in two cards within a two-column layout. The first card
also includes a heading and a following paragraph.

```sh
QBENTO_COMPOSED_TABLES_EVIDENCE=output/verification/composed-tables-884629d \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/composed_tables_test.ts
```

The six focused regressions cover:

- Final slot metrics, native DOM and text glyph bounds, exact authored/computed
  provenance, changed CSV values with retained geometry/style, and an exact
  emitted-document rebuild using only QMD, CSV, `project.json` and `state.json`.
- Recoverable authored cell edits and computed-cell conflict refusal.
- Narrow/tall cards and mixed table wrappers refusing without replacing the
  prior published HTML, state revision or source.
- Tables directly in layout columns, metric-preserving card translation, and
  refusal when a parent would shrink the table box.
- Explicit source-owned parent geometry remaining pending after visual edits and
  recalculation.
- Fractional two/three-column registry frames preserving all widths, heights,
  rows, columns and style exactly, including the independent review regression.

The earlier combined table/component run passed 23 tests (1m34s). The final
six-test run, full source type check, and lint/format checks for changed
TypeScript files are recorded in the local receipt directory above. No full
project suite was rerun for this isolated lane.

## Native evidence

Tests use real installed headless Chromium and the shipped pinned Bento shell,
not a recreated table renderer. The initial and changed-data screenshots were
visually inspected. Both cards and every row are visible; the authored table's
heading and following paragraph remain separate and readable. The changed CSV is
reflected in the right table while its saved green header and displacement
remain.

The actual native DOM reports tables 496×168px, two 247.5px columns (accounting
for collapsed borders), 18px font, 23.4px line-height, 16px horizontal and 11px
vertical cell padding. Each cell inner is 215×23px with no scroll overflow; DOM
Range glyph rectangles fit within their cell bounds. The tests repeat these
assertions after changed-data regeneration. Direct layout tables are 544px wide
with unchanged 168px height and native internal metrics.

Local artifact names: `initial.png`, `changed-data.png`, corresponding `.json`
DOM measurements, `tests.log`, `check.log`, `lint.log`, `fmt.log`, and
`receipt.json` under `output/verification/composed-tables-884629d/`. The receipt
records artifact hashes and the runtime commit; these generated artifacts are
not committed source files. The environment is local Linux with Quarto 1.10.19,
R 4.6.1, Deno 2.9.6 and Chrome 152.0.7977.82; native Bento is pinned at
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

## Remaining boundaries

Only the existing plain-table codec is composed: rich cells, merged cells,
captions, multi-output or ambiguous source bindings, and unsupported wrapping
still refuse. Cards cannot inherit text-only typography attributes into a native
table's nested style object; style remains editable in Bento. Tables that exceed
the conservative final-frame bound refuse before publication. Unadapted native
charts, embeds, raw SVG and video remain negative component cases. This receipt
is Linux headless browser evidence, not native macOS/Windows, foreground
desktop, PDF or public-release acceptance.
