# Functional acceptance follow-up

Updated 2026-10-13. The owner has completed the Linux-local implementation
objective at runtime `2ee7974`: **578 tests and 4 steps, zero failures**, plus a
**117-file portable smoke** rebuilding from minimal saved state. Public GitHub
source publication is authorized. See [the latest receipt](evidence/SECURITY-LINUX.md).

This checklist retains the broader product follow-up and historical gap
closures. Passing a suite does not prove requirements outside its fixtures.
Windows/macOS are future work outside the completed objective; hosted CI is
deferred. The public v1 boundary remains a separate decision.

## Native redesign gates — closed locally

The newer native audit at `1304d9e` reproduced two Workflow 2 gaps beyond the
passing combined suite: native layout application does not preserve source IDs,
and text overflowing a retained box can publish without a warning. See the
[reproductions and acceptance criteria](PRODUCT_ACCEPTANCE_AUDIT.md#native-redesign-follow-up-two-reproduced-gaps-2026-10-13).
The content-bounds gate now has integrated implementation and native
resize/Save/recompute/reopen evidence at `92be7d0`; see
[the content-overflow receipt](evidence/CONTENT-OVERFLOW.md#integrated-native-studio-acceptance).
Source-aware layout application is integrated at `f06def7`. The combined native
flow preserves a real pending language change through layout application and
reviewed sync, with exact portable reconstruction. The complete suite at
`b5b6bbe` passed 572 tests and 4 steps, zero failures. See
[the combined redesign receipt](evidence/REDESIGN-INTEGRATED-LINUX.md).
An independent final audit found no new concrete blocker in the documented ten
ordinary Linux workflows. Other-platform qualification and public release gates
remain separate from this local functional pass.

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
Both have independent lane reviews and are included in the newer combined acceptance below.
The newer ordinary-QMD audit found unwrapped display math/code, plain pipe tables
and local-image mapping gaps. Math/code and pipe tables are integrated at
`f3f4127` and `73dea2d` after independent reviews and native Studio checks.
Unlabelled computed tables followed at `a1492d4`. Local images/caption sync
followed at `9b237d5`, with native Studio acceptance; the rmarkdown path adapter
is integrated at `ca8eb3a`. The final `85da037` runtime also corrects H1/H2 source
boundaries and passes the combined suite and new portable reconstruction.
See [the final local receipt](evidence/ORDINARY-INTEGRATED-LINUX.md), including
the earlier failed runs and the unexplained intermittent widget SVG mismatch.
Documenting a
conservative refusal does not make a missing ordinary workflow an accepted
product exclusion. The subsequent ordinary, redesign and security receipts
complete the owner's Linux-only objective for the documented workflows.

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

## Latest local closeout and remaining gates

Runtime `2ee7974` passed **578 tests, 4 steps, zero failures** with native browser
and installed computation checks. The 117-file portable smoke reconstructed
from QMD and minimal saved state without prior HTML. This supersedes the suite
counts below for current local acceptance, while preserving their historical
receipts. [Security/dependency closure](evidence/SECURITY-LINUX.md) records exact
scope, test log hashes and the production-lockfile advisory check.

Remaining follow-up consists of a frozen public v1 boundary, four unresolved
historical full-license-source cases, two advisories in the upstream build-only
dependency graph, and evidence for any newly supported engine/platform. R and
Python via installed knitr/reticulate have execution receipts; Quarto's Jupyter
engine and Julia do not. The project does not install or manage those runtimes.
See [license-source investigation](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md),
[Python/engine evidence](evidence/PYTHON-COMPUTATION.md) and the latest security
receipt. Public source authorization does not certify those outstanding
matters or imply an artifact release.

## Composition/interactivity 0.2.0 acceptance boundary

The source integration adds explicit theme slots/variant role styles, bounded
executable-code/result layout, opt-in computed-output scrolling, inline Plotly
2D/scatter3d interaction and local inert htmlwidget-data import. See
[execution layout](EXECUTION_LAYOUT.md),
[theme slots](features/THEME_SLOTS.md) and
[widget authoring bounds](AUTHORING.md#interactive-plotly-and-local-widget-data).
The historical counts and receipts above do not verify these additions. Their
integrated native/runtime, complete PDF, offline isolation and installed-package
checks are recorded in the
[0.2.0 source receipt](evidence/COMPOSITION-INTERACTIVITY-0.2.0.md). Source
acceptance and local package preparation are not publication or global
installation actions; the published npm baseline remains 0.1.1.

These additions do not imply arbitrary HTML/widget execution, surface/mesh
support, automatic reverse propagation of computed data, a general layout DSL,
managed environments or new platform qualification. Full native code/text/table
data remains authoritative under a scroll viewport; imported widget data is
bound to the source artifact hash, not a fabricated R execution receipt.

## Historical integrated verification

Runtime `75edcdf` passed **430 tests, 4 steps, 0 failures and 0 ignored
tests** in **9m44s** with the optional pinned math, Studio and Relations
browser checks enabled. Types, lint and formatting passed. The final 91-file
portable runtime passed relocation and state-only reconstruction; its actual
launcher rebuilt the two-component native demo with an exact emitted document
and zero pending changes. See [the complete receipt](evidence/INTEGRATED-LINUX.md).

This closes the audited local acceptance pass for the documented workflows.
Other-platform execution remains future work outside the completed Linux
objective; complete distribution review and a frozen public v1 scope remain
separate gates. The later security receipt supplies the scoped dependency audit.

Unsupported arbitrary widgets, general TeX, ambiguous source spans, automatic
computed-value reverse edits and inference of an entire parent transform from
one child remain legitimate refusals. They must not excuse ordinary authoring or
explicit component scenarios. Each gap closes with source/runtime/native
evidence, not by renaming it a limit.
