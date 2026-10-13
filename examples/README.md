# Examples

These small projects demonstrate the documented Linux development workflows.
They use explicit, bounded adapters; they do not imply support for arbitrary
QMD, HTML, or widgets. Some authored sample content is in Spanish. The usage
guides are in English and preserve the Spanish labels currently used by Studio.

Copy a complete example directory to a disposable project before experimenting.
Keep one QMD presentation per directory and retain its accompanying CSV/SVG
inputs. From the repository root, render or open an example with:

```sh
deno task qbento render examples/semantic-roundtrip/deck.qmd
deno task qbento edit examples/semantic-roundtrip/deck.qmd
```

Use the copied `deck.qmd` path when working outside the repository. Deno 2 and
Quarto must already be installed. Examples with R computation also need a
compatible R/knitr environment; Quarto-Bento does not install or manage
packages. See the [usage guide](../docs/USAGE.md) for save, reviewed
synchronization, recalculation, capture, and rebuilding from Git.

## Source content and computation

| Example                                            | Demonstrates                                                                                                               | Additional runtime requirements                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Semantic round-trip](semantic-roundtrip/deck.qmd) | Authored rich text, displayed code, equations, speaker notes, and an SVG figure recomputed from CSV                        | R/knitr                                                  |
| [Native lists](native-lists/README.md)             | Ordinary nested/numbered Markdown lists; native editing, reviewed identity acquisition, creation, conversion, and deletion | R/knitr for the inline computed total                    |
| [Local images](plain-images/deck.qmd)              | Local self-contained SVG and authored caption mapping                                                                      | No computation runtime                                   |
| [Python computation](python-computation/README.md) | Python figure/total execution through Quarto/knitr, explicit interpreter selection, and preserved design                   | R with knitr/reticulate; existing Python with matplotlib |

## Tables and charts

| Example                                                  | Demonstrates                                                           | Additional runtime requirements              |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| [Plain Markdown tables](plain-tables/deck.qmd)           | An ordinary authored pipe table without prepared identities            | No computation runtime                       |
| [Native tables](native-tables/deck.qmd)                  | Authored and CSV-computed native table content                         | R/knitr                                      |
| [Tables in cards and layouts](composed-tables/README.md) | Native tables measured in source cards and a two-column layout         | R/knitr                                      |
| [Rich computed tables](rich-tables/README.md)            | Complete 2x PNG fallback preserving source formatting for gt/gtsummary | R/knitr, gt, gtsummary, Chromium             |
| [Native charts](native-charts/deck.qmd)                  | Authored bars and a CSV-computed straight-line chart                   | R/knitr                                      |
| [Charts in cards and layouts](composed-charts/deck.qmd)  | Measured native bar/line composition with authored/computed provenance | R/knitr; Chromium for browser validation     |
| [Offline Plotly](plotly-offline/deck.qmd)                | Static SVG in Bento and a separate offline interactive Presenter view  | R/knitr, compatible Plotly runtime, Chromium |

Table and chart codecs retain authored/computed provenance. Reverse table-cell
and chart-option changes have their documented synchronization limits; they
cannot silently rewrite producer code. See the
[table evidence](../docs/evidence/TABLES.md),
[chart evidence](../docs/evidence/CHARTS.md),
[composed-chart scope](../docs/evidence/COMPOSED-CHARTS.md), and
[Plotly scope](../docs/evidence/PLOTLY.md).

## Components, graphs, and layouts

| Example                                              | Demonstrates                                                                        | Additional runtime requirements                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Cards and columns](components/deck.qmd)             | Source-authored cards and a named two-column layout with text and a computed figure | R/knitr                                                 |
| [KPI components](kpi/deck.qmd)                       | Explicit label/value/detail roles with literal and computed values                  | R/knitr                                                 |
| [KPIs in cards and layouts](composed-kpis/README.md) | Measured KPI composition and retained design after data changes                     | R/knitr                                                 |
| [Source graphs](source-graphs/README.md)             | Bounded diagrams, a fork, QMD-ordered timeline, and explicit relationship controls  | R/knitr and Chromium for this example's complete render |
| [Reusable layouts](reusable-layouts/README.md)       | Apply a named layout to existing native text/image/table/chart objects              | R/knitr                                                 |

Computed values remain linked to their producers. Studio-created KPI values are
literal text; use QMD expressions for computed values. Graph relationships use
source IDs and supported topology; native grouping does not infer semantic
membership. Applied free-object layouts retain a geometry snapshot and require
explicit reapplication after a registry definition changes.

## Acceptance boundaries

Save persists `.qbento/` state and pending edits. Reviewed synchronization
writes QMD. Recalculate executes source and combines its results with retained
design. Preserve pending work when a diagnostic refuses unsupported conversion.

The [implementation ledger](../docs/IMPLEMENTATION_STATUS.md) records exact
versions and acceptance layers. The current objective was tested locally on
Linux. Windows/macOS qualification is future work, and public source publication
does not establish a complete v1 product release. The
[acceptance gaps](../docs/ACCEPTANCE_GAPS.md) describe remaining codec and
release boundaries.
