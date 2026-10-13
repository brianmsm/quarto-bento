# Source-aware reusable layouts — Linux acceptance

Date: 2026-10-13. Worktree base `a7cb6b5`; pinned Bento shell unchanged.
Chrome/152.0.7977.82, local Quarto execution. This receipt covers snapshot
application of existing registry definitions to explicit native objects. Native
text/code overflow measurement is a separate integrated layer; layout placement
does not claim general painted-ink fitting.

## Runtime and ownership

`src/core/layouts.ts` exposes `readLayouts`, `previewLayout` and `applyLayout`.
Requests include document ID, saved revision, source hash, registry hash, slide,
layout name and ordered ID arrays for each column. Core validates them under the
project lock, rebuilds the candidate from current state, and changes only
`x/y/w/h`. Preview does not save. Apply uses normal `captureEdits`, keeping
explicit source-owned fields pending and retaining all other pending work.

The built-in `two-column` definition is shared with source composition. Named
registry definitions remain `.qbento/design.json`; applied free-object geometry
is a snapshot in normal overrides. Titles are excluded through original source
heading identity. If current QMD no longer matches the projection hash, choices
refuse before comparing offset-derived IDs. Changed source, registry, state or
uncaptured HTML cannot silently replace the saved document.

Studio's toolbar and the actual pinned **Apply layout** button open the same
explicit selector. `managedBoot` captures the verified `bento:apply-layout`
event before upstream's template-replacement handler. The parent checks iframe
source, origin and its immutable loaded snapshot. Standalone Bento exports keep
their upstream behavior. There is no upstream fork, placeholder creation,
role-based matching, membership inference or replacement of source IDs.

## Executed tests

```sh
QBENTO_LAYOUT_BROWSER=1 QBENTO_LAYOUT_EVIDENCE=/tmp/qbento-layout-evidence \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/layouts_test.ts tests/studio_layouts_test.ts
```

Eight focused tests passed. The final focused gate, including existing table,
composed-table and composed-chart regressions, passed **29/29** in 2m17s
(`/tmp/qbento-layouts-final.log`). Type check, targeted lint/format and
`git diff --check` passed. Real QMD execution proves source-owned independent
geometry + existing pending text, stable IDs/provenance/title preservation,
preview/refusal atomicity, named definition reuse, custom override retention,
explicit reapplication, coupled-parent geometry pending + `UNMAPPED_DESIGN`
refusal, source offset/H1/H2 changes, and HTML-free rebuild. The computed-chart
case executes once per render, zero times during Apply, changes CSV values and
labels, retains its saved frame, and emits `NATIVE_CONTENT_OVERFLOW` when the
new labels exceed the conservative chart-layout bound. Enlarging the saved chart clears the fresh warning
without another R execution. A relocated copy rebuilds from QMD, CSV and state
without generated HTML.

The Studio test seeds an unsaved text edit with the real public `bento.loadDoc`
API; this is not a claim of a keyboard/contenteditable edit. It then clicks the
actual pinned native Apply layout button, uses the real selector/preview/apply
controls, and verifies that the pre-save retained that pending edit and all IDs.
Subsequent toolbar applications cover a local image + separately selected rich
caption, a native table and a native chart. Source/provenance and pending
content survive subsequent review/apply/render. HTTP token/origin and stale
iframe identity probes cannot open or write the action.

Native DOM checks show both table rows within the saved frame with 18px cell
text. The chart SVG has viewBox 544×470, all six value ticks, category labels
A/B and series legend N, with their text boxes inside the SVG. Table column
weights, cell HTML/style and chart options are unchanged by application.
Conservative cell width/row height and chart axes/legend adapters refuse
undersized slots; custom unmeasured metrics are not silently scaled.

## Visual inspection

These four screenshots were inspected after the native splash screen closed.
They show a preserved title, explicit assignments, complete figure/caption,
complete table rows and chart axes/legend. Images are fixtures, not a claim of
an external scientific result.

- [Selector and preview](reusable-layouts-linux/layout-selector.png)
- [Figure and caption](reusable-layouts-linux/layout-figure.png)
- [Native table](reusable-layouts-linux/layout-table.png)
- [Native chart](reusable-layouts-linux/layout-chart.png)
- [Native chart metrics](reusable-layouts-linux/native-metrics.json)

Run `sha256sum -c SHA256SUMS.txt` from `reusable-layouts-linux` to check receipt
files. These hashes support integrity; DOM assertions and visual inspection
support the rendering observations.
