# Overflow diagnostics after visual composition

Focused Linux evidence (2026-10-11; bounds extended 2026-10-13). This is a
diagnostic correction; it does not change source authority, saved geometry,
synchronization or persistence schemas.

## Corrected behavior

Previously, `projectAst` checked the generated geometry before saved visual
state was composed. Eight ordinary paragraphs produced three `OVERFLOW`
warnings. Moving and resizing all retained paragraph boxes to fit through
`saveProject` did not clear those warnings, even though the published document
had no overflowing element. The new real regression failed with those exact
three stale warnings before the correction.

The shared `refreshOverflowDiagnostics` replaces only `OVERFLOW` using the
actual document geometry and preserves every other diagnostic. `projectAst` uses
it for the initial projection; core render uses it again on `composed.document`,
the document published to native HTML. Ordinary `qbento-html` publication uses
that same core path. Each warning contains both `slideId` and `elementId`, so
identical element IDs on different slides remain unambiguous.

The vertical rule still reports `y + h > size.height` and nonpositive heights.
Final composed boxes now check all four page edges: `x < 0`,
`x + w > size.width`, `y < 0`, and `y + h > size.height`, while retaining the
nonpositive-height diagnostic. Exact edge contact is accepted. The comparison
uses both dimensions from the composed document, including native page-size
overrides supported by Save. A zero-width line wholly inside the page is not
flagged just for having zero width; width is not otherwise validated here. This
checks axis-aligned box coordinates only. It does not estimate rendered text,
shadows, rotation, painted ink or content clipping. Decorations retained in
`bentoOnly` are checked because they are present in the composed document.

## Focused verification

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/overflow_test.ts tests/overflow_execution_test.ts tests/render_test.ts
# 15 passed on Linux; /tmp/qbento-overflow-four-bounds-final.log
```

Unit regressions check replacement of stale warnings without mutation or loss of
other diagnostic categories, duplicated element IDs across slides, nonpositive
height, all four edges, exact boundary contact, a zero-width line, and different
native page sizes. Real installed-Quarto regressions check corrected retained
authored geometry, saved elements beyond each edge, a retained decorative
element at the exact boundary, wider and taller native frames, and ordinary
Quarto publication reporting only current composed overflow. Source bytes remain
unchanged. Existing projection tests also pass.

The focused test run, lint, formatting and diff checks pass for the changed
source and test files. No full-suite, browser visual, hosted CI or native
macOS/Windows claim is made here. The coordinating integration owns the final
acceptance run.

## Multiple computed images in one slide

A second runtime regression reproduced a separate failure in the same path. Two
real Quarto R chunks with visible code and SVG plots placed the second image
after the available canvas space. Before the fix, projection failed with
`BentoContractError: /slides/0/elements/4/h: Below minimum 0`, before saved
geometry could be composed and the figure moved.

Default image frames now use a 100 px minimum when the remaining vertical space
is exhausted, while retaining the existing explicit `contentFrame.h` and the
natural 400 px height when that much space remains. The minimum permits Bento to
load the deck and lets the final composed-geometry diagnostic report an image
that still extends below the slide. It does not shrink content or clear overflow
automatically.

The real Quarto regression verifies two computed image elements have positive
heights and that initial `OVERFLOW` targets match exactly the elements whose
bottom edge is below the 720 px canvas, including the second figure. It then
saves all source-backed geometry inside the canvas, changes the CSV inputs and
renders again. Both computed images retain their exact saved geometry and
producer identities, the document `docId` stays stable, the SVG data changes,
the source QMD remains byte-identical, and the overflow warning clears. A final
save that leaves one code object at `y=700` retains one warning for that object
only.

Focused Linux verification:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/overflow_execution_test.ts
# 3 passed, 0 failed
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/overflow_test.ts tests/render_test.ts
# 11 passed, 0 failed
deno fmt src/render/project.ts tests/overflow_test.ts tests/overflow_execution_test.ts
# 3 files checked
```

The AST regression separately checks the natural 400 px image frame when
sufficient space is available. These checks validate source projection, geometry
persistence and diagnostics; they are not a visual inspection of the native
Bento canvas and do not claim full-suite or other-platform acceptance.
