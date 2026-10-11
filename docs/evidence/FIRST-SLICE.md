# Integrated first bidirectional slice — Linux evidence

Date: 2026-10-11. Implementation at `a1457a5`; Deno 2.9.6, Quarto
1.10.19, R 4.6.1 and the Bento revision in `vendor/bento/pin.json`.
This records the supported single-QMD slice, not full product or v1 acceptance.

## Reproduction and observed behavior

Use a fresh copy of `fixtures/basic/presentation.qmd` and `data.csv`. Run
`deno task qbento edit /absolute/path/presentation.qmd` and open its loopback URL.
Use the real native editor controls, then the parent Studio save/review buttons.

1. Edit the authored paragraph in Bento, save, and edit the same paragraph
   independently in QMD. **Comparar con QMD** displays baseline, QMD and Bento
   values. Select **Conservar Bento**, then **Guardar decisiones**. QMD remains
   unchanged until the separate **Revisar cambios** / apply operation. Recompute
   resolves the approved pending edit. See [conflict evidence](RECONCILE.md).
2. Use **Nueva diapositiva**, select **Title + content**, and edit its title and
   body to `Native created slide` and `Native authored body.`. Drag the slide
   before Results. Save and reload before sync: new content, order, native object
   IDs and design remain; QMD is still unchanged. Pending items include
   `create-slide` and `slide-order`.
3. Review the complete proposed QMD, apply, then recompute. QMD gains the heading
   and body before Results, while the original computation remains unchanged.
   Pending count becomes zero. The new native slide, including its orange rule,
   typography, placeholder roles and coordinates, is exactly equal before and
   after synchronization. The rule remains design state rather than fake text.
4. In the native image properties change x to 222, width to 720 and height to
   360; choose the soft shadow. Change the final CSV value from 8 to 30 and
   recompute. The SVG changes, with geometry and new-slide design retained.
5. Edit the new slide body to `Pending text must survive relocation.` and save
   without synchronization. In a different, empty directory copy **only**
   `presentation.qmd`, `data.csv`, `.qbento/project.json`, `.qbento/state.json`.
   Do not copy HTML, build output, history, browser data or the old directory.
6. In the new directory change the final CSV value from 30 to 40. Run
   `deno task qbento render /new/path/presentation.qmd`, then `edit` and open the
   new server URL. The presentation opens with the pending body, three-slide
   order, orange rule and styled recomputed figure. QMD is unchanged.

The relocated rebuild kept docId
`95638224-712e-479e-8c8d-87b505142c82`. The resulting figure retained
x/y/w/h `222/276/720/360` and shadow
`{y:10,blur:28,color:"rgba(10,16,28,0.32)"}`. Its source digest changed from
`6d2f3794e890417a6e52e89a4d4e996742b653fcce978f1140eb13106de8a09b`
to `7a16d8512febfaa37c860a86a7cd918ed6a719cd170ca0cb3d2b42307d5dba6c`.
The created slide's complete saved JSON was retained. The logical pending edit
(id, target, property, origin, before/after and status) was retained; composition
also populated its fresh `source` field. Source QMD in both directories had
SHA-256 `d5e42f4277729d39ba5213ed399f6bc145e1c97ee6e009545923bd709a582190`.

Screenshots were inspected visually in Chromium:
`output/playwright/conflict-review.png`,
`output/playwright/relocated-pending.png`, and
`output/playwright/relocated-figure.png`. The last image visibly shows a plot
reaching 40 with the retained shadow; the first relocated image shows the
unsynchronized body and the pending indicator. These ignored local screenshots
are supporting artifacts; the reproduction steps and automated fixtures are the
versioned evidence.

## Automated and independent checks

The integrated Deno suite passed **161 tests, 0 failures** after the code at
`a1457a5`, using `deno task test` (loopback permission required). Type checks and
lint passed. Tests include source/identity refusals, stale capture, concurrent
save/source changes, recoverable source/publication transactions, fresh conflict
resolution and approved structural promotion. Native edit/capture, decorations,
restart and stale-tab UI checks are recorded separately in
[S2-studio.md](S2-studio.md).

This supports the first Linux workflow and reconstructed-project behavior under
installed compatible dependencies. It does not establish native OS file-picker
saving, other operating systems, all Markdown/Bento conversions, PDF, widgets or
public release readiness. In particular, repeated element IDs in multiple
native layout-created slides still need a dedicated semantic/visual identity
test before broad structural compatibility is claimed.
