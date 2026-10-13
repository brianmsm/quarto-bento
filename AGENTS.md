# Agent / next-session handoff

**Project status (2026-10-11): implementation in progress from Architecture & Design v0.2.** Read `docs/IMPLEMENTATION_STATUS.md` for current code and evidence. Target commands/APIs must not be assumed implemented merely because they appear in design documents; the supported first Linux bidirectional workflow is demonstrated, while the full product remains incomplete.

1. Read `README.md`, then **`docs/PRODUCT_TARGET.md`** for the finish line, `docs/DECISIONS.md` for agreements, and `docs/ROADMAP.md` for the next action. Consult `docs/WORKFLOWS.md`, `docs/SYNC.md`, `docs/AUTHORING.md`, and `docs/ARCHITECTURE.md` for the relevant implementation area.
2. Preserve agreed behavior: QMD semantic authority, `.qbento/` visual authority, explicit safe round-trip, recoverable unsynced edits, no silent merge, computed results sourced from execution, fully offline ordinary workflow, Git-friendly rebuilds.
3. Treat sample configuration/CLI/schema syntax as **target design**, not as verified upstream behavior. Validate against installed Quarto and a **pinned Bento upstream revision** before implementing. On Quarto 1.10.19 an HTML-derived custom format with `output-ext: bento.html` worked, but `format: bento` must not be assumed; a pinned Bento shell and guarded `qbento-html` integration now exist; consult current evidence for their supported scope.
4. Distinguish **accepted product decisions** from **open technical experiments**. Update the documentation when implementation discoveries require changes; don't silently change the product contract.
5. Do not add automatic environment management (`renv`, `uv`, Docker), force a Bento fork, or enable collaborative editing in the first vertical slice.
6. Prefer upstream Bento integration; use a limited adapter if needed. Avoid patching the entire Markdown file through a Pandoc writer.
7. Start with S0: **QMD → BentoDoc → native HTML edits → stable-ID visual overrides → recompute → preserved design**, including stable Bento `docId` and protection against losing edits in the generated HTML. The complete first implementation milestone must *also* prove Bento-authored edits → safe QMD synchronization.
8. Never rewrite source or discard unsynced edits on render without a checked, approved operation. Make source patches inspectable and recoverable.

**Immediate next action:** start from the integrated Linux acceptance receipts
in `docs/IMPLEMENTATION_STATUS.md` and `docs/evidence/INTEGRATED-LINUX.md`.
The audited local workflows and portable development artifact are validated;
do not repeat the original S0/S1/S2/S4 spikes as if they were unimplemented.
Respect the bounded codecs and remaining gates in `docs/ACCEPTANCE_GAPS.md`.
The full-product audit in `docs/PRODUCT_ACCEPTANCE_AUDIT.md` led to integrated
notes creation, existing Markdown lists and simple composed tables. Their newer
receipts are in the implementation ledger. List creation/conversion/deletion
and KPI composition are now also integrated; their newer receipts distinguish
native Studio actions from core-save/native-renderer checks. Chart composition and common execution provenance are also integrated. Continue
from `docs/evidence/ORDINARY-INTEGRATED-LINUX.md`: local-image caption mapping,
quoted rmarkdown paths and H1/H2 source boundaries are now integrated. The
combined `85da037` runtime has a passing full Linux suite and a new portable
artifact with exact native table/image reconstruction. Preserve the documented
bounded codecs. A prior intermittent exact-widget-SVG mismatch did not reproduce;
retain the strict assertion and opt-in diagnostics rather than claiming its cause
fixed. Safe refusals preserve work but do not close future ordinary-workflow gaps.
The subsequent native redesign audit at `1304d9e` reproduced two active
Workflow 2 gaps: source-aware application of reusable layouts and warnings for
text overflowing its retained native box. Content-bounds warnings are now
integrated at `92be7d0`, with native inspector/Save/recompute/reopen evidence;
source-aware layout application remains in progress. Displayed-code language
sync is integrated at `a1beef6` as a reviewed static fence-token change; it must
never promote displayed code to executable chunks. Their combined focused run
passed 21 tests; a new complete-suite/portable receipt remains necessary after
layout integration. Follow the newer audit rather than treating the old layout
UX limitation as an accepted exclusion.
The owner currently limits execution tests to local Linux; native macOS/Windows
and hosted CI are deferred. The product horizon remains
`docs/PRODUCT_TARGET.md`. Product-direction decisions are settled, but **the
exact v1 release boundary is not frozen**; do not claim a full v1 release
without confirming its acceptance scope.

Upstream: https://github.com/nyblnet/bento · Quarto: https://quarto.org/
