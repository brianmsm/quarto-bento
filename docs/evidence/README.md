# Evidence index

These receipts record scoped observations, test runs and native workflow checks
at identified revisions. Historical receipts retain their original counts and
limits. They do not establish current behavior beyond the tests they describe.
Paths in `output/verification/` and `/tmp/` identify local-only artifacts from
the original runs; those files are excluded from this repository. Committed
screenshots and JSON snapshots are linked from their receipts where available.
See [publication scope](../PUBLICATION.md) for the current baseline.

## Current published release (2026-10-27)

- [npm 0.2.0 publication](NPM-0.2.0.md): clean archive from `5b17bf6`,
  public npm `0.2.0`/`latest`, exact archive integrity and anonymous npm/mise
  installation/render checks passed. Public GitHub `main` and annotated unsigned
  `v0.2.0` tag are published; no experimental branch is published. The owner's
  separately executed global mise update also pins Node/Deno; its selected-CLI
  version/doctor, complete file/hash comparison and real render passed separately.

- [Composition/interactivity 0.2.0](COMPOSITION-INTERACTIVITY-0.2.0.md): explicit
  theme slots, measured code/results, complete scroll/Presenter PDF, inline
  offline Plotly3D, camera Save/native reopen/capture, source-only reconstruction
  and local review packaging. Qualification passed 705 tests and four steps,
  zero failures, with one optional upstream-source math comparison ignored;
  portable 132 files, offline npm 137 files/132 runtime hashes. Its dirty local
  review archive remains historical prepublication evidence, distinct from the
  clean publication artifact. Source qualification is not npm publication.

## Earlier integrations and historical publication

- [Reusable presentation designs](REUSABLE-DESIGNS.md): integrated source feature
  with native styles/templates, content-free packages, safe initialization and
  import, Studio native samples and local Reveal adaptation; separate from npm
  0.1.1 publication.

- [Historical published 0.1.1 corrections](SYNC-SELECTION-0.1.1.md): bound source
  reads,
  reviewed selective sync and post-Apply pending semantics; separate local
  runtime evidence, anonymous public npm/mise verification and the owner-requested
  global mise update.

- [Historical npm 0.1.0 preparation and public installation](NPM-CLI.md): public
  registry
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
