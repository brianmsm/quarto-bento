# Standalone offline editing and native PDF

Date: 2026-10-11. Pinned Bento shell; Chromium 155 on Linux.

The relocated first-slice deck, with three slides and the changed-data SVG figure,
was loaded in a separate browser context with networking disabled. The browser
harness supplied the exact local HTML bytes for one synthetic loopback URL;
there was no HTTP server or other asset route. This avoids the CLI harness's
blocked `file:` navigation and does not establish native OS file-opening proof.
The deck's own offline CSP and collaboration isolation remained enabled.

Using the native content editor, the first slide's body was changed to
`Edited in the standalone deck while offline.`. Native **Exportar PDF (imprimir)**
built its print view. Chromium printed that view to
`output/playwright/standalone-offline.pdf` after image decoding. No document-model
mutation or replacement print renderer was used; no print-function override was
needed. This validates Chromium's print output, not an OS print-dialog action.

`pdfinfo` reported three pages, approximately 1200 × 675 pt, with no PDF
JavaScript. `pdftotext` found the revised first-slide text and the original other
slide text. All three rasterized PDF pages were inspected: headings and body
text were legible, the native title layout retained its divider, and the second
page retained the SVG with its last data value of 40, placement and soft shadow.

The native **Guardar una copia** menu also downloaded the edited HTML. For this
save test only, the browser's File System Access picker API was disabled to
exercise Bento's download fallback; the OS picker remains unverified. Reopening
the downloaded bytes in the same offline harness retained the native text,
three slides, embedded figure, stable document ID and disabled sharing control.

Local evidence (ignored generated artifacts):

- `output/playwright/standalone-offline.pdf` and its three `.png` pages.
- `output/playwright/standalone-offline-edited.html`.
- `output/playwright/standalone-offline-reopened.png`.

Original HTML SHA256:
`6af33415b90803ddb25e511bb4f98188b9c1f6617f4d7cb5a33b7c149966ffa3`.
Downloaded edited HTML SHA256:
`26c39f3abf2e93b208fc8e4ef4657059f49ea6144643e4664b75b629a720283d`.
Both retain docId `95638224-712e-479e-8c8d-87b505142c82`.

This acceptance is bounded to the demonstrated static content. Interactive
widget fallbacks, other browsers, native file dialogs and platform packaging
need their own evidence. A standalone copy is independent; this save does not
synchronize QMD or reconcile a distributed copy back into project state.
