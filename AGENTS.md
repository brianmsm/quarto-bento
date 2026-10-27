# Agent / next-session handoff

**Project status (2026-10-27): Linux implementation objective completed; public development source and npm CLI 0.2.0 published.** Read `docs/IMPLEMENTATION_STATUS.md` for current code and evidence. Target commands/APIs must not be assumed implemented merely because they appear in design documents; the supported Linux workflows are demonstrated, with bounded codecs and a longer-term product horizon. Public source availability is distinct from a stable v1 release.

1. Read `README.md`, then **`docs/PRODUCT_TARGET.md`** for the finish line, `docs/DECISIONS.md` for agreements, and `docs/ROADMAP.md` for the next action. Consult `docs/WORKFLOWS.md`, `docs/SYNC.md`, `docs/AUTHORING.md`, and `docs/ARCHITECTURE.md` for the relevant implementation area.
2. Preserve agreed behavior: QMD semantic authority, `.qbento/` visual authority, explicit safe round-trip, recoverable unsynced edits, no silent merge, computed results sourced from execution, fully offline ordinary workflow, Git-friendly rebuilds.
3. Treat sample configuration/CLI/schema syntax as **target design**, not as verified upstream behavior. Validate against installed Quarto and a **pinned Bento upstream revision** before implementing. On Quarto 1.10.19 an HTML-derived custom format with `output-ext: bento.html` worked, but `format: bento` must not be assumed; a pinned Bento shell and guarded `qbento-html` integration now exist; consult current evidence for their supported scope.
4. Distinguish **accepted product decisions** from **open technical experiments**. Update the documentation when implementation discoveries require changes; don't silently change the product contract.
5. Do not add automatic environment management (`renv`, `uv`, Docker), force a Bento fork, or enable collaborative editing in the first vertical slice.
6. Prefer upstream Bento integration; use a limited adapter if needed. Avoid patching the entire Markdown file through a Pandoc writer.
7. Start with S0: **QMD → BentoDoc → native HTML edits → stable-ID visual overrides → recompute → preserved design**, including stable Bento `docId` and protection against losing edits in the generated HTML. The complete first implementation milestone must *also* prove Bento-authored edits → safe QMD synchronization.
8. Never rewrite source or discard unsynced edits on render without a checked, approved operation. Make source patches inspectable and recoverable.

**Current handoff:** read `docs/PUBLICATION.md`, the implementation ledger and
`docs/NPM.md` for the Linux npm CLI. The owner-authorized
`@brianmsm/quarto-bento@0.2.0` publication completed on 2026-10-27, with
`latest` pointing to it. Exact clean archive integrity (137 files/132 runtime
hashes), anonymous public npm/mise installation and real rendering passed in
`docs/evidence/NPM-0.2.0.md`. Clean published source is
`5b17bf6acda597c3403ee6abf6ba4d396eba7ad6` (`dirty: false`), published on
GitHub `main` with annotated unsigned tag `v0.2.0`; no experimental branch
was published. The earlier dirty review archive remains historical qualification.
Current source acceptance passed 705 tests and four steps with zero failures
and one optional pinned-upstream-source math comparison ignored.
Separately, the owner personally executed the authorized global mise command
selecting `0.2.0`, Node 26.12.0 and Deno 2.9.8, with Node already installed.
Subsequent selected-CLI version/doctor, all 137 archive files/132 runtime hashes
and a real render with unchanged QMD passed in the release receipt. No additional
global installation was performed by the assistant. The historical `0.1.1`
publication/global verification remains in `docs/evidence/SYNC-SELECTION-0.1.1.md`;
initial `0.1.0` publication remains historical in `docs/evidence/NPM-CLI.md`,
with its archive unchanged.
The Node shim delegates to external Deno; package metadata must not trigger
lifecycle hooks or environment installation. Consistent source-binding reads,
CLI/Studio selected sync and explicit post-sync pending guidance remain
supported. JSON API and saved-state schema versions remain 1.
The earlier application baseline is recorded in
`docs/evidence/SECURITY-LINUX.md`. Runtime `2ee7974` passed 578 tests and four
steps with zero failures. Its 117-file clean portable and state-only smoke are
validated locally. The original S0/S1/S2/S4, ordinary authoring and redesign
slices are integrated; do not restart them as missing implementation.

Preserve the bounded codecs in `docs/ACCEPTANCE_GAPS.md`, source-aware layout
application, native content-bound diagnostics and reviewed static code-language
sync. Displayed code must never become executable chunks through sync. A prior
intermittent exact-widget-SVG mismatch has no established cause: retain strict
assertions and opt-in diagnostics rather than claiming that cause fixed.

The owner authorized public GitHub source publication on 2026-10-13. Keep all
current user documentation in English and distinguish historical evidence from
current status. Preserve pinned upstream bytes and third-party notices. The
four historical package-license-source gaps and upstream build-only advisories
remain documented follow-up, not silently resolved by publication.

Windows and macOS are future work outside the completed Linux objective. The
hosted workflow is manual Linux-only; no hosted result is claimed. The product
horizon remains `docs/PRODUCT_TARGET.md`; the exact stable v1 feature boundary
is not frozen. Source publication does not authorize inventing a stable release
or cross-platform acceptance claim.

Upstream: https://github.com/nyblnet/bento · Quarto: https://quarto.org/
