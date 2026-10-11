# Bounded Plotly adapter and isolated offline Presenter

Status: **independent implementation and executed Linux evidence, 2026-10-11**.
This is an integration-ready adapter, not acceptance of the full widget product.
The main renderer/Studio does not yet dispatch widgets to this module or publish
its sidecars. Unsupported RawBlock output continues to refuse there.

## Executed result

On Quarto 1.10.19, R 4.6.1, plotly 4.12.1, htmlwidgets 1.6.4 and installed
Chromium, an original QMD chunk produced a real Plotly scatter chart. The
adapter extracted its computed data, rendered it using the exact locally
installed Plotly.js 2.25.2, and obtained a **real vector SVG** with
`Plotly.toImage`. It did not invent a chart from a screenshot or replace the
result with a placeholder.

The self-contained Presenter was loaded with the browser context already
offline. Its only harness route supplied the HTML bytes; there was no server or
asset route. Native hover showed `(2, 5)`. Clicking Plotly's native zoom button
changed the x range from `[0.876058506543495, 3.123941493456505]` to
`[1.4380292532717474, 2.5619707467282526]`. Switching back displayed the
original static chart. Both views were visually inspected. Print CSS selected
the static SVG; a one-page PDF was rasterized and visually inspected (no
JavaScript in PDF). This verifies the widget Presenter harness, not Bento's
full-deck Presenter UI.

The browser's widget frame reported opaque origin `null`. Reads of
`parent.document` and `localStorage` threw. A deliberate fetch to
`https://example.invalid/widget-network-probe` was blocked by
`connect-src 'none'`; the console recorded that CSP refusal. Ordinary loading
produced no console errors. The test does not claim operating-system network
isolation of the browser process itself, nor a full security audit of Plotly.

Local evidence from this worktree run (ignored generated files):

- `output/playwright/plotly-offline-static.png`
- `output/playwright/plotly-offline-interactive.png`
- `output/playwright/plotly-offline-static.pdf`
- temporary input, output AST, bundle and HTML under `/tmp/qbento-widget-probe/`

## Reproducible source contract

Use one original, explicitly identified wrapper containing exactly one labeled
executable chunk. Quarto removes the chunk label from the displayed htmlwidget's
AST in the tested `echo: false` case, so the random `htmlwidget-*` DOM ID is
never used as evidence of a source producer.

````qmd
## Data {#data}

::: {#plot-result}

```{r}
#| label: widget-values
#| echo: false
v <- read.csv("data.csv")
plotly::plot_ly(x = v$x, y = v$y,
               type = "scatter", mode = "lines+markers")
```

:::
````

`collectPlotlyCandidates(ast, source)` rescans the original source, rejects
source mapping diagnostics, and requires the unique executed wrapper to have
exactly `cell → cell-output-display → RawBlock`. It then recognizes one bounded
Plotly HTML/JSON envelope. Echoed code, warning blocks, multiple widgets,
duplicate wrappers, unlabeled producers and explicit `results: asis` /
`asis_output` refuse. The caller must supply the AST from the checked execution
of that source; this helper is not a replacement for core execution receipts or
source-hash rechecks.

Each candidate records source hash, wrapper ID, original chunk ID, slide ID,
chunk hash, output-envelope hash and normalized data-spec hash. The wrapper ID
is stable across renders; the random HTML widget ID is excluded from visual
identity. The output-envelope hash may change merely because htmlwidgets
generated a new ID; use `specHash` to compare the actual projected chart data.

The original QMD remains authoritative. `plotlyStaticElement(bundle, context)`
returns a plain Bento image containing only an SVG data URI, plus
`origin: computed` and the verified producer. No code, iframe, runtime
dependency or widget callback enters BentoDoc. Chart data is never a candidate
for reverse-writing into R source.

## Supported and refused content

The first adapter supports bounded two-dimensional SVG **scatter and bar**
traces with explicit finite x/y arrays, ordinary labels, selected trace styles
and one x/y axis pair. Up to 32 traces and 10000 entries per array are admitted.
Payloads are bounded to 2 MB and nesting to 24 levels. Width is a fixed 800 CSS
pixels; height comes from the verified widget envelope (100–1600 pixels). The
containing Bento image can scale the vector fallback without changing computed
content.

HTML, MathJax labels, unknown fields, map/GL traces, animations, extra axes,
customdata/crosstalk keys, custom highlighting, image layers, network resources,
htmlwidgets `evals` and `jsHooks` refuse. This intentionally does not execute
`htmlwidgets.js`, Shiny bindings or arbitrary widget HTML. R's nonvisual
bookkeeping (`visdat`, `attrs`, default event names, etc.) is not executed.
Empty axis-title arrays and null frame markers are normalized to their
equivalent Plotly.js representation. Config removes cloud/export modebar
buttons; native hover, zoom, pan and ordinary selection remain local.

Unknown htmlwidgets require a separate adapter and an explained fallback; they
must not disappear because the candidate collector returned an empty list.
Integration must continue refusing any remaining unsupported raw output.

## Runtime, static export and sandbox

The user supplies installed dependencies; nothing installs or manages an R or
browser environment. The current verified local pin is:

- Plotly.js 2.25.2, SHA-256
  `419deebe105f4c993feb7e6d1fe94fb1c2f7f98716db5d9b8fe3e37773838898`
- its supplied MIT LICENSE, SHA-256
  `67a26cf80f03ff388f26945dfc1f6caed1a0746ff43871190339b3aee49b94bb`

The pin is checked before executing any supplied runtime; other bytes fail
closed. The runtime is **not downloaded** and is not vendored into this
repository. The produced Presenter includes its runtime and license. Broad
public release still needs the project-wide dependency/license audit; this
experiment does not claim that audit.

`snapshotPlotly` uses an already installed Chromium executable, a temporary
fresh profile, `--headless --dump-dom` and a bounded timeout. The page renders
only in an iframe with `sandbox="allow-scripts"`; it has no same-origin, top
navigation, popup, form, download or storage grant. Its CSP denies networking,
external fonts, objects, workers and nested frames. JavaScript is restricted to
the adapter nonce and its bundled data script. Data and HTML boundaries are
escaped. Messages are accepted only from that exact child window, opaque origin
and per-document token.

The SVG result is checked before publication: only supported SVG tags,
attributes, styles and local fragment references pass. Script/event handlers,
external references, embedded images, CSS escapes, image-set functions and
unknown styles refuse. Independent review supplied two CSS bypass cases (escaped
`url` and `image-set`); both have permanent regression tests. A fallback is
checksummed and verified again before Presenter/static-element construction.

`loadPlotlyBundle(serialized, { source, expectedReceipt, runtime })` requires
the current original QMD plus a **separate trusted generation receipt**. It
compares the complete bundle hash, rescans source and verifies the wrapper, sole
producer, slide, source/chunk hashes, data spec, SVG and dependency bytes.
Static-element and Presenter construction require the same source/receipt
context. Recomputing hashes inside a modified bundle cannot pass the separately
retained receipt. The core must obtain that receipt from its checked generation,
never derive it from the untrusted bundle at load time; `createPlotlyReceipt` is
for newly captured results. Binding the receipt to project/docId/generation
publication remains a core hook.

`createPlotlyPresenter` is a self-contained, single-widget host with an explicit
static/interactive switch and static print CSS. Its UI does not grant the widget
access to Studio/project state. Enhanced full-deck Presenter orchestration is a
separate integration step.

## Minimal integration hooks

1. After checked Quarto execution, call `collectPlotlyCandidates` with the
   original source snapshot. It does not require changing `capture.lua`; the
   needed JSON already survives in RawBlock. Source guards and execution
   receipts remain in the core.
2. Resolve the Plotly runtime/license from a compatible local dependency, verify
   the exact pin, and call `snapshotPlotly`. Do this before publishing a
   generation; rendering failures must leave the previous published deck/state
   intact.
3. Project the returned static element with its computed origin at the original
   wrapper position, applying existing stable-ID visual overrides. Do not merely
   remove all raw blocks. Every candidate must be consumed once, and
   unrecognized output must still refuse.
4. Publish the JSON bundle as a generation-scoped widget sidecar, tied to
   source, producer, document and generation receipts. Persist the built
   Presenter/resource hashes with the same generation. No core sidecar
   transaction is implemented by this module yet; it returns reviewable values
   to the caller.
5. Add an explicit Studio/Presenter action to open the isolated host; standalone
   Bento and PDF retain the pure-data SVG image. Regeneration replaces the chart
   and sidecar while preserving the image's visual state.

## Validation

```sh
deno test --allow-read --allow-write --allow-run --allow-env \
  tests/widget_test.ts tests/widget_execution_test.ts
deno lint src/widgets tests/widget_test.ts tests/widget_execution_test.ts
deno check src/widgets/*.ts
```

Seven unit tests cover provenance, refused payload features, active/external
SVG, spec and fallback tampering, current source/producer versus external
receipt, and wrong runtime pins. The real execution test runs Quarto, validates
a scatter SVG, changes CSV data and proves changed spec/SVG with unchanged
QMD/chunk hashes, then validates a bar SVG. It requires the compatible R Plotly
package, pinned local JS and Chromium; it is skipped when Deno run permission is
absent, not silently claimed as passed. No full repository suite was run in this
worktree.
