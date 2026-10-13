# Functional acceptance follow-up

This checklist follows the full product objective. Passing a suite does not
prove requirements outside its fixtures. Current validation is limited to the
owner's Linux machine; other operating systems and hosted CI are deferred.
Public release scope is a separate decision.

## Full-product follow-up after the local receipt

The [requirement-by-requirement audit](PRODUCT_ACCEPTANCE_AUDIT.md) at `89fc134`
identified ordinary authoring gaps beyond the previously audited local slice:
creating speaker notes without a prepared QMD block, faithful Markdown list
round-trip, and composing simple tables/charts/KPIs within cards/layouts.
Notes creation and existing-list editing now have native Linux receipts and
state-only reconstruction, with 52 combined tests passing at `eb57c6f`.
Simple table composition has independently reviewed real execution and native
DOM evidence, integrated at `1605a37`. See [notes](evidence/NOTES.md),
[lists](evidence/LISTS.md) and [composed tables](evidence/COMPOSED-TABLES.md).
List creation/conversion/deletion is integrated at `2dbc8e2`, with native
toolbar creation/conversion and confirmed deletion/restoration evidence.
KPI composition is integrated at `cea3e61`, with independent real-execution and
native renderer checks. Chart composition is integrated at `a1201a4`, and common
execution producer receipts with ordinary Quarto activation at `74a16cd`.
Both have independent lane reviews; combined acceptance remains active.
The newer ordinary-QMD audit found unwrapped display math/code, plain pipe tables
and local-image mapping gaps. Corrections are in progress, not yet accepted. Documenting a
conservative refusal does not make a missing ordinary workflow an accepted
product exclusion. Local work continues under the owner's Linux-only scope.

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

### Meaningful Studio-created cards and KPIs

Explicit component creation, durable membership snapshots, partial-deletion
recovery and approved source promotion are integrated. The native Studio flow
creates a card and KPI on an ordinary QMD slide, retains rich text and individual
object design, restores a missing member in the correct stacking order, and
shows all identity and component patches before Apply. Recalculation promotes
the complete components; changed data and reconstruction without the prior HTML
preserve their design and document identity. See
[component creation acceptance](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).

Membership is explicit, never inferred from spatial proximity or arbitrary
native groups. Authored text becomes QMD after approval; geometry remains in the
sidecar. Studio creates literal values; computed values continue to come from
source expressions. Negative and recovery tests cover partial selections,
altered/stale approval, publication failure and source ownership. Retained KPI
measurement also works under exact verified source headings without IDs when
only computation inputs change.

### Declarative diagram and timeline adapters

Bounded `.bento-diagram` and `.bento-timeline` adapters, native label editing and
source synchronization are integrated. Studio's **Relaciones** dialog explicitly
saves both source endpoints of an existing diagram edge; native Save/reopen,
exact relationship review, Apply and Recalculate passed on Linux. Timeline
adjacency is displayed read-only because lexical source order defines it.
The pinned editor's endpoint drag detaches its anchor; detached or unsupported
relations cannot silently rewrite QMD. See
[relationship acceptance](evidence/GRAPHS.md#explicit-relationship-controls-accepted-on-linux).

The integrated mixed regression covers a graph under an ordinary heading,
reviewed identity acquisition, card/KPI creation, rich/native design, approved
endpoint changes and exact HTML-free reconstruction. Weak slide bindings require
current original-source receipts; labels, positions and coincident IDs cannot
substitute for provenance.

## Local integrated verification completed

Runtime `75edcdf` passed **430 tests, 4 steps, 0 failures and 0 ignored
tests** in **9m44s** with the optional pinned math, Studio and Relations
browser checks enabled. Types, lint and formatting passed. The final 91-file
portable runtime passed relocation and state-only reconstruction; its actual
launcher rebuilt the two-component native demo with an exact emitted document
and zero pending changes. See [the complete receipt](evidence/INTEGRATED-LINUX.md).

This closes the audited local acceptance pass for the documented workflows.
Other-platform execution remains deferred at the owner's request; complete
release/dependency review and a frozen public v1 scope remain separate gates.

Unsupported arbitrary widgets, general TeX, ambiguous source spans, automatic
computed-value reverse edits and inference of an entire parent transform from
one child remain legitimate refusals. They must not excuse ordinary authoring or
explicit component scenarios. Each gap closes with source/runtime/native
evidence, not by renaming it a limit.
