# Bounded display-math codec evidence

Verified 2026-10-11 on Linux with Deno 2.9.6 and Quarto 1.10.19. This is a codec
and mapping test, not integrated Studio/round-trip acceptance.

## Native representation

The pinned Bento 1.2.6 revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` keeps
LaTeX inside the `html` field of an ordinary native text object.
`slides/src/render.ts` resolves fields, sanitizes HTML, then renders the formula
to MathML. Its `maths/delimiters.ts` recognizes display `$$…$$` and `\[…\]`;
formulas can cross attribute-free `<br>`, `<div>` or `<p>` line breaks. There is
no native math object and rendered MathML is not the stored semantic source.

`src/render/math.ts` preserves LaTeX as HTML-escaped literal text inside
`$$…$$`. Line endings become `<br>` for the native text model. No renderer,
script, network dependency or upstream fork is introduced.

The deliberately bounded LaTeX vocabulary includes common Greek letters,
relations, functions/operators, braced fractions/radicals/fonts/accents,
subscripts/superscripts, matched scalable delimiters and aligned/matrix/cases
structures. Unknown commands, macros, unsupported environments, unescaped TeX
comments, nested math delimiters, Typst and incomplete structures refuse with
`UNSUPPORTED_MATH`. Fields such as `{{page}}`, Quarto shortcodes and Markdown
backticks also refuse. The exact supported command vocabulary is in the module;
it is not a promise of general TeX conversion. Limits are 16,000 body
characters, 16 body lines and 64 nested groups.

Reverse conversion accepts exactly one standalone display formula with balanced
attribute-free line markup. It refuses prose before/after the formula, multiple
formulas, attributes, other HTML (including rendered MathML), invalid entities
and source-structure expansion. Source text such as `<script>` inside `\text{…}`
is escaped and remains literal text.

## API and integration boundary

- `mathToNativeHtml(tex, display = true)` returns canonical native text HTML;
  `display = false` refuses. Inline equations remain a separate integration.
- `parseNativeDisplayMath(html)` returns `tex`, canonical `html`, a complete
  `source` block, and a `normalized` flag. Boundary whitespace and CRLF are
  normalized; the formula interior is preserved.
- `nativeDisplayMathToSource(html)` returns a complete `$$` QMD block for an
  explicitly reviewed insertion.
- `MATH_CODEC_VERSION = 1` can identify the provenance baseline.

For an existing mapped math block, patch **`tex` into the original math content
span**, with the original expected content. Never replace that body with the
complete `source` block; the existing scanner deliberately refuses inserting
`$$` into a math body. The ordinary source patch layer restores the file's
newline convention and closing-delimiter separator. A caller must verify
authored provenance, unique stable mapping, current source/baseline,
normalization review and approval before applying any patch. Computed output
must not become an authored equation merely because it contains delimiters.

Installed Pandoc preserves leading/trailing LF inside `Math.c[1]` for a `$$`
block whose delimiters are on separate lines. Compare formula contents through
the codec rather than assuming that AST value is already trimmed. Real Quarto
preserves an explicit div anchor around an authored display formula. The current
original-source scanner still needs a `qb` marker on the math block itself to
mark that block stable; an enclosing div ID alone does not provide a stable math
source ID. A safe first fixture is:

```markdown
::: {#equation}

<!-- qb:eq-main -->

$$
\frac{\alpha + x^{2}}{1 + \sqrt{y}}
$$

:::
```

## Verification

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/math_test.ts
deno check src/render/math.ts tests/math_test.ts
deno lint src/render/math.ts tests/math_test.ts
```

Six tests pass: literal escaping and reversible formulas; native multiline
markup; HTML/prose/source expansion refusal; invalid/unsupported syntax refusal;
real installed Pandoc AST plus bounded UTF-8/CRLF source patch; real Quarto
execution retaining an authored anchored display formula. The two external-tool
tests are explicitly skipped without run permission.

A separate local harness called the pinned upstream strict `renderMath` and
`resolveMathHtml` implementations. All eight representative formulas (fraction,
Greek operators, scalable fences, Unicode/literal HTML, aligned rows and
matrices) produced MathML through the native delimiter path. A further 160
supported command examples produced strict MathML. These checks are runtime
engine/delimiter evidence; they do not establish browser font, visual layout,
native edit, save/reopen or integrated safe sync acceptance. The coordinator
must still integrate projection/sync and perform that UI loop.

## Integrated project loop

`src/render/project.ts` projects a paragraph containing exactly one display
`Math` as a centered native text object using this codec. A preceding `qb`
marker identifies the original math block; an enclosing div can identify the
math ordinal. For an unwrapped anonymous formula, initial mapping requires a
unique exact original expression; later changed-source identity rules still
require stable evidence. Authored formula contents must match their original
mapped math block. Executed computed formulas retain their verified producer and
never gain authored provenance. Mixed/inline equations and formula syntax
without a separately mapped original math block explicitly refuse.

Existing single-object wrapper visual attributes apply to the formula and remain
source-owned. Geometry and typography without QMD declarations use the ordinary
durable overrides. Provenance records `mathCodec: 1`. Sync reviews only the
mapped authored formula body and supported attribute patches; native `div`/`br`
line markup is canonized through the normal approval record so a fresh approved
render can clear pending changes without silently changing an unapproved native
edit. Original math delimiters and unrelated QMD bytes remain in place. Creating
a new equation through ordinary text/new-slide conversion currently refuses and
requires authoring its math block in QMD first.

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/math_test.ts tests/math_execution_test.ts
```

The eight integration tests cover:

- real Quarto projection of a stable identified formula; native model edit and
  save; pending LaTeX/typography surviving a fresh render; exactly bounded CRLF
  body/attribute sync; clean recompute with the same docId and retained
  geometry;
- independent QMD/Bento formula edits, refused overwrite, recoverable pending
  content, reviewed `keep-bento` reconciliation and subsequent safe sync;
- real Quarto refusal for mixed math/prose, display math without a mapped math
  block, and as-is computational output before its producer runs;
- synthesized executed computed math preserving its producer and refusing sync;
- mismatching executed/authored formula provenance refusal;
- ordinary text/new-slide conversion refusing to invent a mathematical source
  representation;
- distinct original identities for marked/ordinal math siblings and native
  equation IDs, including wrapper design bindings.

HTML, source-delimiter, executable-fence and unsupported-command injection
attempts keep the QMD unchanged. These tests use native JSON edits to exercise
core save/sync behavior; they do not replace a native contenteditable/browser
check. Inline math, general TeX, source equation labels/cross-references and new
Bento-authored equation insertion remain outside this supported subset.
