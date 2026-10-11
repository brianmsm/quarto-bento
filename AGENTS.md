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

**Immediate next action:** continue the integrated S0/S1/S2/S4 work tracked in `docs/IMPLEMENTATION_STATUS.md`, retain the first-slice evidence and proceed through the remaining product acceptance gates. Finalize contracts and schemas using test evidence. The product horizon is in `docs/PRODUCT_TARGET.md`. Product-direction decisions are settled, but **the exact v1 release boundary is not frozen**; do not claim a full v1 release without confirming its acceptance scope.

Upstream: https://github.com/nyblnet/bento · Quarto: https://quarto.org/
