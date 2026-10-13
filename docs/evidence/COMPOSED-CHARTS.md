# Native charts inside cards and layouts — Linux receipt

Runtime `2ce6db1` adds measured chart composition on integrated baseline
`cea3e61`, retaining the KPI `MeasuredComponents` fixed/omitted metadata.
This covers the existing native bar and straight-line codec inside source
cards and layouts. It does not imply arbitrary ECharts, reverse chart-data
editing, or native cross-platform acceptance.

## Projection contract

`projectChart` receives the final content frame before building native options.
The adapter retains 14px axis/legend typography, a 112px left margin, 24px
right/top margins and 78px bottom margin. It checks the final category bands,
conservative full-label and legend width, and a minimum height of 242px.
A chart participates in component placement by translation with exactly unit
scale. A 0.01px bounds tolerance covers coordinate subtraction only; it never
introduces near-one scaling. Card charts take the remaining height after
measured title/text siblings. Direct layout charts fill their column slots.

The complete chart wrapper must retain its original plain table or explicitly
labelled producer proof. Extra siblings inside a data wrapper refuse. A
transparent outer wrapper around a card chart must contain only that chart;
put headings and text in separate card rows. Ambiguous child geometry refuses
instead of guessing ownership. Flat native `groupId` follows the source parent
component (the enclosing layout when a card is inside a layout). Original-source
checks cover each ancestor's attributes and immediate parent, the chart wrapper
attributes and identity, and the final group and original slide for both
literal and computed data. A transparent wrapper does not invent a group.
Coverage requires each original chart exactly once, so deleting a whole chart
through a filter cannot evade per-object checks.

The existing semantic contract is unchanged: chart options and presets are
content. Authored option edits remain pending; computed option edits conflict.
They cannot freeze stale data as design or reverse-write an R producer. Visual
position/opacity persist unless QMD explicitly owns the field; editing geometry
owned by a parent remains recoverable pending and refuses guessed source sync.

## Reproduction and checks

[The example](../../examples/composed-charts/deck.qmd) contains literal grouped
bars and a CSV-driven R/knitr line chart, each in a titled card in a two-column
layout. Use the installed compatible environment; no environment installation
or management is performed.

```sh
QBENTO_COMPOSED_CHARTS_EVIDENCE=output/verification/composed-charts \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/composed_charts_test.ts
```

Five new regressions cover real Quarto execution, authored/computed provenance,
changed CSV labels and values, retained design and `docId`, exact reconstruction
from QMD/CSV/project/state without the old HTML, atomic refusal preserving
published HTML and state revision, explicit geometry ownership, direct columns,
and fractional frame dimensions. Existing `chart_test.ts` exercises numeric
fidelity and independently checked original-source bindings.

The five new tests passed before integration (37s). The combined focused run on
`2ce6db1` passed **29 tests, zero failures, in 1m34s**, including composed charts,
composed KPIs, standalone chart checks and component execution regressions.
`deno task check`, targeted lint/format and `git diff --check` passed. This is
separate from the historical full-suite receipt; this lane does not rerun the
full suite.

## Native browser and visual evidence

Real headless Chrome 152.0.7977.82 loads the shipped Bento 1.2.6 shell pinned to
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Actual SVG assertions verify every
category/series label, unclipped and nonoverlapping label glyph bounds, native
14px font size, numeric mark count, bar sign and magnitude, category bands,
and line point coordinates. Native SVG viewBox comparison permits 0.001px for
its float32 DOM representation; source and emitted geometry retain their exact
numbers. Cloned SVGs have no JavaScript tooltip properties, so numerical checks
use actual SVG marks rather than assuming a synthetic tooltip property exists.

The initial and changed-data screenshots were visually inspected: both cards,
titles, legends and signed data are readable. The CSV changes Beta/1.25 to
Gamma/4.75 while Alpha/-2.5 remains. The line retains saved x=688 and opacity=.9.
Card charts are 496×362px; direct column charts are 544×470px; the fractional
fixture yields 496.2×362px charts without internal rescaling. Screenshot/metric
pairs are named `initial`, `changed-data`, `direct-columns` and `fractional`.
Local evidence is in `output/verification/composed-charts-2ce6db1/`, with a
receipt containing hashes of the metric files, captures and test logs.

This is a core Save/recompute/rebuild cycle plus actual pinned native DOM and
visual inspection. It does not claim a manual Studio drag or Presenter tooltip
interaction for this composed fixture. Standalone native interaction evidence
remains in [CHARTS.md](CHARTS.md).

## Independent-review source-context correction

Review reproduced an AST and real Lua filter moving a source chart into an
unrelated card (including another slide) while its table proof stayed valid.
The follow-up validates composition context independently of the table-data
proof and checks computed charts before the general computed-origin fast path.
`chart_context_test.ts` covers AST nesting, moving, removal and attribute
changes; tampered native group/identity/coverage; legitimate transparent
source wrappers; and real Lua authored/computed mutations after a prior
publication, checking source, HTML and state bytes remain unchanged on refusal.

The follow-up source-context tests passed **3/3 in 15s**. The existing eight
chart tests and five composed-chart tests also passed with the correction;
source type checking and targeted lint/format passed. The earlier combined
29-test result remains attributed to `2ce6db1`, not retroactively to this fix.
