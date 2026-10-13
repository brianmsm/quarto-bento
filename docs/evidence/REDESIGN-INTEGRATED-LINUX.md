# Integrated native redesign — Linux acceptance

Date: 2026-10-13. Runtime `f06def7b46995dd3c82f4a940f69a9dd2305294c`;
complete-suite revision `b5b6bbe16b3d53592189d6918e80362964554940` adds only
test-harness corrections. The 113 portable payload files are byte-identical
between these revisions. Subsequent documentation does not change this runtime.

## Combined verification

The complete suite passed **572 tests, 4 steps, zero failures and zero ignored
tests in 18m39s**, process exit **0**. All optional native browser, pinned math
and installed Python execution checks were enabled:

```sh
DENO_JOBS=2 NO_COLOR=1 \
QBENTO_BENTO_SOURCE="$PWD/output/verification/bento-upstream" \
QBENTO_STUDIO_BROWSER_TEST=1 QBENTO_RELATIONS_BROWSER=1 \
QBENTO_LAYOUT_BROWSER=1 QBENTO_PYTHON_EXECUTION_TEST=1 \
QBENTO_TEST_PYTHON=/usr/bin/python3 \
QBENTO_WIDGET_EVIDENCE="$PWD/output/verification/widget-svg-mismatch" \
deno test --parallel --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests
```

Source type checking, lint (199 files), formatting (200 files) and Git whitespace
checks passed. Local versions were Deno 2.9.6, Quarto 1.10.19, R 4.6.1 and
Chromium 152.0.7977.82. The Bento revision remains
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

The earlier integrated run at `f06def7` passed 18 tests and failed three isolated
Studio client tests because their dependency-injection harness omitted the new
`attachLayoutEditor` import. `b5b6bbe` corrects those test doubles and verifies
fresh text/table/chart warning replacement; nine targeted client tests then
passed. No runtime assertion was relaxed. The earlier text/code integration
also passed 21 tests and 69 diagnostic/KPI/recovery regressions.

The real widget project and exact SVG comparison passed. The earlier intermittent
SVG difference remains unexplained; strict equality and opt-in failure capture
are retained. This run does not establish its root cause or claim a fix.

## Native Studio and source authority

The coordinator used the shipped Studio and pinned editor in headless Chromium,
through actual inspector, language selector and native **Apply layout** controls.
No foreground desktop interaction or document-model injection was used in this
combined path.

Steps 1–3 below ran on `92be7d0`; steps 4–5 ran on `f06def7`, reopening the
same saved project with its pending language change. The complete suite above
validates the final combined runtime.

1. Resize a source paragraph to x=80, y=166, w=300, h=80 and Save. QMD remains
   byte-identical. Enlarge the source paragraph and Recalculate: saved geometry
   remains and the visible warning reports 1577.5px of bottom content overflow.
2. Correct its dimensions and typography in the inspector, then Save. The
   warning clears without executing QMD and stays absent after reopening.
3. Select `py` in the native displayed-code language selector and Save. The
   QMD fence remains `.r`; one `grammarName` change is retained pending.
4. Click the native **Apply layout** button. Explicitly assign the paragraph
   and code to the two columns, inspect the proposed coordinates and Apply.
   Only their x/y/w/h change. The title, other slide, every native ID, complete
   provenance and pending language change remain unchanged.
5. Review the literal `.r` → `.py` token patch, optional visual annotations and
   complete proposed QMD. Apply and Recalculate: the whole emitted document
   equals the saved layout snapshot, the docId is unchanged and pending is zero.

The inspected before/after screenshots show overflowing text with its warning,
then complete text and code in separate columns with the title preserved.
The source code body stays non-executable; changing its language leaves the body
untouched and does not execute it. The [layout receipt](REUSABLE-LAYOUTS.md) separately
documents native figure/caption/table/chart placement, concurrent-source guards
and changed-CSV execution. [Content bounds](CONTENT-OVERFLOW.md) distinguishes
DOM text measurement from the conservative table/chart adapter bounds.

## Portable reconstruction

The new development artifact records clean source `f06def7` and contains **113
verified payload files**. All hashes, byte counts, executable flags and inventory
entries match; all payload bytes also match the complete-suite revision.

Its actual launcher passed doctor and the relocation/pending-edit/ordinary
Quarto smoke (8.574s). A new project containing only the reusable-layout QMD,
CSV, SVG and two state files rebuilt exactly after the original project was
removed. A separate copy containing only the native combined QMD and two state
files also rebuilt the exact final emitted document, including language `py`,
layout and typography. Both retain docId, source bytes and zero pending edits.
They use fresh caches and Deno permission denial for reading the checkout; this
is not OS-level isolation of external computation subprocesses.

Usable artifact and instructions:
`output/verification/portable-f06def7/distribution/` and its sibling `README.md`.
The detailed portable receipt is the sibling `receipt.json`.

## Audit and evidence boundary

An independent final read-only audit mapped the ten workflows to their receipts,
verified the combined native JSONs/source hash and inspected both screenshots.
It found no new concrete blocker in the documented ordinary Linux workflows.
The two reproduced redesign defects at `1304d9e` are closed by implementation,
independent review, native interaction and reconstruction evidence.

This closes this local functional acceptance pass. It does not freeze a public
v1 boundary, decide the project's license, complete a distribution/dependency
review, qualify other platforms or establish universal QMD/Bento conversion.
The documented codec limits and explicitly deferred work remain unchanged.

Raw full-suite/static logs and checksums are indexed in
`output/verification/redesign-b5b6bbe/receipt.json`. Native snapshots, exact
states and receipts are under `output/verification/native-redesign-combined/`;
screenshots are `output/playwright/redesign-overflow-warning.png` and
`output/playwright/redesign-final.png`. Layout review logs are retained under
`output/verification/layouts-0e9d131/`.
