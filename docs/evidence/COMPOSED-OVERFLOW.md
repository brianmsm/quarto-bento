# Overflow diagnostics after visual composition

Focused Linux evidence, 2026-10-11. This is a diagnostic correction; it does not
change source authority, saved geometry, synchronization or persistence schemas.

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

The existing vertical box criterion remains: `y + h` exceeding the page height,
or nonpositive height. The bound now uses the composed document's `size.height`,
including native page-size overrides already supported by Save. The pinned
upstream renderer sets its surface height from `doc.size.height`
(`slides/src/render.ts`, line 1343 at pinned revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`). This is not an estimate of rendered
text, shadows, rotation, horizontal overflow or content clipping. Decorations
retained in `bentoOnly` are checked because they are present in the composed
document.

## Focused verification

```bash
deno test --allow-read --allow-write --allow-env --allow-run tests/overflow_test.ts tests/overflow_execution_test.ts tests/render_test.ts
# 12 passed on Linux; /tmp/qbento-composed-overflow-final.log
```

Two unit regressions check replacement of stale warnings without mutation or
loss of other diagnostic categories, duplicated element IDs across slides,
nonpositive height, exact boundary and a smaller native page frame. Two real
installed-Quarto regressions check corrected retained authored geometry, a saved
authored element outside the frame, a retained decorative element outside the
frame, a taller native frame of 900 px, and ordinary Quarto publication
reporting only the current composed overflow. Source bytes remain unchanged.
Eight existing projection tests also pass.

Type checking, lint, formatting and diff checks pass for the five changed code
and test files. No full-suite, browser visual, hosted CI or native macOS/Windows
claim is made here. The coordinating integration owns the final acceptance run.
