# Source-first KPI evidence

This slice implements original-QMD `.bento-kpi` components on the owner's Linux
machine. It does not establish native creation of semantic KPIs, nested KPI
composition, another operating system, or a release acceptance boundary. Native
visual acceptance of label editing, changed-data recomputation and computed
conflict restoration is recorded in the subsequent
[integrated native receipt](PLAIN-KPI-NATIVE.md).

## Exact supported source contract

Use one explicitly identified `.bento-kpi` at the top level of a source slide.
It contains exactly two or three direct identified fenced divs in this order:
`bento-role="label"`, `bento-role="value"`, optional `bento-role="detail"`. Each
child contains exactly one paragraph, has a globally unique explicit ID, and
uses no additional classes. Unknown attributes, repeated/missing roles,
reordered roles, duplicate IDs, nested content and multiple paragraphs refuse.
Implemented text visual attributes can be declared on role wrappers; coupled
geometry belongs to the outer component.

```text
:::: {#metric .bento-kpi}

::: {#metric-label bento-role="label"}
Observed mean
:::

::: {#metric-value bento-role="value"}
`r sprintf("%.2f", mean(values))`
:::

::: {#metric-detail bento-role="detail"}
Calculated from project data.
:::

::::
```

Label and detail contain literal authored text in the bounded native inline
vocabulary. Value can be literal or a single-line ordinary Quarto inline
expression; shortcode and unsupported inline constructs refuse. The actual
installed Quarto executes computations. This adapter does not coerce numeric
text, round, localize, or add `countUp`. A literal `β = .32` remains that exact
text; formatting a computed result belongs to its source expression.

Native Bento mathematical and document-field markers (including reserved fields
in hyperlinks) transform literal semantics. They are outside this KPI slice:
canonical/entity-decoded math or field markers in literal, executed or retained
native text refuse `NATIVE_TEXT_TRANSFORM_UNSUPPORTED` before publication. The
previous output and durable pending edits remain recoverable.

Native text IDs are `${slotId}/paragraph:1`; the decorative rectangle is
`${kpiId}/qb-kpi-background`. All generated objects initially use the flat
`groupId=kpiId`. Default font sizes are 26, 52 and 22 pixels for label, value
and detail. Native cards/layouts enclosing a KPI currently refuse
`KPI_SOURCE_CONTEXT` rather than overwriting the KPI's grouping contract.

## Meaning, design and measurement

Authored label/value/detail edits use the ordinary bounded paragraph sync path.
Save does not change QMD. A computed value retains its original inline paragraph
receipt and fresh source hash; no producer chunk is fabricated. Editing that
rendered value produces a recoverable computed conflict. Review offers source
restoration or explicit detachment, never replacement of executable producer
source with a number.

A source-checked decorative background remains authored presentation even when
its containing div's aggregate scanner classification is computed. The guard
checks the original `.bento-kpi`, complete role structure, exact background ID,
native rectangle type and grouping. It does not trust `designOnly` by itself.

Explicit QMD visual fields retain source ownership. Independent fields, such as
background fill or a role's font size, retain exact opener bindings and bounded
attribute patches. Parent geometry and inherited styles are coupled; moving one
child cannot safely establish an inverse parent edit and remains pending with
`UNMAPPED_DESIGN`. Unspecified native positions, sizes, styles and background
properties remain ordinary saved overrides through recomputation and rebuild.

KPI rendering requires an installed compatible Chromium in addition to Quarto,
Deno and the source's computational packages. The shared `render/measure.ts`
helper launches the existing private headless Chromium helper, loads the pinned
offline Bento shell and measures real native text styling at final width. It
loads saved document fonts/assets, forces layout and waits for local font
readiness. It uses the same inline-code CSS, wrapping, typography and line
height as the pinned native renderer. It measures both the inner CSS box and DOM
`Range` rectangles: very small line heights can make a CSS box much shorter than
the font bounds. The returned preferred height adds symmetric vertical slack
plus four pixels for rounding, and width includes the horizontal union and
scroll width. Omitted native line height uses CSS `normal` and a real same-style
single-line probe; omitted font family comes from the composed theme. Actual
pinned DOM tests also establish the inherited 16 px size, normal weight and
start alignment. Explicit breaks and conservative `Range` fragment counts still
detect multiple lines when a zero or very small saved line height collapses the
CSS box to zero. These are browser text/layout bounds, not a claim about
arbitrary painted effects or rotated ink. No cloud, font download, environment
manager or runtime installation is performed.

A taller outer box cannot move a glyph protruding above top-aligned text, below
bottom-aligned text, or separate overlapping lines. Initial KPI text with those
measured conditions refuses `KPI_TYPOGRAPHY_UNSUPPORTED`; increase explicit
`line-height`. A centered single-line role can instead use the preferred height
to contain the measured vertical bounds. This alignment boundary is checked in
both fresh projection and the composed native document.

Initial source layout that cannot contain measured text refuses
`KPI_CONTENT_OVERFLOW` before replacing the published output. After saved
geometry/pending content has been composed, insufficient native text boxes or
unsupported saved line metrics emit an actionable `KPI_CONTENT_OVERFLOW`
diagnostic. The saved design and content remain retained; typography is never
implicitly reduced. Existing page-boundary `OVERFLOW` diagnostics remain
available. These measurements are runtime evidence on this Linux browser/font
environment, separate from human visual acceptance.

## Focused reproducible verification

Quarto **1.10.19**, Deno **2.9.6**, pinned Bento revision
**3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b**.

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/measurement_test.ts tests/kpi_test.ts \
  tests/kpi_execution_test.ts
```

At implementation commit `f0ec53e`, the final focused command passed **11 tests,
0 failures** in **1 minute 12 seconds**. Source type checking, focused lint and
format checks also passed. Three separate existing card/layout/code component
regressions passed **3 tests, 0 failures** in 11 seconds. The canonical example
rendered with zero pending edits and no diagnostics. These are local execution
receipts; native visual acceptance remains separate.

The final glyph-overhang/defaults follow-up's focused command passed **15 tests,
0 failures** in **1 minute 38 seconds**. Type checking, focused lint and format
checks passed. Shared helper commits are `4405da4` and `72e70b8`; the final five
measurement tests also passed separately in two seconds. Independent review
matched helper bounds to actual pinned native top/bottom/centered/alignment-
omitted DOM and confirmed saved collapsed-line diagnostics through core,
preserving exact text, box, typography, pending edits and QMD. On this
browser/font environment, the 300 px Arial `A` regression returns a 3 px line
box, 167/166 px top/bottom overhang and a 341 px preferred height (including
symmetric slack and rounding).

The focused tests prove:

- Literal text, default fonts, exact role/native IDs, flat grouping and actual
  pinned Bento JSON contract validation.
- Wide `WWWW` at 52 px in a 150 px box measures 134 px including the rounding
  allowance, rather than the disproven 71 px estimate. Accents, inline code and
  explicit line breaks use real native wrapping. A saved built-in Fraunces font
  alias changes the measured 20-character `i` sample at 120 px from 199 to 264
  px.
- `A` at 300 px with `line-height=0.01` has a 3 px CSS inner box while native
  `Range` font rectangles extend over 336 px. The helper returns that overhang;
  initial top/bottom-aligned roles refuse without replacing previous output or
  state. Centered multiline overhang also refuses. Centered single-line text
  receives sufficient symmetric space. Saved extreme native metrics, including
  omitted vertical alignment and centered multiline line heights of zero or
  `0.00001`, retain their exact box, content and pending edits while emitting a
  diagnostic. Omitted native typography is compared with actual pinned DOM,
  including a composed-document font family rather than a guessed fallback.
- A real R inline value changes from `20.00` to `200.00` after CSV changes while
  saved value/label geometry, typography, background and `docId` survive.
- A counter increments once per actual `qbento render` and once for an installed
  ordinary `quarto render`; source sync preview/apply does not execute it.
- Authored label sync changes exactly its paragraph bytes; source outside the
  reviewed patch and producer code remain intact. Removing generated HTML and
  rebuilding retains the saved deck's identity and design.
- Computed edits refuse reverse synchronization and exercise both restoration
  and explicit detachment through the existing reconciliation API.
- Independent source-owned background fill sync, recoverable ambiguous parent
  movement, initial overflow refusal with previous output/state/source retained,
  and retained small native boxes with measured overflow diagnostics.
- Invalid roles, missing/duplicate IDs, unknown child attributes, stale source
  hash, transformed/mismatched executed roles, forged decorative IDs/grouping,
  unsupported inline mathematics, native automatic math/document-field strings,
  field-bearing link attributes and nested KPI context refuse.

The canonical source and data are `examples/kpi/deck.qmd` and
`examples/kpi/data.csv`. Render a fresh temporary copy for native inspection;
the example's literal and computed values are on separate slides. No
complete-suite claim is made for this focused implementation.
