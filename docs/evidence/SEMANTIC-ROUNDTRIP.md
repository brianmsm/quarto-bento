# Native combined semantic round-trip

Verified on 2026-10-11, Linux, at `ba0843d`, using Deno 2.9.6, Quarto
1.10.19, R 4.6.1 and the pinned Bento shell. The combined automated suite at
that revision passed **202 tests, zero failures**. This browser check adds
native interaction and visual evidence to those tests.

The reproducible input is `examples/semantic-roundtrip/deck.qmd` and its
`data.csv`. Copy that directory to a temporary working directory and run from
the repository:

```sh
deno task qbento edit /absolute/path/to/copied/deck.qmd
```

This fixture combines an inline code span, link and strikeout, a displayed
non-executable R code object, an identified display equation, plain speaker
notes and an R-generated SVG on a second slide. It needs compatible installed
R packages for Quarto execution; qbento does not install them.

## Native edit and reviewed source patch

The browser opened the Studio URL and double-clicked the rendered equation in
the actual Bento editor. Its native contenteditable field contained LaTeX.
Replacing it with `$$\frac{\alpha+x^{3}}{1+y}$$` and choosing **Guardar
proyecto** retained the edit without changing QMD. **Revisar cambios** displayed
the old and new body under `eq-main`, without replacing the div, marker or math
delimiters. Applying that plan changed only the formula body's text. Closing
the review and choosing **Recalcular** reopened the equation as native MathML,
with the exponent visibly changed to 3.

The native notes textarea retained both Spanish paragraphs. The displayed code
kept both lines and syntax highlighting; the link, inline code and strikeout
remained visible. State revision 4 had no pending edits. Source-owned `x=84`
and all element geometry remained unchanged.

## Changed-data regeneration

Changing the last CSV value from 40 to 60 and choosing **Recalcular** produced a
different embedded SVG, retained both slide IDs and every element's geometry,
and preserved the edited formula, code, rich text and notes. State revision 5
had no pending edits. The `docId` remained
`cbedbcae-669c-49e8-ac8c-56ac738003a2` throughout this local run.

The SVG data URI SHA256 changed from
`7a16d8512febfaa37c860a86a7cd918ed6a719cd170ca0cb3d2b42307d5dba6c`
to `b3441dfbc00d421bc2f128c7a9f20861718c4a355566defbd90fce012cadc91e`.
This hash difference is regeneration evidence; the browser inspection supplies
the separate visual check.

Local, ignored screenshots were captured and viewed:
`output/playwright/native-math-review.png` and
`output/playwright/native-math-reopened.png`. The changed-data SVG was also
inspected in `output/playwright/native-combined-figure.png`, showing the last
point at 60. The test fixture directory was
`/tmp/qbento-semantics-native-zukv4z3g`; those temporary files are not a durable
project dependency. This evidence does not extend the bounded math vocabulary,
prove general TeX conversion or establish other operating systems' behavior.
