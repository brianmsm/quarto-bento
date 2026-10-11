# Bounded source diagrams and timelines — Linux implementation

The source adapter reads original QMD membership and relationships before
computation. The native projection is verified against the exact original Pandoc
fragment, and shape provenance is closed to the declared graph roles and
reserved native IDs. The implemented contract and example are in
[the graph example README](../../examples/source-graphs/README.md).

Validation uses local Quarto 1.10.19, Deno 2.9.6 and Bento revision
3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b (1.2.6). Typography uses an installed
Chromium headless private profile and the pinned offline shell. It measures CSS
line boxes, scroll width and DOM Range glyph extents, including saved built-in
font faces. It does not claim painted ink/effects or cross-platform equivalence.
Unsupported automatic native math/document fields and glyph overlap/anchored
overhang refuse; boxes never silently shrink text.

Focused source/state tests cover DAG/timeline membership, exact UTF-8/CRLF
endpoint patches, manipulated/stale plans, foreign/dangling endpoints,
duplicates, cycles, dynamic labels, semantic endpoint ownership, visual side
anchors, decoration isolation, pending removals and incompatible renderer
mutations. Strict composition preserves pending state and refuses native graphs
with missing parts or lost label/connector renderers. Timeline relationship
edits require explicit restoration, independent of their native z-order.

Real Quarto integration tests exercise a three-node fork and timeline, native
document Save, combined label/endpoint preview/apply and regeneration after
changed R input. They verify stable docId, updated figure content, retained
native position/fill/group state and source-authored relationship changes.
Timeline source block reorder changes derived adjacency while native z-order and
node design survive. Source conflicts, stale reviewed source, cyclic prospective
endpoints and derived-link edits refuse without QMD writes.

Negative execution tests place a file-writing R sentinel behind an inline
computed graph label and prove the computation/output was never published.
Measured font/height overflow, low line-height glyph overflow, omitted native
alignment, disjoint collinear edges and retained built-in font resources have
regressions. Both six-member layouts fit their measured literal labels; crossing
unrelated edges and paths through foreign nodes refuse. Source flow signatures
distinguish media/dynamic paragraphs from constant-height authored text so a
stale automatic base cannot authorize a source patch.

The focused command below passed 49 tests (6 graph source/state, 6 real
execution, 5 shared native metrics, 21 existing state and 11 existing sync) in
50 seconds:

    deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/graphs_test.ts tests/graphs_execution_test.ts tests/measurement_test.ts tests/state_test.ts tests/sync_test.ts

The source graph example also rendered with stable document identity
31c9e46b-9b36-4c6a-83ee-e33c413f4b29, no pending edits and no adapter
diagnostics. An independent Linux headless native review loaded its emitted HTML
in Chrome/152.0.7977.82. All four slides loaded with no discarded objects,
automatic text fitting, refitting or expansion. Native diagnostics had zero
warnings and errors; the title box at x=80 produced an informational margin
suggestion. Actual SVG line/arrow markers were inspected, and the graph
screenshots showed readable attached labels without observed clipping or
overlap. The original HTML hash, source hash, DOM rectangles, labels, SVG markup
and native load reports are retained in
[the native DOM receipt](graphs-linux/native-dom.json).

![Three-node native fork](graphs-linux/0-options.png)

![Two-node native diagram](graphs-linux/1-process.png)

![Four lexical milestones](graphs-linux/2-sequence.png)

The integration tests exercise the saved native document/core API, and the
separate headless review establishes native DOM and screenshot evidence. Native
foreground editor interaction and macOS/Windows acceptance remain separate
validation layers. This slice does not claim a universal graph layout, arbitrary
HTML conversion or a full product release.
