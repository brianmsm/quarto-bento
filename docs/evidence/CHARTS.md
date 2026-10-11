# Bounded native charts from explicit table data

This slice projects an identified `.bento-chart` wrapper with
`bento-chart-kind="bar"` or `"line"` and exactly one simple data table to a real
native Bento `chart` object. Verified with Linux, Quarto 1.10.19, R/knitr, Deno
2.9.6 and Bento revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Native
browser visual acceptance is recorded separately below.

## The pinned runtime, rather than the nominal ECharts schema

`slides/src/model.ts::ChartElement` describes a pure-JSON ECharts-shaped
`option`. The pinned implementation actually uses its own `kernel/src/charts.ts`
**charts-lite** engine. Unknown option keys can be ignored. Its bar/line reader
coerces nonnumeric data to zero, displays numbers with at most two decimal
places, thins crowded category labels and does not render an `xAxis.name`.
Consequently this adapter does not infer a chart from an R plot, use permissive
native table-to-chart parsing, promise arbitrary ECharts options, or accept
missing values as zero.

The initial contract is deliberately bounded:

- One table with one header row, an **empty first header**, and one to four
  uniquely named numeric series. The first column contains unique, nonempty
  category labels. A meaningful first-column header refuses because the pinned
  engine cannot display that axis title. No source label is silently removed.
- One to eight categories for bars; two to eight for straight, unsmoothed lines.
  Labels and legend names must fit conservative single-line width bounds in the
  default 1120 by 460 frame. These bounds do not certify arbitrary later
  resizing, fonts or native option edits.
- Plain base-ten decimal numbers with at most two decimal places, absolute value
  at most 1,000,000, and no negative zero. Missing values, `NA`, `NaN`,
  infinity, percentages, separators, exponents, units and precision beyond two
  decimals refuse with `UNSUPPORTED_CHART` rather than being rounded or guessed.
  Numeric quantities are preserved; lexical zero padding such as `2.50` is not a
  chart formatting contract.
- Negative, zero and positive values retain their sign. Explicit integer value
  axis bounds include zero and every data point. The native engine's six ticks
  then have at most one decimal place; tiny nonzero quantities do not acquire
  misleading rounded zero tooltip values.
- Simple table restrictions also apply: captions, spans, rich cells, multiple
  tables, extra output and unrecognized wrappers refuse explicitly. Alignment
  and table widths are table presentation, not inferred chart semantics.

## Authored data

```text
## Results {#results}

::: {#effects .bento-chart bento-chart-kind="bar"}
| | Effect | Other |
| --- | ---: | ---: |
| Alpha | -2.5 | 1.25 |
| Beta | 0 | 3 |
:::
```

The independent source mapper rescans original QMD bytes, verifies the exact
component role/kind and singleton table, and recomputes the expected option from
literal source cells. It compares the executed chart's values, labels, kind and
options against that proof. Merely reusing an ID or changing caller-supplied
source metadata cannot establish authorship. Rich/inline-computed table text
cannot acquire a fabricated authored mapping.

## Computed data

````text
## Results {#results}

::: {#effects .bento-chart bento-chart-kind="line"}
```{r}
#| label: chart-maker
#| echo: false
knitr::kable(read.csv("data.csv"), format="pipe", col.names=c("", "N"))
```
:::
````

The original wrapper must contain exactly one explicitly labelled executable
chunk. The executed result must be one table under ordinary Quarto cell/output
wrappers, and its computed context must agree with the original producer. Use a
non-`tbl-` label so Quarto does not create an unsupported captioned float.
Changing the CSV refreshes both categories and series from execution.

## Save, recompute and unsupported reverse editing

Outer geometry follows the existing visual ownership rules and survives save,
reopen and changed-data render. Explicit source geometry attributes retain their
existing source ownership and binding mechanism.

The complete `option`, `preset`, and optional native `source` table-link fields
are classified as semantic. This conservative boundary also includes option
styles: they become visible authored pending changes or computed conflicts, not
visual overrides that can silently freeze source values or select an unverified
linked table. More granular retention of safe internal chart styles needs a
separate validated adapter.

Authored option edits remain recoverable as pending changes. This slice does not
implement reverse mapping from chart options to literal table cells or the kind
declaration. Sync refuses unsupported changes and leaves QMD unchanged. Computed
edits always conflict; they are never reverse-written into code or inputs.
Existing explicit restoration/detachment remains the state core's resolution
path. Charts inside card/layout components remain outside this slice pending
measured component layout support.

## Evidence

`tests/chart_test.ts` verifies strict numbers, signed data, unique labels,
structural refusal, independent original-source proof, pure JSON/native schema,
semantic classification and changed-data composition. Real Quarto tests cover:

- CRLF authored table -> native chart -> save/reopen pending -> refused source
  sync -> independent source change -> conflict without source rewriting.
- CSV/R/knitr -> computed native line chart -> changed labels and values ->
  retained geometry -> edited internal option -> explicit computed conflict.
- Missing values and a meaningful category header refusing before publication.

Independent review executed the pinned `chartSnapshotSvg` implementation with a
minimal synthetic DOM. Both bar and line output retained category labels
including `Málaga` and `A < B`; tooltips retained `-2.5`, `0.01`, `1.25` and
`-0.01`. Negative bars started at the zero baseline, without NaN or
missing-value coercion. This is runtime evidence against the actual pinned
engine using a synthetic DOM, not native browser or visual acceptance. Review of
original source proof and semantic option/preset/source classification found no
blocker.

Run the focused tests with:

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/chart_test.ts tests/design_test.ts tests/state_test.ts
```

## Integrated native acceptance

`examples/native-charts/{deck.qmd,data.csv}` is the reproducible source fixture.
The coordinator opened its real Studio in explicitly headless Chromium and
visually inspected the authored bar chart: Alpha's negative Effect, its positive
Other value, and Beta's zero Effect and positive Other value retained their
signs, category labels and legend.

Using native position controls, the computed line chart was moved to
`x=120,y=205,w=1020,h=460` and saved. After changing the CSV from categories
`[Alpha,Beta]`, values `[-2.5,1.25]` to `[Alpha,Gamma]`, values `[-2.5,4.75]`,
Recalcular produced the new labels and line. The durable before/after states
(revisions 3 and 4) had identical geometry, no pending edits and docId
`468de181-ec65-4ad0-bb29-3014cc56687d`. Native presentation at 1280 by 720 rendered
the updated chart, and hovering Gamma displayed `N: 4.75`.

Captured and visually inspected local artifacts:
`output/playwright/native-chart-bars.png`, `native-chart-recomputed.png`, and
`native-chart-presenter-tooltip.png`. This demonstrates native editor,
presentation, hover and changed-data preservation for the supported fixture;
it does not broaden the numeric/schema limits above.

The integration regression additionally executes Quarto with a native chart or
table nested inside a card. Both refuse before HTML publication, retaining the
original QMD, until an appropriate internal-layout adapter exists.

The nominal ECharts categorical
[bar](https://echarts.apache.org/handbook/en/how-to/chart-types/bar/basic-bar/)
and [axis](https://echarts.apache.org/handbook/en/concepts/axis/) shapes
informed inspection, but the pinned Bento implementation above is the authority
for the supported runtime behavior. This slice does not claim general ECharts
compatibility, arbitrary fonts or chart
formatting, missing-data support, or reverse table/code synchronization.
