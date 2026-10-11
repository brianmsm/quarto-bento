# Native simple-table projection

Verified on Linux with Quarto 1.10.19, Deno 2.9.6 and pinned Bento 1.2.6
revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (2026-10-11). This slice
covers executed projection, persistent design and provenance. A real native
Chromium DOM/runtime check verifies one five-row default layout; the coordinator
also inspected the native two-slide save/recompute workflow below. It does not implement reverse
synchronization of table cells into QMD.

## Native contract and fidelity

The pinned upstream `slides/src/model.ts` defines the real `table` element with
`columns[].w`, `rows[].cells[].html`, per-cell alignment, a header flag and a
table style. `slides/src/render.ts::renderTableHtml` uses the same HTML table
renderer for the editor, thumbnails, Presenter and print. Cell HTML passes
through the native sanitizer. The adapter escapes plain cell text before
constructing the native object; it never converts cell data to executable HTML
or approximates numeric strings as numbers.

The codec preserves rectangular rows, empty cells, one header row (or none for
computed AST input), left/center/right alignment and positive explicit width
weights. All-default columns receive equal weights. Mixed default/explicit
widths, merged cells, multiple header/body sections, row headers, footers,
captions, rich cell content and unmapped attributes refuse with a diagnostic. No
rows, metadata or content are silently dropped. Initial projection uses a
conservative single-line width bound (two font-size units per Unicode code
point), and derives row height from the pinned font size, line height, padding
and borders plus a rounding margin. Cells exceeding that bound, and whole tables
exceeding the remaining slide height, refuse with `UNSUPPORTED_TABLE_LAYOUT`.
This is a deliberately bounded default layout; arbitrary fonts and wrapped-cell
layout require separate measured support. User-authored size/style overrides
remain visual authority and can change the fit; the adapter does not claim to
validate every later native layout edit.

## Authored source

```text
## Data {#data}

::: {#summary}
| Group | N |
| :--- | ---: |
| Alpha | 12 |
| Beta | 5 |
:::
```

The supported original format is one contiguous pipe table with explicit outer
pipes, at least three dashes per separator cell and a single identified fenced
div containing no other blocks. Cells contain literal plain text; escaped
punctuation can remain literal. Rich Markdown or transformations that differ
from the exact original text refuse. Visual frame attributes can use the
existing single-object wrapper mechanism.

The original scanner continues to call the table fragment `unsupported` for
reverse mapping. It is **not reclassified by matching an ID**. A separate parser
reads the original bytes, verifies the unique wrapper and literal noncomputed
fragment, and independently compares every cell, header and alignment against
the executed native projection. `validateProjectionOrigins` repeats this proof.
The verified origin is authored, while the source kind remains unsupported for
reverse synchronization.

Editing authored cells in Bento produces a durable pending semantic change. Save
and a render with unchanged source retain it. `previewSync` refuses the
unsupported reverse conversion; it does not rewrite QMD. If the source table
also changes, strict render refuses publication and fresh reconciliation exposes
the conflict. Geometry and table-wide styles retain their usual visual
authority.

## Computed source

````markdown
## Data {#data}

::: {#computed-table}

```{r}
#| label: table-maker
#| echo: false
knitr::kable(read.csv("data.csv"), format="pipe", align=c("l", "r"))
```

:::
````

Quarto can erase an ordinary chunk label from its executed cell wrapper. The
adapter therefore accepts an exact original producer identity, or a uniquely
identified original wrapper containing **one explicitly labelled executable
chunk and nothing else**. A displayed-code block, competing chunks or unmapped
output cannot satisfy this proof. Executed cell context remains computed, and
the native table records the original producer.

Use a non-`tbl-` label for this first slice. A `tbl-` label can introduce a
Quarto table float and automatically generated caption; that associated-caption
mapping is currently refused. `kable(format="pipe")` is demonstrated. Raw HTML
tables, `gt`, `gtsummary` and broader widget/static fallback formats are not
implemented by this adapter.

Changing the CSV and recomputing updates table cells while retaining the native
position, size and table-wide style. Editing a computed cell produces a computed
conflict. Source sync refuses; code and inputs remain unchanged.

## Evidence and current limits

`tests/table_test.ts` covers native schema acceptance, escaped HTML-like text,
empty cells, header/alignment/width fidelity and structural/rich-content
refusal. Header toggles are semantic pending edits, including computed
conflicts; they cannot become visual overrides that mask the source. Long or
tall initial tables refuse explicitly before publication. It tests independent
original-source proof, altered source metadata, mismatched cells and unmapped
producers. Real Quarto/knitr tests cover:

- Authored CRLF pipe table -> native table -> save/reopen -> retained cell
  pending -> explicit sync refusal -> independent QMD edit -> visible conflict.
- CSV -> native computed table -> changed data -> fresh cells with retained
  geometry/style -> computed cell edit -> conflict and no reverse source write.
- Rich cells and captions refusing before publication, without source changes.

Independent review regenerated the real emitted native HTML for a five-row
fixture in headless Chromium. Both the editor and thumbnail measured wrapper
`clientHeight = scrollHeight = table.offsetHeight = 280`; a Range around the
last cell's text stayed inside the wrapper. This resolved the original
`h = 44 * rows` clipping defect. The reviewer also independently confirmed that
toggling a computed header produces `pending` with `path: ["header"]`,
`origin: computed`, `status: conflict`, and no visual override. These are
DOM/runtime measurements, not a claim of visual inspection or arbitrary
content/font fit.

Run:

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/table_test.ts
```

This slice deliberately supports one table per source wrapper/producer. Table
cell reverse mapping, captions and complex tables need further adapters. Native
row data, including per-cell visual fields, and column weights currently use the
state core's conservative semantic classification; edits to those compound
fields can therefore remain pending/conflicted. The demonstrated design loop
covers outer geometry and table-wide styles. Splitting cell content from cell
appearance remains future work and is not a claim of this slice.

## Integrated native save/recompute acceptance

The reproducible input is `examples/native-tables/{deck.qmd,data.csv}`. The
coordinator copied it to an isolated project, opened Studio, and used native
Bento controls (no fabricated document mutation) to:

1. Move the computed table to `x=120,y=230`, set width to `1040`, and change its
   table-wide style from Boxed to Minimal.
2. Edit the authored table's Alpha cell from `12` to `13` and save. QMD still
   contained `12`; the rows edit was durable pending content. Review disabled
   Apply and explained that this reverse conversion is unsupported.
3. Change only the CSV's Alpha value from `12` to `17` and use Recalcular.
4. Reopen Studio in an explicitly headless Chromium instance. The computed table
   displayed `17` with the same `120,230,1040,168` frame and Minimal style. The
   authored `13` edit remained pending; the original QMD table remained `12`.

The durable state reached revision 5, retaining docId
`84bc984e-6863-424e-a978-63f585ac3a0a` and exactly one pending authored rows edit.
Both native three-row tables measured `clientHeight=scrollHeight=168`. The
coordinator captured and visually inspected
`output/playwright/native-tables-authored.png`,
`native-table-sync-refusal.png`, and `native-table-recomputed.png`.
All rows were visible in the demonstrated default and changed-style layouts.
Screenshots are local acceptance artifacts, not runtime dependencies.

This is Linux Chromium evidence of real editor behavior, visual review and
durable state comparison. It does not certify arbitrary resizing, per-cell
appearance retention, cell reverse sync or native OS file dialogs.
