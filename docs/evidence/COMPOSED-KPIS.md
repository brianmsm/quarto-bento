# Native KPIs inside cards and layouts — Linux receipt

Runtime commit: `027d1acf16734e1df84f5bbb9733fe3b25394d2e`, based on the
composed-table runtime in `1605a37`. This extends the original standalone
[KPI contract](KPI.md) to bounded source-authored cards/layouts. The reproducible
[example](../../examples/composed-kpis/deck.qmd) and
[instructions](../../examples/composed-kpis/README.md) include an inline R mean
from CSV inside a card, a weak card heading, and a literal KPI directly in the
second layout column.

## Source and native composition contract

A KPI still needs the original identified wrapper and complete identified
label/value/optional-detail roles. Its only permitted ancestors are identified
original `.bento-card` and `.bento-layout` wrappers on the same source slide,
outside execution output. Projection checks the executed ancestor IDs, parent
chain, classes and attributes against original source. It derives native flat
group membership from the outermost verified component; it never infers source
membership from an arbitrary native group. Background and role provenance checks
also verify that source-derived group and slide.

KPI text is measured by the real pinned Bento text renderer at its final slot
width before enclosing component placement. A card allocates the remaining
height after its other rows. Measured KPI objects move by translation with exact
unit scale. Their widths, heights and typography cannot be changed afterward by
parent fitting or inherited parent text styles. Declare typography on the KPI
or its roles. Competing child geometry, transformed ancestors, unsupported
wrappers, and parent styles that change measured metrics refuse before
publication.

QMD retains semantic and explicitly declared visual authority. The inline value
keeps its original computed paragraph receipt; no synthetic chunk producer is
created. Saving visual overrides leaves QMD unchanged. Computed text edits
remain conflicts; literal role edits use the existing reviewed paragraph path.
A weak heading can retain design through data-only execution, while source text
changes still require checked identity acquisition.

When new computed text exceeds default capacity, complete verified saved
role typography can rescue a frame whose geometry is unowned by QMD. The
fresh source baseline keeps its default metrics; temporary measurement sets
exclude rescued baseline text only while calculating parent flow. Saved
role boxes are composed later and checked for actual readability. These sets
are internal renderer state, not new BentoDoc fields or durable source proofs.
Source-owned KPI or enclosing frame geometry prevents capacity rescue: the
adapter refuses rather than publishing default role boxes outside that slot.
Source-owned typography also cannot be replaced by a pending native font edit.

## Execution and browser evidence

The exact runtime's seven focused tests passed with zero failures in 1m45s.
An independent combined run of `composed_kpis_test.ts`, `kpi_test.ts` and
`kpi_execution_test.ts` passed 17 tests with zero failures in 1m51s at the
same runtime SHA, covering the standalone regressions as well.
They cover real Quarto/R execution, changed CSV values, exact saved appearance,
full emitted-document rebuild, computed conflict refusal, authored conflict
preservation, unowned capacity rescue, source-owned font/frame refusal, and
executed ancestor attribute mutation. Refusal regressions compare QMD, previous
published HTML and durable state to prove no publication or loss of saved work.

```sh
QBENTO_COMPOSED_KPIS_EVIDENCE=output/verification/composed-kpis-027d1ac \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/composed_kpis_test.ts
```

Native screenshots `initial.png`, `changed-data.png` and `rescued-data.png`
were independently inspected. Both KPIs, the enclosing card heading, and every
role are visible. Changing the input mean from `20.00` to `200.00` retains the
saved smaller green value and its displacement. The separate long-value case
shows all 60 `score` tokens at saved 12px typography, with the detail and
following `After KPI.` paragraph still visible and separate.

The harness loads the shipped offline pinned Bento shell in installed headless
Chromium. It calls the normal core save/recompute APIs to record appearance;
these captures do not establish a manual Studio save interaction. Measurement
assertions require actual native text width/height and glyph overhang to fit
every role's box. The left KPI's content width is 448px and the right KPI's is
496px. Initial preferred role heights are 36.5/69/31.5px. The changed saved
value measures 48.796875px against its retained 70px box; the rescued five-line
value measures 99.9375px against its retained 210px box. No measured vertical
glyph overhang occurs in these examples. The JSON DOM `font` field records the
outer native object wrapper's inherited 16px font, not the inner text's role
font; typography claims come from the checked document and renderer measurement.

Local artifacts, tests/static-check logs and SHA-256 hashes are under
`output/verification/composed-kpis-027d1ac/`; generated images are not committed
source files. Environment: local Linux, Quarto 1.10.19, R 4.6.1, Deno 2.9.6,
Chrome 152.0.7977.82; Bento revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

## Remaining boundaries

This receipt covers source KPI composition and existing role semantics. It does
not establish arbitrary native grouping, inferred parent reverse transforms,
unbounded HTML/text composition, native chart composition, manual foreground
Studio acceptance, PDF, another operating system, or public release acceptance.
The existing safe-refusal boundaries preserve pending work; they do not prove
support for a refused product workflow. Integration with newer execution
provenance and chart composition changes requires combined verification at the
integrated runtime commit.
