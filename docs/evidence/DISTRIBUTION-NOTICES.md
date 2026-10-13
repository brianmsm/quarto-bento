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

## Production archive supplement

Revision `3a19e7f` adds `vendor/bento/runtime-licenses.json`. All 25 exact
production-scoped npm archives were present in the local cache and verified
against the pinned lockfile SHA-512 integrity values before reading members.
No package installation, download or lifecycle script was required.

The supplement retains 166 exact texts and 317 source byte ranges, including
LICENSE/NOTICE files, README license fences and distribution headers. An
independent reviewer verified every archive, member hash, range and decoded text.
Two nested reveal.js font license files are retained as archive evidence;
neither those nor the other archive entries prove byte-level inclusion in Bento.
The unchanged upstream attribution summary is supplemented, not rewritten.

Nineteen packages contain standalone license files and two provide full license
text in README. Four do not provide full license text in the archive:
`@cfcs/core`, `croact`, `croact-css-styled` and `keycon`. Their declarations and
headers are preserved, and the missing full texts remain explicit. This does
not complete the third-party review or choose a project license.

The shared shell loader embeds the supplement as a sixth inert notice file.
Six focused package/native tests passed in 6 seconds; the final four package
tests passed after extending the omitted-entry regression. Five independent
alteration cases also refused before destination creation, including repinned
false text, identity/integrity, omitted packages and hidden gaps. Types, lint,
format and Git whitespace checks passed. Python `-O` reproduced the supplement
and refused a corrupt archive before parsing; an initial coordinator harness
assertion was corrected for the diagnostic's capitalization.

The portable smoke passed with 115 files, preserving pending content through
state-only reconstruction and ordinary Quarto after relocation/runtime removal.
A clean `3a19e7f` artifact is at
`output/verification/portable-3a19e7f/distribution/`; its sibling
`verification.json` records independent verification of every payload hash and
size. Earlier full-suite and artifact receipts remain tied to their revisions.
Raw logs use `output/verification/runtime-license-*.log` and
`output/verification/runtime-licenses-*.log`.
