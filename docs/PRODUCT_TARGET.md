# Product target — what “done” means

**Status:** Product horizon for Quarto-Bento (2026-10-09). This document states the **agreed product destination**, not an implementation claim or a commitment to ship everything in one release. Technical decisions and syntax remain governed by the linked specifications.

## North star

A person can **author and compute in Quarto, design freely in Bento, change data and regenerate, edit authored content from Bento, and reconstruct the deck from source control** without silently losing content, design, or provenance.

The default experience should feel like one project with two complementary editors — **not** a one-way converter or a requirement to hand-edit a generated HTML file.

### Canonical user journey

1. Write a QMD with authored content and R/Python/other Quarto computations; open the deck with the proposed `qbento edit` command.
2. Move figures and text, style objects, apply layouts and add purely decorative objects in Bento Studio.
3. **Save**: retain the design and any pending semantic edits in the project, even after closing Studio.
4. **Review/sync**: push authored text, notes, LaTeX, displayed-code changes, created/reordered/deleted slides and QMD-declared visual attributes back to the specific QMD source when safe.
5. Change the dataset or computation; **render again**: update computed output without resetting the design.
6. Deliver a standalone Bento HTML or PDF; later clone the QMD, inputs and `.qbento/` under a **compatible user-supplied environment** and reconstruct the presentation.

Any step that cannot be completed faithfully must produce an **actionable diagnostic** rather than silently guessing, discarding edits or modifying computed source.

## Milestones, not competing visions

| Stage | What it proves | It does **not** claim |
|---|---|---|
| **S0: visual-overrides proof** | QMD → real Bento deck → native visual edit → capture sparse visual overrides → data recomputation → preserved design and stable `docId`. | Full Studio or QMD semantic round-trip. |
| **First complete vertical slice** | Studio saves visual and pending semantic edits, syncs authored text/new slides/order safely, detects conflicts, and regenerates computed figures without resetting design. | All components, widgets, export modes or operating systems. |
| **v1 product target** | The agreed functionality below is integrated, demonstrable, documented and tested; unsupported conversions explicitly degrade or refuse. | Universal conversion of arbitrary HTML/widgets or pixel-identical cross-platform output. |

**v1 target is a destination, not the instruction to implement every module at once.** Earlier passing slices must remain reusable parts of the eventual product, not throwaway prototypes. See [ROADMAP.md](ROADMAP.md) for order and feasibility gates.

## Acceptance at the v1 target

| User-visible capability | Acceptance evidence |
|---|---|
| **Quarto → Bento** | A supported single-QMD document with headings, text, computable figures and simple tables yields a functioning Bento deck. Ordinary `quarto render` integration and proposed `qbento` CLI are usable. |
| **Visual persistence** | Changes to positions, sizes, typography, effects, decorations, layouts and themes survive save/reopen and changed-data regeneration. `docId` remains stable across rebuilds. |
| **Safe semantic editing** | Authored text, equations, displayed code, speaker notes and slide creation/order/hide/delete are represented correctly in QMD after approved sync. QMD patches are bounded; unsupported or ambiguous reverse edits are refused. |
| **Explicit reconciliation** | Studio shows change origin, direction, element/property diffs and conflicts; three-way merge never silently chooses an incompatible value. Pending edits remain recoverable through renders/restarts. |
| **Source-side visual authoring** | Plain QMD works; `.bento-*` components, reusable layouts and explicit visual attributes have defined behavior; QMD informational annotations support `none/minimal/detailed`. |
| **Computed and rich content** | Fresh computed values replace old ones; SVG is preferred for static vector content, native charts/tables are used where faithful, and complex content receives explained fallbacks. Computed numbers are never quietly reverse-written to code. |
| **Interaction/export** | Bento standalone and PDF retain a correct static fallback; supported Plotly/htmlwidgets work in an isolated enhanced Presenter where feasible, including offline bundled resources. Not every widget is promised. |
| **Rebuild, offline and Git** | On a compatible installed environment, QMD + inputs + versioned `.qbento/` rebuild the deck without the old generated HTML. Normal editing/viewing does not require cloud access. Generated HTML may be distributed independently. |
| **Portability and agents** | Linux/macOS/Windows are target platforms, with tested packaging; the core exposes structured JSON/CLI operations usable by agents without editing HTML blindly. |

Acceptance is **behavioral and evidence-based** (reproducible fixtures, source diffs, reopen tests, render tests, and visual checks), not “all planned files exist.”

## Boundaries and explicitly deferred work

- **Not our job:** installing, locking or managing language/package environments. `renv`, `uv`, Docker etc. remain optional user choices.
- **Not safe:** automatically turning an edited computed value back into R/Python source; rewriting entire QMDs for small changes; discarding unsynced edits; running arbitrary widget scripts inside pure-data BentoDoc.
- **No visual-equivalence promise** for a secondary Reveal.js build, or pixel-identical output across operating systems.
- **Deferred:** full collaborative editing/CRDT ↔ QMD integration, reconciling arbitrary distributed HTML copies, and broad multi-QMD source editing. The exact **public release in which these arrive** is *not yet decided*; do not silently pull them into, or exclude them from, a release contract.
- **Local native-HTML capture** is a useful S0/secondary workflow. Studio remains the intended primary experience; capturing an HTML edited outside Studio is never implicitly the same as syncing its semantic contents to QMD.

## Implementation autonomy and escalation

An implementing agent **may** choose internal algorithms, module structure, test fixtures and incremental task breakdown consistent with [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SYNC.md](SYNC.md), and [AUTHORING.md](AUTHORING.md). Document important choices and test each vertical slice.

**Request an explicit product decision before changing**: source-of-truth rules, loss/conflict handling, data provenance, offline expectations, design retention, compatibility promises, live collaboration scope, an upstream fork strategy, or the feature set declared “v1 shipped.” The existence of an unresolved technical design detail **does not block** S0/S1/S2 experiments.

## Definition of completion

A stage is complete only when its workflows can be executed end-to-end from a clean working tree, its failure paths have tests, its changes are documented, and the results are reproducible **under compatible dependencies**. A final v1 release additionally needs its scope frozen and validated across the supported platforms.

**Next action:** begin S0, record actual limitations and decisions; do not treat the current architecture mockups or CLI examples as already implemented.
