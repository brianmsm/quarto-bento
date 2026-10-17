# Evidence index

These receipts record scoped observations, test runs and native workflow checks
at identified revisions. Historical receipts retain their original counts and
limits. They do not establish current behavior beyond the tests they describe.
Paths in `output/verification/` and `/tmp/` identify local-only artifacts from
the original runs; those files are excluded from this repository. Committed
screenshots and JSON snapshots are linked from their receipts where available.
See [publication scope](../PUBLICATION.md) for the current baseline.

## Current combined results

- [Prepared 0.1.1 corrections](SYNC-SELECTION-0.1.1.md): bound source reads,
  reviewed selective sync and post-Apply pending semantics; validation is
  distinct from publication.

- [npm CLI preparation and public installation](NPM-CLI.md): public registry
  integrity and npm/mise installation/rendering, explicit tarball inventory,
  prefix relocation/state rebuilding, and an isolated real mise backend check.
- [Security and dependencies](SECURITY-LINUX.md): mitigations, 578 tests and
  four steps, zero failures, plus 117-file portable smoke at runtime `2ee7974`.
- [Redesign integration](REDESIGN-INTEGRATED-LINUX.md): source-aware layout,
  static code-language sync, native content bounds and portable reconstruction.
- [Ordinary QMD integration](ORDINARY-INTEGRATED-LINUX.md): images/captions,
  quoted paths, source boundaries and combined computation/state workflow.
- [Distribution notices](DISTRIBUTION-NOTICES.md) and
  [exact license-source investigation](RUNTIME-LICENSE-SOURCE-AUDIT.md): MIT
  carriage, pinned third-party inventories and remaining provenance gaps.

## Functional areas

- Project flow: [first slice](FIRST-SLICE.md), [capture](CAPTURE.md),
  [semantic round-trip](SEMANTIC-ROUNDTRIP.md), [reconciliation](RECONCILE.md),
  [recovery](RECOVERY.md) and [slide actions](SLIDE-ACTIONS.md).
- Source mapping: [plain QMD](PLAIN-QMD.md), [images](PLAIN-IMAGES.md),
  [tables](PLAIN-TABLES.md), [notes](NOTES.md), [lists](LISTS.md),
  [math](MATH-CODEC.md) and [displayed code](DISPLAYED-CODE.md).
- Components: [creation](COMPONENT-CREATION.md), [graphs](GRAPHS.md),
  [composed tables](COMPOSED-TABLES.md), [charts](COMPOSED-CHARTS.md),
  [KPIs](COMPOSED-KPIS.md) and [layout application](REUSABLE-LAYOUTS.md).
- Execution/delivery: [Quarto](QUARTO.md),
  [producer activation](PRODUCER-ACTIVATION.md),
  [Python](PYTHON-COMPUTATION.md), [rich tables](RICH-TABLES.md),
  [Plotly](PLOTLY.md) and [offline HTML/PDF](OFFLINE-PDF.md).
- Design/agents: [registry](STUDIO-REGISTRY.md),
  [content overflow](CONTENT-OVERFLOW.md), [agent API](AGENT-CREATE.md) and
  [asset boundaries](ASSET-PATHS.md).

For requirement coverage and limits, use the
[implementation ledger](../IMPLEMENTATION_STATUS.md),
[completion audit](../COMPLETION_AUDIT.md) and
[acceptance follow-up](../ACCEPTANCE_GAPS.md).
