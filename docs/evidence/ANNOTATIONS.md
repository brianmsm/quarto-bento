# Controlled QMD annotations

Implementation evidence, 2026-10-11. This is a bounded annotation workflow, not
an automatic source formatter or a claim that the full product is complete.

## Contract and ownership

Original QMD frontmatter uses `qbento-annotations: none|minimal|detailed`.
Absent means `minimal`; the previously proposed nested format option is
unavailable. A metadata-only `quarto pandoc --from markdown --to json` process
receives only the original frontmatter, never the body. No Quarto render,
execution, filters or project hooks are added by the configuration check.
Quarto 1.10.19 `inspect` preserved the namespaced top-level key in the source
metadata and HTML format metadata; real parser tests verify all three levels,
quoted scalars and refusals.

The source module changes only the optional `.qbento-design` class on H2 slide
headings and supported one-line JSON reference comments directly following
those headings. Existing explicit IDs, source-owned attributes, other classes,
semantic blocks and content remain intact. Detailed comments contain controlled
feature names and sidecar paths, never geometry, themes' values, executable
content or new ownership declarations. `none` removes supported optional traces
through the same reviewed operation.

The core derives requests from saved overrides, decorations, stacking and
selected native creations. A validated active registry theme signals all source
slides; a used registered layout signals its slide. Unused registry entries do
not create traces. Both the native registry loader and annotation snapshot hash
the original bytes, including a UTF-8 BOM, and reject malformed UTF-8. The
registry schema comes from the shared `src/render/registry.ts` implementation,
not a parallel annotation schema.

## Safe synchronization

Every optional patch appears in `SyncPlan.annotations.patches` and as a
`visual-annotation` review item. Omission diagnostics are present both in
`annotations.diagnostics` and visible `annotation-diagnostic` items; Studio
renders them alongside exact patches, and CLI JSON retains them. Sync receipts
record the level, applied annotation patch count and diagnostics. Recovery
validates this optional summary and reconstructs it exactly; older journals
without summaries remain supported.

Preview remains read-only. Apply reconstructs the complete plan, checks original
QMD/state/registry snapshots, applies bounded UTF-8 byte patches, and publishes
through the existing fsynced backup/journal transaction. Semantic pending edits
remain until a later real execution confirms them. Annotation-only sync is
supported, but a diagnostic-only no-op cannot claim successful annotation
publication. Existing approved semantic normalizations that preserve QMD bytes
continue to work.

Optional traces are omitted when heading IDs are unpinned, a saved native slide
cannot identify the original source slide, an attribute syntax cannot be
verified, or a source hash change would invalidate retained weak identities.
No IDs are pinned automatically. Explicit source identity migration remains a
separate operation; the omission preserves current source and pending edits.
Malformed/conflicting/duplicate/misplaced reserved comments refuse instead of
being normalized. Literal namespace text in YAML/code/chunks/math is ignored.

## Verification

The focal tests cover CRLF and Unicode, surgical preservation of existing
attributes, detailed-to-minimal/none cleanup, stale/tampered plans, registry
changes, malformed comment/config preservation, literal YAML/code namespace,
escaped unrelated attributes, weak/unmapped source diagnostics, raw registry
hash compatibility including BOM, and metadata-only non-execution.

Real Quarto loops verify Save/render leave the QMD unchanged, annotation-only
apply, mixed semantic/annotation exact patches, stable technical IDs and native
geometry across recompute, semantic normalization with unchanged source bytes,
and finish of an interrupted annotation transaction with exact source backup
and validated receipt summary. Prior notes/math/design/component exact-source
expectations now include the independently reviewed default-minimal signal.

The independent review exercised original-source and weak-identity cases and
closed the discovered parser/sync limitations before handoff. Code checks,
lint and focused subsystem regressions passed. The coordinator will run the
combined suite after integrating peer registry/widget changes. No foreground
browser or desktop control was used here. Studio diagnostic rendering is code
verification, not independent visual/runtime browser acceptance.

Focused verification commands and receipts in this isolated worktree:

```bash
deno test --allow-read --allow-write --allow-env --allow-run tests/annotations_test.ts tests/annotations_execution_test.ts tests/sync_test.ts tests/notes_test.ts tests/recovery_test.ts
# 81/81 passed; /tmp/qbento-annotations-final.log
deno test --allow-read --allow-write tests/annotations_test.ts
# 15/15 passed after the final literal-attribute regression; /tmp/qbento-annotations-unit.log
```

The earlier broader focused sync/structure/notes/math/design/component collection
passed 56/56 with the updated default-minimal expectations
(`/tmp/qbento-annotations-regression.log`). These are subsystem receipts, not the
combined post-integration suite or browser evidence. Independent annotations
review found no remaining material issue after the targeted fixes.

Integration prerequisite: the peer `src/render/registry.ts` was tested as a
local dependency with file SHA-256
`2edda0841115229d2ff7c89a44a16ec1b2ab13bb3cf2155cd4d733b51ab39800`.
It belongs to the registry agent's commit and is deliberately excluded from the
annotation commit; integrate the registry feature first.
