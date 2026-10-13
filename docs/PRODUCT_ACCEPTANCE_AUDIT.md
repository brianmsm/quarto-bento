# Full product acceptance audit

## Baseline and interpretation

The baseline is `89fc134`, containing the integrated runtime `75edcdf` and its
passing 430-test Linux receipt. This audit checks the full
[product target](PRODUCT_TARGET.md), [decisions](DECISIONS.md),
[authoring contract](AUTHORING.md) and all ten [workflows](WORKFLOWS.md).
It does not redefine completion as the subset already covered by those tests.

The previous [Linux acceptance](evidence/INTEGRATED-LINUX.md) remains valid for
its documented workflows. A safe refusal can nevertheless expose unfinished
implementation: ordinary authored content should not remain unsupported merely
because the implementation ledger describes that limitation accurately.

The independent audit was read-only. It reproduced the list adapter failures
in memory and inspected the source, existing tests and evidence for other
requirements. It did not repeat all native workflows or the complete suite.

## Requirement matrix at the baseline

| Product requirement / workflow | Evidence and remaining work |
|---|---|
| Quarto to Bento; scientific deck, **1** | Real text, table and figure projection exists. Literal `BulletList` and decimal `OrderedList` each fail `UNSUPPORTED_BLOCK`; ordinary Markdown authoring is incomplete. Execution receipts principally cover R; other engines need their own evidence. |
| Visual persistence and redesign, **1, 2, 4** | Native save/reopen, registry, animation, recomputation and retained-design receipts cover adapted objects. This does not prove composition of every adapted object inside a layout. |
| Authored sentence editing and explicit reconciliation, **3** | Reviewed identity acquisition, bounded text patches, conflicts and recovery are demonstrated. Ambiguous source must still refuse. Simple lists fail before such a safe round-trip can begin. |
| Recompute fresh values, **4** | Executed figures, tables, charts and KPIs retain design and computation provenance. Restoration or explicit detach is correct for edited computed content; rewriting a rendered value into its producer is forbidden. |
| Visual slide creation, **5** | Title, paragraphs and decorations save and promote safely. Nonempty notes on a new slide block synchronization, leaving an ordinary creation workflow incomplete. |
| Order, hide, restore and confirmed deletion, **6** | Native controls and structural patches have recovery evidence. Refusing ambiguous or shared producers is a legitimate safety boundary. |
| Equations, displayed code and notes, **7** | Existing supported display equations, shown code and plain notes have native round-trip evidence. Creating notes without first authoring an identified QMD notes div is still missing. Universal TeX support is not an acceptance promise. |
| Declarative components and reusable layouts, **2** and additional scenarios | Cards, layouts, KPIs, charts and tables work separately. Even simple tables/charts in cards and KPIs in layouts are rejected for missing composition support. These are integration gaps, not automatically excluded product requirements. |
| Tables and charts, **8** | Native faithful subsets, source formatting and measured rich-table fallbacks are demonstrated. The contract protects computed values from reverse-writing; it does not promise arbitrary editable table content. |
| Interactive content and export, **9** | The selected offline Plotly adapter, isolated Presenter and static fallback have evidence. Arbitrary widgets are explicitly not promised. OS-native dialogs are a different, unverified layer from the demonstrated browser download/print workflow. |
| Git reconstruction and offline use, **10** | Source, input and sidecar reconstruction, pending edits, identity and portable relocation are verified on Linux with compatible installed dependencies. Environment management and cross-platform pixel identity are not requirements. |
| Structured agents and platforms | Checked JSON operations and reviewed source sync use the same core. They inherit the notes and content gaps above. Linux remains the current test platform; macOS/Windows and hosted CI are deferred by the owner. |

## Next implementation gates

Progress after this baseline audit: notes creation and existing-list editing are
integrated with native Linux evidence and exact state-only reconstruction at
`eb57c6f`; simple table composition is integrated at `1605a37` with independent
review and native DOM checks. See the [implementation ledger](IMPLEMENTATION_STATUS.md).
The matrix above remains a record of the audited baseline. List creation,
conversion/deletion is integrated at `2dbc8e2`, with newer native evidence;
KPI composition is integrated at `cea3e61`, with independent native measurements
and execution tests. Chart composition and the common producer receipts are now
integrated; their combined acceptance is recorded in the later follow-up below.

1. **Create plain speaker notes from Studio and the agent API.** Support existing
   slides, reviewed identity acquisition on ordinary QMD and new authored
   slides. Save must preserve pending notes without writing QMD. Preview must
   show the exact insertion, including technical identity. Apply, recompute and
   a source/state-only rebuild must retain the text and design. Existing notes,
   stale plans, independent source notes, collisions and execution-looking text
   need regression coverage. Baseline restrictions are in `src/core/sync.ts`
   and `src/core/agent.ts`; [notes evidence](evidence/NOTES.md) records them.
2. **Support ordinary authored Markdown lists.** Preserve native list structure,
   inline semantics, provenance and source boundaries. Cover review/apply,
   stable IDs, retained design, nested lists where faithful, stale/conflicting
   source and explicit refusal of unrepresentable native semantics. A list
   flattened into plain text does not pass. Baseline `projectAst` rejects both
   one-item unordered and decimal ordered lists in `src/render/project.ts`.
3. **Compose simple results inside layouts and cards.** Start with a native
   table in a measured two-column slot, then extend KPI/chart composition.
   Prove typography/content bounds, source-owned attributes, retained overrides,
   changed-data recomputation and the actual native appearance. The baseline
   refuses table/chart composition in `tests/components_execution_test.ts` and
   nested KPI in `tests/kpi_execution_test.ts`; those refusals identify missing
   adapters rather than establish product exclusions.

These gates are not closed by implementation alone: integration, independent
review and matching runtime/native evidence remain necessary. Any discovered
common execution/provenance defect must be repaired rather than hidden by
selecting only a passing example.

## Distribution and external gates

The portable artifact has a checked file inventory, pinned Bento shell and
working local launchers. The inventory now records source revision metadata,
pinned upstream manifests and complete official OFL texts for the two embedded
fonts; exact font release versions remain unknown. This is distinct from a complete dependency/security review
or a legal conclusion about license coverage. The owner selected MIT for the
project's own code, with Brian Norman Peña Calero as holder, on 2026-10-13;
this decision does not replace the separate third-party terms and review.

Other-platform execution, hosted CI and public release are not prerequisites for
the local authoring improvements above. A public v1 additionally requires its
scope to be agreed and validated across the supported platforms. Neither the
baseline suite nor this audit declares the full product complete.

## Ordinary QMD follow-up (2026-10-13)

A second independent read-only audit checked all ten workflows against
`550e1ef`, then tracked integrations through `5b92912`. Reproduction scripts and
logs are retained locally in `output/verification/ordinary-qmd-audit-550e1ef/`.
This audit did not rerun the complete suite or all native interactions.

| Workflows | Finding and next gate |
|---|---|
| 1, 7: ordinary scientific content | Static Markdown code without an ID fails initial projection. An untouched anonymous display equation blocks sync of neighboring prose. Reviewed original-source mapping and identity acquisition are being extended; Save/render must never insert identities implicitly. |
| 1, 8: simple tables and local figures | A plain pipe table fails `UNMAPPED_TABLE_SOURCE`; a local Markdown SVG figure fails on Quarto's caption wrapper. Both require faithful source adapters, not a new requirement to manually wrap ordinary content. |
| 2: redesign | Right, left and top out-of-page geometry lacked warnings. Four-edge diagnostics are integrated at `6f8e1ea`; seven integrated overflow tests passed. This remains box geometry, not painted-ink validation. |
| 3: prose synchronization | Existing paragraph/list paths have receipts; the neighboring weak math/code obstruction above remains the new gate. |
| 4: changed data | Chart composition and execution receipts are integrated at `a1201a4` and `74a16cd`. Their shared computed-chart boundary and combined regressions must pass after integration. |
| 5, 6: slide creation and lifecycle | No new ordinary gap was reproduced beyond the assigned source-mapping work. Existing notes, text, structural review, recovery and native receipts remain bounded evidence. |
| 9: selected interaction/export | No new mandatory gap was reproduced. Existing selected Plotly, offline Presenter and static/PDF receipts do not imply arbitrary widgets or OS-dialog validation. |
| 10: Git reconstruction | Build and exercise a new portable artifact from the final combined runtime. The historical `75edcdf` artifact cannot prove the newer helpers/adapters. |

Layout association currently uses QMD `bento-layout-name`; Studio edits registry
layout definitions and the theme and retains local geometry. There is no Studio
operation that associates arbitrary free slide content with a registry layout.
The existing declared-layout workflow has evidence; visual association of free
content has not been demonstrated. This is an explicit UX limit, not evidence
that the current registry is unusable or a newly agreed release boundary.

The audit found no additional concrete ordinary-workflow defect outside these
assigned corrections. This is a bounded audit result, not full-product or public
release acceptance. Other-platform execution and hosted CI remain deferred by
the owner.

## Combined follow-up completed locally (2026-10-13)

The assigned ordinary-QMD corrections are integrated at `85da037`: plain
math/code, pipe tables, local image/caption pairs, common execution receipts and
H1/H2 source boundaries. Native Studio receipts cover math/code neighbors,
identical authored/computed tables and caption editing. The final combined suite
passed 550 tests and 4 steps with zero failures; the new 108-file portable
artifact rebuilt native table/image fixtures exactly from source, inputs and
state only. See [combined evidence](evidence/ORDINARY-INTEGRATED-LINUX.md).

The earlier table remains an audit history, not a current list of unimplemented
features. An exact widget SVG comparison failed once in an intermediate suite;
its cause is not established. Independent repetition and the final suite passed,
and the strict test now saves opt-in diagnostic evidence on recurrence. This
observation remains open for diagnosis; it is not reported as a confirmed fix.
Image replacement/deletion and broader codecs retain their explicit limitations.
The full product horizon and public v1 scope remain separate from this local pass.

## Native redesign follow-up: two reproduced gaps (2026-10-13)

Independent native checks against `1304d9e` reproduced two requirements from
Workflow 2 that the passing `85da037` suite did not cover. The earlier statement
that layout association was only a documented UX limit was insufficient: the
promised application of a reusable layout to an existing deck must actually
preserve its source identities.

1. **Apply layout to existing QMD content.** The pinned native **Apply layout →
   Two columns** control adds empty title/body placeholders to an ordinary
   source-backed slide and leaves its existing objects unmoved. Saving preserves
   three pending creations, whose empty content cannot synchronize. Assigning
   native title/body roles first does distribute the content, but replaces all
   three original IDs with template IDs, producing three deletions and three
   creations. Even separately confirming those deletions cannot synchronize the
   original slide-title deletion. QMD remains intact, but the redesign workflow
   is not completed. The required operation must bind existing objects to slots
   explicitly and preserve their content, IDs, provenance and pending edits.
2. **Signal text overflow inside retained boxes.** After saving a paragraph at
   `x=80, y=166, w=300, h=80, fontSize=26`, enlarging its source text leaves the
   correct saved box but returns `diagnostics: []`. Native rendering visibly
   overlaps the next paragraph and continues beyond the page. The coordinator
   and independent auditor inspected the screenshot. Current edge diagnostics
   inspect the box, not its text. The fix must measure final native content and
   report overflow without silently resizing saved geometry or rewriting QMD.

Scripts, logs, QMD/state snapshots and the inspected overflow screenshot are
retained locally under `output/verification/redesign-audit-1304d9e/`. The audit
invoked the real pinned editor's layout operation and the real project Save API;
it did not simulate the layout algorithm. The retained DOM overflow count came
from a thumbnail match, so the screenshot, not that count, establishes the main
canvas overlap. New acceptance tests must target the actual canvas explicitly.

Both are active functional implementation gates. Declared QMD layouts and safe
refusals remain useful existing behavior, but neither closes these requirements.

## Redesign gates closed locally (2026-10-13)

Runtime `f06def7` closes both reproduced gates and adds reviewed displayed-code
language synchronization. The coordinator used the native inspector, language
selector and Apply layout button: resize/Save, source growth/Recalculate,
warning correction/reopen, pending language Save, explicit column placement,
review/Apply/Recalculate all passed. Independent comparison confirmed geometry
was the only layout change, with unchanged IDs, provenance, title and pending
language. The final whole emitted document is exact and pending is zero.

The complete suite at `b5b6bbe` passed 572 tests and 4 steps, zero failures;
the new 113-file portable rebuilt both the native combined fixture and the
reusable-layout example from source/assets/state without prior HTML. A final
independent read-only review of all ten workflows found no new concrete local
ordinary-workflow blocker. See [the combined receipt](evidence/REDESIGN-INTEGRATED-LINUX.md).

The earlier two gates are therefore historical findings, not current missing
features. Codec limits, the unexplained prior SVG observation, distribution and
dependency review, the owner release-scope decision and deferred other-platform
qualification remain explicit. This closes the local functional pass and does
not declare public v1 acceptance.
