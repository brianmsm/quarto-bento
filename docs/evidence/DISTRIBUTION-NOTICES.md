# Standalone notice preservation — Linux

Date: 2026-10-13. Runtime revision: `7f68207`; portable guide: `e6bc9fd`.

The supplied portable included full font license texts, but the original pinned
shell and the prior combined generated deck contained only abbreviated font
attribution and links. A shared shell loader now adds the five supplied texts
as inert JSON in the head before native pristine-shell capture: Bento MIT,
upstream third-party notices, font provenance and the two full OFL files. Each
text and the original shell are checked against the local pinned hashes. The
vendored shell remains unchanged; notices are outside BentoDoc.

The native regression serializes with `window.bento.serialize()`, reopens the
result in a fresh Chromium instance/profile and serializes again. It verifies
exact decoded notice text, docId, slides, font reference and the whole normalized
saved document. This is native serialization API evidence, not a Save-button
click or new visual-layout acceptance. The Presenter test verifies the nested
deck contains the same full notices. An independent reviewer repeated these
tests and checked the six original file hashes.

Validation on local Linux:

- Two notice tests passed, zero failures, 978 ms, with
  `QBENTO_STUDIO_BROWSER_TEST=1`.
- 36 affected regressions passed, zero failures, 25 seconds: package, rendering,
  bridge, widgets, core, Studio, native measurement and overflow.
- Type checking, lint and formatting passed for the affected code.
- The portable smoke passed doctor/render/validate/get/patch/init, state-only
  reconstruction with pending content, relocation and ordinary Quarto after
  portable removal. Deno 2.9.6; Quarto 1.10.19.

The clean `7f68207` artifact contains 114 payload files; all hashes and byte
counts were independently recomputed. It is available locally under
`output/verification/portable-7f68207/distribution/`. Its root `PACKAGING.md`
is now a self-contained usage guide instead of source-checkout documentation
with links to files absent from the package.

Raw logs: `output/verification/distribution-notices-{native,regressions,portable,check,lint}.log`.
The new focused checks do not relabel the earlier 572-test full-suite receipt
as a run of this revision. No dependencies were installed, public release made,
or other-platform qualification added. Project licensing, complete third-party
coverage and unknown original font release identifiers remain unresolved.
