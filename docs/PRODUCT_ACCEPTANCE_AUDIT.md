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
and execution tests. Chart composition and the common producer-receipt work
across execution entry points remain under review.

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
or a legal conclusion about license coverage. The project license must not be
chosen by an implementing agent.

Other-platform execution, hosted CI and public release are not prerequisites for
the local authoring improvements above. A public v1 additionally requires its
scope to be agreed and validated across the supported platforms. Neither the
baseline suite nor this audit declares the full product complete.
