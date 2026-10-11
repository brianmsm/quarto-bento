# Approved native slide creation, ordering and text synchronization

Evidence recorded 2026-10-11 with Deno 2.9.6 and Quarto 1.10.19 on Linux.

`previewSync` now combines existing bounded text edits, native slide creation
and source slide ordering into one reviewable plan. Text edits run first;
structural operations rescan the patched source before inserting/deleting
sections and checking final order. `plan.result` and `plan.resultHash` are the
complete approved QMD. `plan.patch` remains the bounded text-only preview;
`plan.structure` records sequential exact structural edits. Unsupported selected
pending records still fail.

A new native slide's first text object becomes its QMD heading, with the slide's
explicit ID and `bento-title-id="native-title-id"`. Remaining text objects get
technical `qb:native-element-id` markers. These choices appear in the reviewable
source diff; no position-based grouping is inferred. The executed AST projector
retains title attributes and original source markers, preserving actual native
text object IDs. Pure shape/line/arrow/path decorations remain in design state.
Other created content is refused rather than dropped. IDs must satisfy the
scanner's explicit safe-ID grammar and remain unique in source.

Created text must fit the supported bounded inline HTML conversion. The
converter produces reviewed Markdown and canonical HTML for supported equivalent
bold, italic, line-break and line-through representations. It never broadly
rewrites arbitrary HTML. Source deletion is a separate explicit approval via
`previewSync(source, selectedIds, {confirmedDeleteIds:[...]})`; computed
producers and shared references remain protected. Deletions are never inferred
solely from selecting a pending record.

## Promotion approval seam

Apply does not consume pending edits or infer approval from coincident IDs. For
creations, explicit deletions or supported HTML normalizations it stages and
publishes `.qbento/sync-approved.json` as:

```text
{
  format: "qbento-sync-approval/1",
  sha256: SHA256(canonical(approval)),
  approval: {
    version: 1, docId, sourceHash, stateRevision, planHash,
    expectedPending: [exact originally selected records],
    creationChangeIds: [...],
    normalizations: [{changeId, expectedAfter, after}]
  }
}
```

`validateSyncApproval(value)` validates this envelope. The checksum detects
inconsistent metadata; it is not a cryptographic signature or an independent
source of user authorization. The file is produced by the explicit approved
source transaction.

After fresh execution, the renderer calls:

```ts
prepareApprovedSync(state, generated, sourceHash, approvalEnvelope);
```

It requires the same source hash and document identity, a state revision at
least as new as the approved revision, and unchanged exact selected pending
records. Unrelated newer state may survive. It applies only approved HTML
normalizations in memory and calls `promoteCreated` with the exact approved
creation IDs. This retains native geometry/styles/decorations while acquiring
source semantics. Approved absent slide targets lose only their old provenance
entries, so the renderer should call this helper **before** checking stale
source identities and before `compose`. Removal of the approval file belongs
after successful final render publication; failed renders must retain it.
Another source sync refuses an outstanding approval instead of overwriting it.

The transaction journal optionally adds `approvalStaging` and `approvalPath`.
Staging is `history/sync-approval-TRANSACTION.json`, written and fsynced before
the journal. After source publication and state revision commit, a no-clobber
link publishes the approval. The recovery module must verify and finish/rollback
this optional artifact with the same transaction. Original pending/baseline
state remains unchanged on disk until execution confirms it.

## Verified behavior

```sh
deno test --allow-read --allow-write tests/source_structure_test.ts tests/render_test.ts tests/sync_test.ts
deno test --allow-read --allow-write --allow-run --allow-env tests/sync_structure_test.ts
```

The structural sync suite has two source/persistence tests plus one actual
Quarto execution test. The latter renders the R/data fixture, saves an authored
`<strong>` edit, creates a native slide containing title/body text and a
decorative arrow, reorders it before two existing slides, explicitly applies the
source sync, executes Quarto again, promotes the approved creations and
composes. It verifies:

- Correct final source and native slide order.
- Actual title/body IDs survive Quarto preprocessing and execution.
- All selected pending edits clear after source agreement.
- Approved bold normalization yields renderer `<b>` without false conflict.
- Native title position/font size, body position, decorative arrow and `docId`
  remain intact.

Failure tests cover malformed creation identities, stale/modified approvals,
exact pending-record expectations, computed deletion refusal and separate delete
confirmation. The earlier content transaction tests retain their stale source,
concurrent publication and failure-recovery checks.

This execution test explicitly exercises the same fresh-AST projection,
`prepareApprovedSync` and `compose` functions. Parent renderer/UI publication
wiring has its own integration tests; this artifact does not claim native
browser interaction from filesystem tests alone.

## Reviewed provenance correction

Computed cell headings at slide levels inherit `computed` provenance and their
producer rather than becoming authored merely because they start a slide.
Computed speaker notes currently lack a dedicated slide-property provenance
representation; the projector explicitly refuses them with
`COMPUTED_NOTES_UNSUPPORTED`. Tests cover both paths so no computed output
silently acquires authored reverse-edit authority.

Unsupported note lists/code blocks refuse `UNSUPPORTED_NOTES` rather than being
silently filtered out. A separate actual R as-is probe found that Quarto can
hoist generated headings outside cell wrappers; the wrapper-provenance fix alone
does not establish full as-is output provenance. Original-source verification
remains required at the core projection boundary.

## Source-aware execution provenance guard

The projector exports `assertSupportedExecutionSource(scan)` for the
pre-execution boundary and `validateProjectionOrigins(scan, projection)`
afterward. The latter returns mapped origins; it never assigns authored
provenance to unknown output. Direct original IDs and unique exact unlabelled
literal heading/paragraph matches are accepted. Unknown or ambiguous matches
raise `UNMAPPED_PROVENANCE` with an explicit identity/support diagnostic.
Computed wrapper outputs need a verified original chunk producer.

R `results: asis` can erase all execution wrappers, as verified with an actual
Quarto/R fixture. This mode and `asis_output(...)` are currently refused rather
than falsely classified. The real test verifies the source-aware guard rejects
that output. A separate actual structural-sync execution test passes through the
same validator and still preserves newly acquired native IDs/design. Ordinary
plain-QMD unique literal headings and paragraphs remain supported by exact
original source matching; their identities remain snapshot-local until
explicitly pinned.

Follow-up results: **8 projector tests and 4 structural-sync tests pass**,
including two actual Quarto execution tests; lint passes. Parent
`projectProjection` must call these helpers at its execution boundary; a
standalone call to `projectAst` without the original-source validation is not
proof of safe provenance.
