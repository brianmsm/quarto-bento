# Computed rich-table static fallback: adapter and integration evidence

The adapter in `src/rich/table.ts` captures the executed HTML/CSS of a bounded
`gt` table, including the `gt` output of `gtsummary`, as a **2x PNG**. It
preserves spanners, grouped headings, rich inline text, alignment, formatted
numbers and notes without flattening them into the native simple-table schema.
This is raster output, not SVG/vector output and not an editable native table.
The API returns an explicit `STATIC_TABLE_PNG_FALLBACK` diagnostic explaining
that content and formatting must be changed in the source producer.

The adapter is integrated with `renderProject` and the guarded ordinary Quarto
extension. Each render creates fresh captures, embeds PNG bytes directly in
native Bento image objects, and publishes the source binding and stable content
receipt in the checksummed project state. It creates no persisted rich-table
bundle and never reloads a self-authenticated candidate. Doctor reports the
optional local Chromium version. Independent review includes a real native Bento
slideshow smoke check for a simple `gt` fixture; the richer fixture capture and
integrated state proof are detailed below.

## Verified environment and supported input

Verified on Linux with Quarto 1.10.19, Deno 2.9.6, R/knitr 1.51, `gt` 1.3.0,
`gtsummary` 2.5.1 and Chromium 152.0.7977.82. The project's pinned Bento
revision is `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`; this adapter has not yet
been verified inside its native image/presentation renderer.

The current slice requires an explicit stable slide and a standalone wrapper
whose opening line is exactly `::: {#id}`. The wrapper contains exactly one
explicitly labelled executable chunk and no other source content. The chunk must
emit exactly one ordinary non-echoed cell/display result. Additional output,
classes/attributes on those wrappers, captions implemented through Quarto float
wrappers, card/layout nesting and arbitrary authored HTML are outside this
slice. A literal authored HTML fragment cannot borrow a computed producer
through its ID or through caller-supplied source-mapping metadata.

````text
## Results {#results}

::: {#summary}
```{r}
#| label: summary-maker
#| echo: false
gt::gt(read.csv("data.csv")) |>
  gt::tab_header(title=gt::md("**Grouped results**")) |>
  gt::tab_spanner(label="Statistics", columns=c(N, Mean)) |>
  gt::fmt_number(columns=Mean, decimals=2)
```
:::
````

`gtsummary::tbl_summary(data, by=arm) |> gtsummary::bold_labels()` follows the
same contract when it produces its ordinary `gt` HTML output. This does not
claim support for every option of either R package.

## Exact executed fragment and execution boundary

Quarto's captured AST represents the verified output as three adjacent nodes:

1. A raw HTML opening `div` with an ID, inline container styles and scoped CSS.
2. A Pandoc `Table` with class `gt_table`, rich cells, spans and table sections.
3. A raw HTML closing `div`.

The ordinary extension capture occurs before Quarto's final descaffold pass and
can add exactly one anonymous `Div` with only class `quarto-scaffold` around
those three nodes. This exact, attribute-free wrapper is transparent in Quarto
1.10.19's installed `finalize_combined_1` filter and is accepted. Additional
classes, attributes, siblings or nested scaffold layers refuse. Both capture
routes have real execution tests.

The adapter retains all three meaningful nodes. It uses the captured Pandoc API
version and `quarto pandoc --from=json --to=html5 --wrap=none` to write **only
this fragment**. This HTML writer does not execute R and does not rewrite any
QMD source. It is separate from the prohibited whole-document Markdown rewriting
approach.

Collection rescans the original QMD bytes, verifies the source hash, stable
wrapper and slide, and identifies the original singleton producer chunk. It
hashes the chunk and exact captured output. Snapshot creation rejects mutated
candidate blocks when their output receipt no longer matches. The executing
caller remains responsible for supplying the AST from its fresh execution of
that source; this module does not authenticate an AST supplied by an adversary.

## Headless offline capture and bounded layout

`src/browser/chromium.ts` launches only a local installed Chromium in headless
mode, with a private temporary profile and a loopback-only ephemeral CDP port.
It has a bounded deadline, graceful shutdown with a kill fallback, and private
profile cleanup. It does not disable the Chromium sandbox or install a browser,
Node package, R package or environment manager.

The static table page has JavaScript execution disabled before its contents are
loaded, a `default-src 'none'` CSP with inline styles only, and all network URLs
blocked. The adapter's own fixed CDP inspection expression can measure DOM and
font layout; no producer script is executed. Unsupported script/image/link tags,
event attributes, CSS imports, `url(...)`, `image-set(...)`, CSS escapes and
unscoped styles cause refusal, not stripping or substitution. This also refuses
remote Google Fonts and SVG/data-URL resources instead of silently replacing
meaningful external content. Only the original single `gt` stylesheet scoped to
its own container and a bounded set of static table/formatting tags are
accepted.

Animated, positioned, transformed, independently scaled/rotated/translated,
zoomed, filtered, masked, shadowed, generated-content or invisible text layouts
are refused. Color and WebKit text-fill alpha are checked for fully transparent
text. These guards do not certify arbitrary color contrast or every CSS layout
that a future package version could generate. Source-provided static formatting
within the accepted subset is preserved unchanged.

The capture width is 1120 CSS pixels. Its natural full height must fit the
caller's remaining frame (534 CSS pixels by default). The complete table box and
every nonblank text range must lie inside the capture; text must also remain
inside any clipping/scrolling ancestor. Tables are never automatically shrunk,
clipped, paginated or truncated. Main text must be at least 10 CSS pixels;
ordinary short `gt_footnote_marks` superscripts are measured separately and can
be smaller, down to 8 CSS pixels. The receipt records both minimum sizes.
Oversized tables should be split in the source, or handled by a future explicit
pagination adapter.

PNG dimensions are twice the measured CSS width/height. Rendering uses the
installed system font stack requested by the original `gt` CSS. Evidence is
limited to this host and browser; identical pixels across different operating
systems, fonts or Chromium versions are not promised. Native image resizing by a
user later in the editor needs separate layout validation.

## Fresh API and required integration contract

`collectRichTableCandidates(ast, scanSource(qmd))` returns fresh candidates.
`snapshotRichTable(candidate, options)` returns PNG bytes, a receipt and the
explained fallback diagnostic. Options can identify an installed Chromium, bound
the operation deadline and reduce the remaining frame height.

The receipt contains source/wrapper/producer/slide identity, source/chunk/output
hashes, HTML/PNG/text hashes, browser version, CSS dimensions, pixel ratio, row
and cell counts, and minimum text sizes. These are traceability and change
checks, not a self-authenticating signature.

The integrated projector re-collects candidates against the same executed AST
and original source, verifies each in-memory output/HTML/PNG receipt and PNG
header dimensions, and consumes each wrapper exactly once under its original
slide. The native image identity is `<wrapper>/table-fallback`; its origin and
semantic binding name the original computed producer. It preserves the natural
1120-by-height frame without shrinking it. Placement also refuses when preceding
content leaves insufficient space above the slide's 20-pixel bottom margin.

Fresh raw output/HTML hashes include random `gt` CSS IDs. They are verified
before projection but deliberately are **not** persisted into semantic
provenance: otherwise identical recomputations would make reviewed
reconciliation stale. The published `provenance.source.richTable` contains the
stable source/wrapper/ producer/chunk binding, PNG/text hashes, dimensions,
browser and row/cell/font metrics. The generated baseline and emitted PNG remain
in checksummed state, and the normal output publication receipt protects the
generated HTML. No raw output is normalized and no label or CSS ID is rewritten.
A future external bundle loader would require its own trusted receipt; none is
supplied here.

Native position and size edits follow existing visual ownership and survive
changed-data render. Native `src` edits are semantic computed conflicts and stay
recoverable. They cannot be synchronized back into R or CSV. The existing
reviewed `previewReconcile`/`applyReconcile` path can explicitly detach an
image; same-input recomputation remains stable, while changed data between
preview and apply invalidates the plan. Detachment remains visibly labelled
through render and relocation.

Chromium is an optional dependency only when this fallback is needed. A missing
executable produces `CHROMIUM_REQUIRED`; a hung operation produces
`CHROMIUM_TIMEOUT`. `qbento doctor` now reports `chromium` availability
alongside Quarto/R. Existing native table/chart and ordinary text paths do not
start a browser. No package or environment is installed automatically.

## Evidence and reproduction

Run only the focused tests:

```sh
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/rich_table_test.ts tests/rich_table_project_test.ts
```

The suite executes real Quarto/R producers, then runs real Chromium headlessly:

- Grouped `gt` output preserves the bold title, spanner, decimal formatting,
  column footnote and source note, with all 8 rows and 14 cells.
- `gtsummary` preserves its bold characteristic labels, missing-value row,
  grouped headers and footnote, with all 14 rows and 40 cells.
- Source bytes remain unchanged. A counter records one R execution per actual
  render and no additional execution during fragment writing or snapshots.
  Changing only the CSV updates negative numbers and labels including
  `A < B & "C"` and `Málaga`, changes both PNG/text hashes, and retains the same
  source/chunk hashes.
- PNG headers match the exact 2x receipt dimensions. Missing browser and stalled
  capture paths are tested. Forged source metadata, stale hashes, borrowed IDs,
  additional output and unsupported wrapper attributes refuse.
- Real browser adversarial cases exercise imports/resources, script/image tags,
  escaped CSS, hidden/transparent text, independent CSS scale, oversized output,
  small fonts and clipping. No source file is rewritten on refusal.

A separate feasibility probe compared the HTML fragment with the final Quarto
container after removing unrelated slide headings. Both were rendered in the
same headless Chromium context with JavaScript disabled and requests blocked.
The respective PNGs were byte-identical: `gt` hash
`6f539cc57dd979f1d14e4d4ef6d9bd90266c53d5a9ccb1db8315c83975602f67`, `gtsummary`
hash `d89e74557fb2ca43c6f01e8631829689ed6eb53eb824bc7a1eea48161acaa6d6`. This is
equivalence for these isolated fixtures, not proof for arbitrary Quarto HTML or
inherited themes.

The probe also inspected cell text, font weight/size, row/column spans and full
bounds, with no resource requests. Natural wrapper dimensions were 1120 by 260
CSS pixels for `gt` and 1120 by 518 for `gtsummary`; minimum body text sizes
were 13.6 and 14.4 CSS pixels, with 9-pixel footnote marks. The implementation's
own CDP PNGs were visually inspected and showed complete titles, values, rules,
spanners and notes. Probe files are local temporary evidence under
`/tmp/qbento-rich-table-probe`; committed tests rebuild independent fixtures and
do not depend on those temporary paths.

Independent review inspected both positive PNGs and reproduced the initial
independent-CSS-scale and transparent-text gaps; the final guards reject these
cases and the focused suite includes regressions. A separate probe of the real
browser helper and the same three isolation controls observed no producer script
execution and zero hits on its own loopback resource endpoint, despite one
blocked resource attempt appearing in CDP. The deadline probe ended at 1.823
seconds for a 1.8-second deadline, with no surviving probe PID or profile. This
is bounded runtime evidence for those probes, not a general browser sandbox
security certification.

`tests/rich_table_project_test.ts` uses the canonical
`examples/rich-tables/{deck.qmd,data.csv,participants.csv}` fixture with CRLF
source and explicit execution counters. It proves complete native PNG
projection, unchanged-input pixel stability, saved geometry and docId across
changed CSV, computed image conflicts and refused source sync, successful
reviewed detach, stale-plan refusal after a data change, uncaptured HTML
protection before R, and regeneration after moving the project and removing
generated build/output. The ordinary `quarto render` path separately proves one
execution per producer, the same HTML guard before execution, capture/recompute
and preserved design. All source and R code bytes remain unchanged by these
operations.

Independent integration review changed QMD while the Chromium snapshot was
starting. Publication refused with `SOURCE_CHANGED`, preserving the prior state
and HTML bytes. The reviewer also reproduced and revalidated the volatile-hash
reconciliation issue: after the stable published subset fix, real preview,
detach, apply and render retained the manual image and detached status with the
same docId and source. A separate explicit-headless offline native Bento smoke
check rendered a simple `gt` image at x80/y166/w1120/h183, entered Slideshow and
visually confirmed its title, values and footnote. Its screenshot is temporary
review evidence at `/tmp/output/playwright/rich-native-offline.png`. That native
smoke is distinct from the full rich fixture capture/structural tests and does
not certify arbitrary later user resizing or cross-platform fonts.

Final focused validation: 6 tests and 4 nested steps passed in 1m24s.
`deno task check`, targeted lint, and staged whitespace checks passed. No
full-suite result or cross-platform acceptance is claimed by this slice.
