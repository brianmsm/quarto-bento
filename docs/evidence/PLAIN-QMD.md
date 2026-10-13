# Plain QMD mapping and reviewed identity acquisition

Local Linux execution and core-runtime evidence, 2026-10-11. The implementation
starts at `0bf0d9c`, using Quarto 1.10.19, Deno 2.9.6 and the vendored Bento
1.2.6 revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. This receipt
establishes the source/runtime boundary. The subsequent integrated native
edit/save/reopen/review/recalculate and changed-data checks are recorded in
[plain-QMD and KPI native acceptance](PLAIN-KPI-NATIVE.md).

## Problem and resulting behavior

A plain paragraph containing `**bold**` or inline code previously failed its
initial projection because raw Markdown was compared with native inline HTML. An
ordinary literal paragraph could save and synchronize, but the next render
failed `AMBIGUOUS_IDENTITY`: the approved patch changed the global source hash
while anonymous source bindings remained weak.

Original authored heading/paragraph fragments now pass through the installed
Pandoc Markdown reader, without executing Quarto. Its supported inline HTML must
match the executed projection exactly. The original heading also binds each
native slide; unlabelled paragraph matching is unique within that same original
slide. Identical paragraphs on different slides remain distinct. Ambiguous
repetitions within a slide, computed fragments and unknown origins refuse.

An explicit sync plan proposes technical identity acquisition for every weak
authored binding affected by the global hash change, including untouched and
unselected paragraphs. Heading attributes retain the existing native slide ID
and explicitly bind the native title ID. Each weak paragraph receives a globally
unique identified wrapper and an explicit `bento-element-id`, retaining its
existing slide-local native ID. The parser preserves Unicode IDs, combining
marks, UTF-8 spans, CRLF and existing generic-div ancestry. These technical
patches are shown separately from authored text and optional annotations.

Identity acquisition runs before semantic/structural patches so their anchors
are stable. Source, state and plan checks still run before application. Save,
render and preview do not write the QMD. Application retains all pending edits
until fresh execution verifies the approved source and content.

The approval carries typed exact old/new provenance and expected native text.
`prepareApprovedSync` verifies the result source hash, selected pending edits,
old provenance, fresh provenance and fresh inline HTML before rebinding only the
listed targets. The existing `assertProjectionIdentity` guard then runs
normally. Coincident IDs alone do not authorize a rebind. Standalone text
insertion can compose with this same reviewed acquisition.

Studio displays every identity patch first, including unchanged weak blocks,
with exact before/after source. Content, notes, attributes, structure and
optional annotations follow in their application order. The complete proposed
QMD is visible even when an identity plan has no structural operation. Review
prepares the explicit Apply button; it does not invoke application itself.

## Reproduction and checks

The checked-in `tests/plain_qmd_test.ts` covers real Quarto execution with two
plain Spanish slides, rich headings and paragraphs, an untouched paragraph, the
same rich paragraph on the other slide, a labelled R SVG and an execution
counter. Selected title/body synchronization acquires five bindings while
retaining an excluded pending edit and its geometry. Reopen, changed CSV data,
SVG regeneration and a second sync retain native IDs, `docId`, source chunk
bytes and saved design, ending with zero pending changes. Preview and apply do
not increase the execution counter. Minimal/default and detailed annotations
also compose with accented and combining-mark heading IDs.

Directed negative cases cover modified identity plans even with a recomputed
plan hash, stale source/state, malformed or checksum-modified approvals,
wrong/missing fresh bindings, wrong fresh content, and selected pending edits
changed after apply. Refusals retain QMD, project state and output. Weak
unsupported authored kinds (for example an unpinned display-math block) refuse
before source application when a global source change would invalidate them;
they require their existing explicit source-authoring contract.

Author-run focal commands:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/sync_test.ts tests/inline_test.ts tests/render_test.ts tests/core_test.ts
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/plain_qmd_test.ts tests/text_insertion_test.ts
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/plain_qmd_test.ts tests/source_test.ts tests/source_structure_test.ts \
  tests/annotations_test.ts tests/sync_structure_test.ts
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/studio_sync_review_test.ts tests/studio_client_diagnostics_test.ts
```

The first command passed 26 tests; the second passed 9 tests; the third passed
50 tests (including the repeated 5 plain-QMD cases). The client command verifies
the complete shipped Studio client with DOM/transport doubles and a real plain
sync plan, including untouched weak blocks, exact phase order and QMD result,
identity-only review enablement and no automatic application. Source/test type
checking, changed-file lint and formatting also pass. No full-suite run is
claimed here. The client command passed 4 tests. The runs contain 84 distinct
focal tests in total, with no failures.

An independent reviewer ran real-QMD harnesses in `/tmp` for CRLF, selected
title/body edits, default annotations, excluded pending content, CSV/SVG
recomputation, native image geometry, duplicate rich headings with Pandoc's
automatic suffix, and two weak children in a generic div. The last case retains
slash-containing native child IDs. Independent rejection tests preserved exact
QMD/state/output for altered plans, stale source/state, invalid approvals and
incorrect fresh bindings. These are execution/core-runtime checks, not a native
UI or visual-fidelity claim.

## Integration notes

The deletion slice must compose after the identity phase. This branch excludes
targets selected for deletion from acquisition; surviving weak bindings are
acquired before semantic/structural validation and final projection. The
integrated deletion approval's state hash must be checked against the original
post-apply state before the prepared state is cloned, normalized or rebound. The
deletion slice and its mixed integration case need their separate evidence.

This work does not freeze public v1 acceptance or establish other-platform
behavior. Exact upstream/custom-reader differences outside the checked faithful
inline subset remain explicit refusals rather than inferred source content.

## Ordinary display equations and fenced code

The reviewed identity path also covers anonymous authored display equations and
non-executable fenced code. Initial displayed-code mapping compares the exact
Pandoc-read original fence content and language with one executed object in the
same verified original slide. Equal code in different language fences remains
distinct; repeated equal content and language within a slide refuses ambiguity.
This path never derives an authored binding from echoed executable code.

A selected prose or notes edit acquires the other affected weak math/code
identities too, including objects with unselected pending edits. The inspected
technical patch adds a wrapper and `bento-element-id` while retaining the original
formula/fence bytes. Save and render do not add it. Approval verifies fresh
formula HTML or code content **and language** before retaining the previous native
ID and appearance. An authored formula or code edit uses the existing bounded
content-span codec after the same identity review. Component children still
require explicit source identities where wrapping would change their structure.

`tests/weak_math_identity_test.ts` exercises real local Quarto sync/recompute and
reconstruction from QMD plus `.qbento/state.json`, without generated HTML. Its
math fixture includes Unicode, CRLF, notes, an unselected equation edit and an
unchanged executable producer; the code fixture retains native geometry and
language through a selected prose sync followed by the pending code sync. Checks
also cover stale/modified plans, collisions, component scopes and altered or
cross-slide code provenance. This is core-runtime evidence, not a new native
Studio interaction receipt or evidence of general TeX support.

An acquired stable identity does not grant permission to move executed content
across source scope. Fresh authored projections must still belong to the same
verified original slide. Identified source wrappers also retain their original
identified ancestry; transparent anonymous divs do not invent an ancestor ID.
This closes a reviewed filter case that moved an intact math/code wrapper to a
second slide or inside another source wrapper. Real Quarto tests reject both
moves after reviewed acquisition and from a cold project, retaining existing
QMD/state/HTML byte-for-byte and publishing no state/HTML for the cold refusal.

### Native ordinary-math/code acceptance and integration

The identity and source-scope changes are integrated at `f3f4127` after
**30 independent tests** and real Lua probes of both cross-slide and same-slide
ancestor relocation. Those probes reject after reviewed identity acquisition as
well as on a cold render.

The coordinator exercised Studio and pinned Bento in headless Chromium on the
reviewed runtime `4f09f76`: a plain two-slide QMD contained rich prose, an
anonymous display formula and a static `r` fence. A native prose edit survived
Save and reload with unchanged QMD. Review showed all four heading/paragraph/
math/code identity patches before Apply. After Recalculate the entire emitted
native document matched the saved document exactly, with stable `docId`, zero
pending edits and unchanged formula/code source. The second slide's body stayed
byte-identical; its optional design annotation was explicitly shown in review.

A relocation containing only QMD, `project.json` and `state.json` also rebuilt the
exact document. The final screenshot was inspected: rich beta, formula and both
syntax-highlighted code lines are visible and readable. This checks editing
neighboring prose without obstruction; math/code content-edit coverage remains
in the separate source/core and earlier native receipts.

Local artifacts: `output/verification/plain-math-code-native/`, including source,
saved/final state, receipts and independent logs. Screenshots are
`output/playwright/plain-math-code-review.png` and
`output/playwright/plain-math-code-final.png`. This is headless Linux browser
acceptance, not foreground desktop or other-platform evidence.
