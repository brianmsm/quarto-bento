# Plain QMD and source KPI native acceptance on Linux

The coordinator exercised the pinned Bento editor through its actual controls in
Chromium headless on 2026-10-11. These are native browser and visual checks on
the owner's Linux machine; they do not establish another operating system or a
public release boundary. The browser did not take desktop focus.

## Plain QMD with reviewed identities

Runtime `be98fc1`, Quarto 1.10.19, Deno 2.9.6, pinned Bento
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

The temporary fixture `/tmp/qbento-plain-native-acceptance/deck.qmd` initially
contained two plain headings, three unlabelled paragraphs, bold and inline-code
text, and an R chunk producing an SVG from `data.csv`. The second heading was
`Cálculo reproducible`; neither source heading had an explicit ID.

1. The native editor displayed the original bold and inline-code text. Editing
   appended `Resultado confirmado β.` without flattening its existing markup.
   Native position fields moved that paragraph to `x=150, y=180`.
2. Save and full-page reopen preserved the pending text and geometry with QMD
   still unchanged. Native position/size fields then set the computed figure to
   `x=190, y=300, w=850, h=340`.
3. Review displayed **five separate identity patches**, including both headings
   and untouched paragraphs, followed by the actual text patch, optional visual
   annotations and the complete proposed QMD. Nothing was applied automatically.
4. Explicit Apply and Recalculate completed with zero pending edits. The entire
   emitted document matched the saved native document, including rich text and
   native IDs. Source gained only the reviewed identities, paragraph change and
   annotations. The executable R chunk remained byte-for-byte unchanged.
5. Changing the CSV from `(1,2), (2,4), (3,5)` to `(1,20), (2,5), (3,15)` and
   using Recalculate changed the SVG while retaining every other native figure
   field. The first slide remained exactly equal to its saved native state.

Final `docId`: `4eeed6f0-fe61-4395-a8f7-cf7bfe60ecaa`, revision **6**, pending
**0**. Final source SHA256:
`95af45639ecc35c38bc1429aface16accb68cdb3a965e3ec0745c0c197655894`. The receipt
is retained locally at `output/verification/plain-qmd-native/receipt.json`.

The initial deck, identity review, complete source proposal and final two slides
were visually inspected. The final paragraph retains bold/code styling and the
new text; the second slide displays the changed V-shaped SVG at the saved
position. Local screenshots are `output/playwright/plain-native-initial.png`,
`plain-native-identities.png`, `plain-native-complete-proposal.png`,
`plain-native-recomputed-text.png` and `plain-native-recomputed-plot.png`.

## Source KPI label editing and changed-data recomputation

The Studio server for this fixture loaded runtime `997d216`. A temporary copy of
`examples/kpi` was rendered at `/tmp/qbento-kpi-native-integrated/`.

The first KPI displayed the actual inline R result `20.00`. Native text editing
changed the authored label to `Media observada del grupo local`. The native
layer panel's Alt-click selected the grouped computed-value member; its native
position/size controls set `x=180, y=248, w=900, h=72`. Save and reopen retained
these edits with source unchanged.

Review showed exactly the label change and the two optional slide annotations.
Explicit Apply and Recalculate retained the inline expression
`` `r mean_text` `` and all producer code. Updating the CSV from `10,20,30` to
`100,200,300` changed the native value from **20.00 to 200.00**. Its ID,
geometry, font, weight, color, alignment and group remained exactly equal to the
saved object; only `html` changed. The label stayed synchronized and pending
became zero.

Final `docId`: `a04ad8f4-89c6-46c9-a606-6c24110f8834`, revision **5**, pending
**0**. Final source SHA256:
`389f5091cbaa8181baaabdb6d0a970082d00e25a826f1d1eedbfb58f40bb3d7b`. The receipt
is retained locally at `output/verification/kpi-native/receipt.json`. The
initial, saved, preview and final KPI screenshots were visually inspected:
`output/playwright/kpi-native-initial.png`, `kpi-native-saved.png`,
`kpi-native-preview.png` and `kpi-native-recomputed.png`. The final value and
label are readable within the native component without clipping.

A subsequent native edit changed the computed value to `999.00`. Save retained
it as a pending computed edit; Compare displayed
`Resultado calculado ·
Conflicto`, the base and fresh QMD value `200.00`, and
the native value `999.00`. Choosing the explicit source-restoration option
returned `200.00` with all saved native fields intact, no source changes and
zero pending edits at revision **7**. The conflict and restored screenshots were
visually inspected at `output/playwright/kpi-native-computed-conflict.png` and
`kpi-native-computed-restored.png`; the same receipt records this follow-up.

One UI race was observed when closing Review and requesting Recalculate before
Apply returned: the revision guard rejected the overlapping save with HTTP 409,
preserving source and state. Recalculate succeeded after Apply completed. UI
serialization was then fixed in `55e18f6` and independently reviewed. At runtime
`f7f5296`, a native browser check held the actual server's successful Apply
response after the QMD write had completed. Close, Apply, Save and Recalculate
remained disabled and the editor stayed inert; pressing Escape kept Review open.
Releasing the response updated the revision, allowed normal close and completed
Recalculate without a conflict. The source contained exactly the reviewed label
change, pending was zero at revision **10**, and the computed value and design
stayed intact. Both the locked dialog and completed deck were visually
inspected. Local evidence is
`output/verification/studio-sync-busy-native/receipt.json` and
`output/playwright/studio-sync-busy-native{,-finished}.png`.

The same integrated runtime also passed all **7** focused measurement and
delayed-Apply client tests, zero failures, in 3 seconds. The shared measurement
fixes have their separate focused and independent [KPI evidence](KPI.md); this
ordinary native fixture does not establish pathological glyph layout by itself.

## Mixed integration check

At `be98fc1`, the coordinator ran the plain-QMD, element-deletion,
source-deletion and both Studio review client suites: **22 passed, 0 failed**, 1
minute 30 seconds. The new real-Quarto test combines a plain Unicode heading, an
untouched weak rich paragraph with saved design, and confirmed deletion of a
separate identified source unit. Unicode identity-marker removal is checked for
both LF and CRLF. Type checking and the diff check passed.

An independent reviewer then combined six identity bindings, two HTML
normalizations, selected plain text/KPI label/deletion edits, an excluded
pending edit, CRLF, prior pending content on the deleted target and changed-data
R execution. That reproduction passed on the exact integrated commit with a
clean worktree. It verified the original deletion-state hash before identity
rebind, retained the excluded edit and all unrelated source/code bytes, rejected
a mutated approval state, and recomputed `20.00` to `200.00` with saved KPI
design. Local logs: `/tmp/qbento-plain-delete-integrated.log` and
`/tmp/qbento-mixed-independent-review.log`.

These receipts supplement [plain QMD](PLAIN-QMD.md),
[element deletion](ELEMENT-DELETION.md) and [source KPI](KPI.md). They are
focused acceptance evidence, not a replacement for the next complete integrated
suite.
