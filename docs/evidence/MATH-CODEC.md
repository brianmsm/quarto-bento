# Bounded display-math codec evidence

Verified 2026-10-11 on Linux with Deno 2.9.6 and Quarto 1.10.19. This document
records codec, source mapping and integrated project tests. The separate
[combined native evidence](SEMANTIC-ROUNDTRIP.md) records the Studio edit,
reviewed QMD patch, reopen and changed-data regeneration in the actual editor.

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

Eight portable tests pass: literal escaping and reversible formulas; native
multiline markup; HTML/prose/source expansion refusal; invalid/unsupported
syntax refusal; the delimiter/script and literal-text regressions below; real
installed Pandoc AST plus bounded UTF-8/CRLF source patch; real Quarto execution
retaining an authored anchored display formula. The two Quarto/Pandoc tests are
explicitly skipped without run permission. A ninth, optional test imports the
actual pinned Bento renderer only when `QBENTO_BENTO_SOURCE` points to a local
checkout and run permission is present; its HEAD must match
`vendor/bento/pin.json`. Ordinary regression tests have no dependency on `/tmp`
or an upstream checkout.

A separate local harness called the pinned upstream strict `renderMath` and
`resolveMathHtml` implementations. All eight representative formulas (fraction,
Greek operators, scalable fences, Unicode/literal HTML, aligned rows and
matrices) produced MathML through the native delimiter path. A further 158
currently supported command examples produced strict MathML after excluding
`textbf` and `textit` as described below. These checks are runtime
engine/delimiter evidence; native visual and editing checks are recorded
separately in the combined evidence linked above.

## Conservative native fidelity restrictions

The review regressions were verified directly against the pinned parser, using
its runtime `lenient: true` mode as well as strict positive examples. The codec
now refuses the following constructs with `UNSUPPORTED_MATH` in both directions:

- After `\left`/`\right`, command delimiters are limited to `\{`, `\}`, `\|`,
  `\langle` and `\rangle`; raw `(`, `)`, `[`, `]`, `|` and `.` also remain
  supported. The aliases `\lvert`, `\rvert`, `\lVert` and `\rVert` still work as
  ordinary symbols, but the pin reports `bad delimiter` when they follow a
  scalable delimiter command.
- Environment openings, `\\` row breaks, `&` cell separators and `\left`
  openings cannot be script bases. For example, `\begin{matrix}\\^x\end{matrix}`
  and `\begin{matrix}^&\end{matrix}x` have native `script without base` errors.
  A cell separator cannot be the argument of a script either. A completed matrix
  or matched scalable fence can still carry a script, as in
  `\begin{matrix}x\end{matrix}^2` and `\left(x\right)^2`.
- `\text`, `\textrm` and `\operatorname` groups accept plain Unicode literal
  text, but no commands or escapes inside the group. The pin prints `\text{\$}`
  as literal `\$` and `\text{\quad}` as literal `\quad` in MathML, so accepting
  them would imply a fidelity guarantee the renderer does not provide. Plain
  text such as `\text{Málaga: a b "q"}` retains its words and visible spacing;
  Bento emits nonbreaking spaces in its MathML text node.
- `\textbf` and `\textit` refuse. Bento treats their contents as mathematical
  fonts: `\textbf{a b}` produces adjacent mathematical letters with the word
  space removed. Native text typography is the supported styling route; the
  codec does not silently transform these commands. The separate mathematical
  font commands remain bounded mathematical expressions.

Reproduce the native engine test against any locally available checkout at the
pin, without fetching dependencies or changing the checkout:

```sh
QBENTO_BENTO_SOURCE=/path/to/local/bento deno test \
  --allow-read --allow-write --allow-env --allow-run \
  --filter 'pinned Bento renderer' tests/math_test.ts
```

For this correction, all nine codec tests passed with the pinned checkout,
including exact native MathML fragments that expose the text loss. Both new pure
regression tests also passed with no granted filesystem, environment or
subprocess permissions. This is parser/text fidelity evidence within the stated
subset, not proof of general TeX support or native visual acceptance.

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

## Reviewed acquisition of anonymous display equations

An ordinary anonymous `$$` block no longer blocks an unrelated prose or notes
sync merely because that sync changes the global source hash. A fresh independent
Pandoc fragment proof confirms one faithful display formula. Explicit preview and
Apply acquire a technical wrapper with the existing native object ID, preserving
formula bytes and any unselected pending formula edit. Recompute verifies the
approved new binding before retaining native appearance. Save/render alone never
pin an identity. The real CRLF/Unicode round trip and HTML-free reconstruction
are exercised in `tests/weak_math_identity_test.ts`; see the
[plain-QMD evidence](PLAIN-QMD.md#ordinary-display-equations-and-fenced-code).
