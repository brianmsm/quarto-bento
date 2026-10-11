# Functional acceptance follow-up

This checklist follows the full product objective. Passing a suite does not
prove requirements outside its fixtures. Current validation is limited to the
owner's Linux machine; other operating systems and hosted CI are deferred.
Public release scope is a separate decision.

## Closed gaps from the audit at `0bf0d9c`

### Plain QMD source mapping and reviewed identity acquisition

At the audited revision, editing ordinary QMD paragraphs could fail after Apply
with `AMBIGUOUS_IDENTITY`, and rich unlabelled text could fail initial
projection with `UNMAPPED_PROVENANCE`. The integrated fix at `be98fc1` maps
faithful original Pandoc fragments without computation and proposes explicit
source identities before semantic changes. Studio displays every identity patch,
including untouched weak blocks, and the complete proposed QMD before Apply.

Native edit/save/reopen/review/apply/recalculate preserved rich text, Unicode
native IDs, `docId`, source code and saved design. A changed CSV regenerated the
SVG at its saved geometry. Stale or ambiguous source remains guarded. See
[plain QMD](evidence/PLAIN-QMD.md) and
[integrated native acceptance](evidence/PLAIN-KPI-NATIVE.md).

### Confirmed deletion of a source-backed element

The original `UNSUPPORTED_SYNC` gap is closed for independently verified
authored paragraphs, displayed code and display equations. Review shows the
exact removed source unit and requires that element's separate confirmation.
Pending deletion can restore prior text, design and stacking. Fresh execution
must prove the approved absence before the target's retained state is retired.
Computed/shared producers and ambiguous structure refuse before publication.

Native deletion/restoration and final source removal passed on Linux. The mixed
plain-heading/weak-survivor/deletion path also passed with reviewed identities
and preserved survivor design. See
[element deletion](evidence/ELEMENT-DELETION.md) and
[mixed integration](evidence/PLAIN-KPI-NATIVE.md).

### Source-authored KPI projection

The former missing `.bento-kpi` adapter is integrated for its explicit bounded
label/value/detail source structure. Literal text keeps authored provenance; an
inline computed value keeps its real source expression. Native label editing,
changed-data recomputation and explicit computed-conflict restoration preserve
design and source authority. Browser measurements include native text extents
and retained font resources, with refusal or retained-design diagnostics for
unsupported/overflowing typography. See [KPI contract](evidence/KPI.md) and
[native acceptance](evidence/PLAIN-KPI-NATIVE.md).

## Implementation and review still in progress

### Meaningful Studio-created cards and KPIs

[WORKFLOWS.md](WORKFLOWS.md) and [DECISIONS.md](DECISIONS.md) require content in
a newly created card/KPI to become a pending semantic component, then
source-backed fenced divs after reviewed sync. Explicit component creation,
durable membership snapshots, partial-deletion recovery and safe promotion are
being implemented in an isolated worktree. This capability is not established by
source KPI support.

Spatial proximity or arbitrary native grouping must not establish semantic
structure. Authored text belongs in QMD; decorations and geometry remain in the
sidecar; a computed value keeps its producer. Remaining acceptance includes
multiple components, ordinary QMD, restoration stacking, native background
edits, failed publication/recovery, native Studio controls and integrated tests.

### Declarative diagram and timeline adapters

The [target component vocabulary](AUTHORING.md) includes `.bento-diagram` and
`.bento-timeline`. Their bounded adapters and explicit source node/edge or
lexical milestone structures are implemented in an isolated branch under
independent review. They are not yet integrated in main. Relationship source
patches must be visible in Studio before approval, and saved native geometry
must retain its separate authority. Native DOM/visual evidence for the branch is
available; final integration and native edit/sync acceptance remain.

## Integrated verification still required

The last complete suite receipt is 332 tests at `c225546`; it predates these
changes. Focused and native receipts above do not replace a full suite and
portable-package check on the completed integration. The implementation ledger
will record the final runtime revision and exact results.

Unsupported arbitrary widgets, general TeX, ambiguous source spans, automatic
computed-value reverse edits and inference of an entire parent transform from
one child remain legitimate refusals. They must not excuse ordinary authoring or
explicit component scenarios. Each gap closes with source/runtime/native
evidence, not by renaming it a limit.
