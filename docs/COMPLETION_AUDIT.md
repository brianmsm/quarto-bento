# Completion audit after MIT integration

Audit date: 2026-10-13. Inspected revision: `3d87133`, runtime `74e552b`.
An independent read-only review compared the full [product target](PRODUCT_TARGET.md),
decisions, workflows and current implementation with code, tests and receipts.
No new concrete ordinary Linux defect was found. This does not prove complete
product acceptance: the platform requirement and public release gates remain open.

## Product requirements

| Target capability | Current evidence | Assessment |
| --- | --- | --- |
| Quarto to Bento | [Quarto](evidence/QUARTO.md), [ordinary authoring](evidence/ORDINARY-INTEGRATED-LINUX.md), [Python](evidence/PYTHON-COMPUTATION.md), [producer activation](evidence/PRODUCER-ACTIVATION.md) | Supported single-QMD forms tested on Linux; execution evidence covers installed R and Python via knitr/reticulate, not every engine. |
| Visual persistence | [First slice](evidence/FIRST-SLICE.md), [design](evidence/DESIGN.md), [combined redesign](evidence/REDESIGN-INTEGRATED-LINUX.md) | Save/reopen, identity, design, changed data and explicit layout application demonstrated for documented objects. |
| Safe semantic editing | [Semantic round-trip](evidence/SEMANTIC-ROUNDTRIP.md), [notes](evidence/NOTES.md), [lists](evidence/LISTS.md), [displayed code](evidence/DISPLAYED-CODE.md), [slide actions](evidence/SLIDE-ACTIONS.md) | Authored changes have reviewed bounded patches; arbitrary Markdown/TeX conversion is not established. |
| Explicit reconciliation | [Reconciliation](evidence/RECONCILE.md), [recovery](evidence/RECOVERY.md) | Source/Bento/baseline choices, durable pending content, stale-plan guards and transaction failure recovery tested; simulated crash stages are not physical power-loss tests. |
| Source visual authoring | [Annotations](evidence/ANNOTATIONS.md), [components](evidence/COMPONENTS.md), [graphs](evidence/GRAPHS.md), [registry](evidence/STUDIO-REGISTRY.md), [layouts](evidence/REUSABLE-LAYOUTS.md) | Implemented and locally tested within declared component and ownership contracts. |
| Computed and rich content | [Composed tables](evidence/COMPOSED-TABLES.md), [charts](evidence/COMPOSED-CHARTS.md), [KPI](evidence/COMPOSED-KPIS.md), [rich tables](evidence/RICH-TABLES.md) | Fresh execution, provenance, retained frames and faithful native/fallback representations demonstrated for the declared codecs; no invented reverse writes. |
| Interaction and export | [Offline/PDF](evidence/OFFLINE-PDF.md), [Plotly](evidence/PLOTLY.md) | Static delivery and isolated supported widgets tested locally; not arbitrary widgets or OS-native dialog qualification. |
| Rebuild, offline, Git | First slice, ordinary/redesign receipts and [current portable](evidence/DISTRIBUTION-NOTICES.md#owner-selected-mit-license) | Source/input/state reconstruction, identity and pending preservation tested under compatible installed dependencies. |
| Platforms and agents | [Agent contract](AGENT-API.md), [packaging](PACKAGING.md), CLI/core and tests | Checked JSON operations and Linux packaging have evidence. macOS/Windows qualification remains unproven and explicitly deferred by the owner. |

The six canonical journey steps map to these receipts: author/compute/open
(Quarto/Python), design/decorate (first slice/design/redesign), Save/reopen
(first slice/state), review/sync (semantic/structural receipts), changed-data
execution (composition/redesign), and delivery/rebuild (offline/PDF/portable).
These are complementary scoped tests, not a single exhaustive run of all content
types, platforms and dialogs.

## Invariants and actual command surface

The review inspected `src/core/project.ts`, `src/core/sync.ts`, state merge,
reconciliation/recovery and their tests. Save persists checked visual/pending
state without patching QMD; preview is read-only; Apply revalidates source hash,
revision, identity and registry before the source transaction. Tests cover
conflicts without silent selection, stale/altered plans, computed protection,
concurrent changes, backups and explicit recovery.

`src/cli.ts` implements `render`, `capture`, `status`, `diff`, `get`, `patch`,
`sync`, `reconcile`, `recover`, `validate`, `doctor`, `edit`, `init` and
`quarto-recover`. Proposed general `import`, bare `format: bento` and
`quarto bento` are not counted as implemented. The pinned shell remains
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Ordinary operation does not install
environments, resolve remote runtime modules or enable collaboration.

## Evidence integrity and remaining requirements

The reviewer independently recomputed all ten indexed redesign artifact hashes
and sizes and all 117 current portable payload hashes and sizes. They match.
The complete 572-test/four-step suite belongs to `b5b6bbe`; later notice/MIT
changes have focused tests and portable smoke. Those results are not relabeled
as a new complete-suite run of this revision. This audit reran no suite.

The full objective cannot be marked complete on this evidence:

- macOS/Windows native qualification requires the systems/runners and resumption
  of execution tests explicitly deferred by the owner. The Linux-only guard in
  `src/integration/invocation.ts` is real; a launcher or CI YAML does not remove it.
- Public v1 acceptance requires the owner's explicit feature/platform boundary.
  Choosing MIT does not freeze that boundary or authorize publication.
- The [four-package historical source investigation](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
  retains unavailable/discrepant provenance. Existing notices and inventories
  do not establish complete third-party or dependency review. New evidence is
  needed to resolve those findings; repeating the same requests adds no proof.
- Jupyter/Julia are not installed/qualified in this environment. No universal
  execution-engine compatibility is asserted and no automatic installation is
  part of the product contract.
- The prior intermittent exact SVG mismatch has no established cause. Strict
  comparison and failure capture remain; the final full run did not reproduce it.

The coordinator corrected stale ledger statements that still called already
closed ordinary-QMD/regression gaps active work and updated the roadmap to the
117-file MIT artifact. The full target is unchanged. No additional mandatory
component or speculative runtime fix is inferred merely to keep work active.
