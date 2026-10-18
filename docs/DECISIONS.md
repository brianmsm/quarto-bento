# Decision record — Architecture & Design v0.2

**As of 2026-10-09.** This is the agreed **target behavior**, not a feature-completion report. `quarto-bento` and `qbento` are provisional names.

## Accepted / settled decisions

| Topic | Decision |
|---|---|
| Product | Public, general-purpose Quarto ↔ Bento authoring layer; **not merely an exporter**. |
| Authority | QMD = semantic/computational source; `.qbento/` = visual/design state. Explicit visual attributes in QMD are also honored and synchronized by field. |
| Editing | Text, authored LaTeX, displayed code, speaker notes, slide creation/order/deletion editable in Bento with visible pending sync. Decorative Bento-only objects need no semantic QMD representation. |
| Saving | Save unsynced edits durably; **save does not imply QMD sync**. Re-render never silently destroys them. |
| Merge | Semantic, field-granular three-way merge using last confirmed baseline; visible divergences/conflicts and previewable choices. No silent conflict resolution. |
| Source changes | Surgical verified patches, not whole-file Pandoc Markdown regeneration. Stable provenance/IDs and source spans required. |
| Computed output | Regenerate from code; no fabricated reverse mapping of edited numbers/figures into R/Python. Offer restore, edit source, or explicit detach. |
| Content vs design | Semantically meaningful text in visual components belongs to QMD after sync; pure graphics stay in `.qbento/`. |
| QMD authoring | Ordinary Markdown, optional declarative `.bento-*` components, and optional advanced layout/style attributes. Remain editable from Bento. |
| Annotations | Configurable `none` / `minimal` (default) / `detailed` **informational** QMD annotations. Necessary semantic structure and technical IDs are not optional. |
| Slides | Create, reorder, hide, restore, delete from Bento. Confirmed deletion changes QMD; hide retains it. |
| Layouts/themes | Reusable, first-class; editable from QMD and Studio; design persisted in `.qbento/`. |
| Reusable designs (owner authorization, 2026-10-18) | Implement native styles/slide variants and content-free packages shared across independent presentations, plus a bounded local Reveal style adaptation workflow. Imports are pinned by value and explicitly reviewed; saved semantic/native state and QMD ownership remain unchanged. New-deck initialization replaces no existing state. No stable release, npm publication or global installation update is implied. |
| Rendering | Bento HTML and PDF primary; Reveal.js optional secondary output, without design-parity promise. SVG preferred for static computed vector figures. |
| Figures/tables | Native Bento charts/tables only when fidelity is adequate; complex visuals may use SVG/HTML projections. |
| Widgets | Static compatible fallback for standalone Bento/PDF; supported widgets interactive in enhanced Presenter, isolated from pure-data BentoDoc; offline where dependencies can be bundled. |
| Reproducibility | Source + input data + visual state + **user-provided compatible runtime/packages** reconstruct the presentation. `renv`/`uv`/Docker are user-controlled optional recommendations, **not managed by qbento**. |
| Distribution | Editable standalone `.bento.html` is an independent copy; importing/reconciling later is separate functionality. |
| Project license (owner decision, 2026-10-13) | Quarto-Bento's own code and documentation use the MIT License, copyright (c) 2026 Brian Norman Peña Calero. The [root LICENSE](../LICENSE) records the terms. Bundled third-party components retain their own terms and attributions; this decision does not settle their review or the public release boundary. |
| Git/offline/platforms | Git-first sources, offline ordinary workflow, Linux/macOS/Windows target; Linux first for development. |
| npm publication (owner decision, 2026-10-16) | Publish `@brianmsm/quarto-bento@0.1.0` as a Linux development CLI, with English npm/mise instructions. Node launches external Deno; Quarto and computation environments remain user-managed. This supersedes preparation-only authorization and does not declare stable v1 or cross-platform qualification. |
| Current objective platforms (owner decision, 2026-10-13) | Linux only. Windows and macOS remain pending future work outside this objective, not completion blockers. This does not claim support on those systems or freeze the public v1 release boundary. Hosted execution remains deferred; the current workflow is a manual Linux smoke. |
| Languages | R is an important use case, but core independent of R (Quarto/Pandoc execution handles R/Python/Julia/etc.). |
| Agents | Structured JSON core operations/CLI from the start; MCP/agent interfaces can be added on top. |
| Collaboration | **Disabled in initial implementation**; revisit Bento CRDT collaboration later. |
| Bento integration | Upstream first; allow small compatibility adapter if necessary; avoid maintaining a permanent fork unless unavoidable. |
| Scope | v1 is the **full target**, developed in vertical slices; do not make a throwaway architecture. [PRODUCT_TARGET.md](PRODUCT_TARGET.md) gives behavioral acceptance; the specific public release boundary still requires explicit confirmation. |
| First project scope | Single `.qmd` for first working implementation; data models prepare for multifile sources later. |
| Public source publication (owner authorization, 2026-10-13) | Publish the tracked development source and documentation as a public GitHub repository. This authorizes source availability; it does not declare a stable v1 or attach binary releases. See [PUBLICATION.md](PUBLICATION.md). |

## Implemented architecture and open schema details

- The development build uses a typed deck model, original-source mapping, separate visual state and a bounded sync engine. Core runtime and CLI use TypeScript/Deno; Quarto integration includes Lua filters and the local Studio uses the pinned upstream Bento shell.
- The development CLI implements `doctor`, `render`, `edit`, `status`, `diff`, `sync`, `capture`, `get`, `patch` and `init`; see [README.md](../README.md) and [USAGE.md](USAGE.md). A general `qbento import` for arbitrary or independently distributed HTML remains unimplemented.
- The earlier `.qbento/{deck.yml,theme.yml,sync.lock.json,slides/,layouts/,assets/,widgets/}` layout remains conceptual. The current implementation stores project identity in `.qbento/project.json` and checksummed design, baseline and pending state in `.qbento/state.json`. Preserve the Bento `docId` across regenerations and keep QMD-backed design sparse, keyed by stable IDs. Exact migrations and the broader storage schemas remain open.
- Bounded local HTML capture is implemented as `qbento capture`: it accepts a copy with a valid receipt for the current project publication and stores captured changes before a subsequent render. This is distinct from arbitrary third-party HTML import; automatic reverse conversion of computed content to QMD is **not** assumed. See [CAPTURE.md](evidence/CAPTURE.md).
- The installed `qbento-html` Quarto extension and separate `qbento` CLI are verified on Linux. Do **not** assume bare `format: bento` or `quarto bento` is registered. Any new extension syntax still needs validation against installed Quarto and the pinned Bento revision.

## How the original September proposal fits

The original `QMD → Bento base → _bento/overrides.json → .bento.html` model is historical design rationale for separating source and visual state. The current implementation uses `.qbento/` and does not require the proposed `overrides.json` filename. It now has a pinned Bento shell, a local Studio bridge, bounded QMD mapping, durable state, review/apply transactions, and CLI capture. Safe semantic round-trip is part of the product target and has evidence for documented subsets; it is not universal support for arbitrary QMD or HTML. Authored/computed provenance and explicit detach/pending sync replace the original `linked/detached` shorthand. The proposed `quarto bento sync` spelling was replaced by the implemented `qbento sync` CLI.

## Remaining technical limits (not new product decisions)

1. Source mapping and reverse edits are bounded to the documented QMD forms. Unsupported reader transformations, source structures and computed content require an explicit diagnostic; they are not covered by the plain-QMD evidence.
2. `.bento-diagram` and `.bento-timeline` are implemented only for the bounded
   source schemas in [AUTHORING.md](AUTHORING.md) and
   [graph evidence](evidence/GRAPHS.md): literal labels, identified roles,
   declared DAG endpoints, and source-order timeline adjacency. Studio's
   **Relaciones** controls can save both endpoints of an existing diagram edge
   together as one pending project update; timeline adjacency is read-only.
   The request is checked against the open `docId`, project revision, QMD source
   hash and exact graph identities. This does not provide arbitrary graph
   layouts or native grouping-based membership inference. The pinned editor's
   endpoint drag detaches its anchor; use Undo or explicitly select both source
   nodes in Relaciones. Sync verifies the pending pair still matches the saved
   connector and rejects unsupported topology before changing QMD. Project
   Save, reviewed source Apply, and QMD execution remain separate operations.
3. Studio can explicitly create an authored card or literal-value KPI on an
   existing source-backed slide and promote the complete role set through
   reviewed QMD sync. Save still does not patch source; computed KPI values
   must be authored as source expressions. The bounded flow has Linux headless
   acceptance through the shipped Studio client and pinned Bento editor; see
   the [component creation receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).
   That receipt does not claim foreground desktop or other-platform acceptance.
4. Arbitrary widgets, reconciliation of independently distributed HTML copies,
   multi-QMD editing and live collaboration remain outside the implemented
   scope described by [PRODUCT_TARGET.md](PRODUCT_TARGET.md).
5. This work has Linux-local evidence. Other-platform and hosted validation,
   along with the public v1 release boundary, remain separate decisions and
   acceptance gates.

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current receipts and unfinished work. Do not change a settled product choice because an initial integration attempt is inconvenient; record trade-offs and propose a conscious revision.
