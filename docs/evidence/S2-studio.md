# Integrated Studio and native capture browser evidence

Date: 2026-10-11. Initial root implementation:
`9d8b4741d3cb54efd5be5acb7f8f357c7665d93e`. Bento revision:
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. These were fresh live Chromium tests
on temporary copies of `fixtures/basic`, not mutations of root fixtures. No root
implementation files were modified by the browser-validation agent. Browser
tests used Playwright's CLI, real Bento controls, and API reads to measure
outcomes.

## Studio ordinary workflow

1. Copy `presentation.qmd` and `data.csv` into a fresh temporary directory.
2. Run `deno task qbento edit /tmp/qbento-studio-probe/presentation.qmd`.
3. Open the returned loopback URL.
4. Select native computed image `fig-values`. In native properties set X to 210,
   W to 740 and H to 360, and select the `elevated` shadow preset.
5. Use the native Shape menu to insert a Rectangle.
6. Double-click the source-backed paragraph and replace its text with
   `Pending authored text from Studio.`. Escape out of text editing.
7. Click the **parent Studio** button `Guardar proyecto`.
8. Reload, then change the last CSV value from 8 to 16 and click `Recalcular`.
9. Stop the server, restart `qbento edit` on the same source, and open the new
   URL.

Observed results:

- Save returned revision 2 and one authored `bento-ahead` pending field
  (`html`).
- Figure design saved sparsely: x 210, w 740, h 360, shadow
  `{y:24,blur:56,color:"rgba(8,12,22,0.45)"}`.
- Reload retained the pending paragraph, shape and figure design.
- Changed-data recomputation retained all of those while changing the figure
  source SHA-256 from
  `31e9064e4fa1af83c4d096d9927e64665d45b9a70deb6d5f54652fc89ae85213` to
  `8020e8bd2c8518e6482645927c08b1392903a1364b13b8be1822b9b46aec1f1a`.
- `docId` remained `12f7a0dd-1c09-43d6-b8cd-5f8e50ec8274`.
- Source QMD remained byte-identical to the original fixture through that
  ordinary loop: SHA-256
  `e25450069f50ed66b949d4894cc03a251ec61c9dd660d27142713a338108b046`.
- A new server process recovered the same saved paragraph, x/w/h, shape and
  docId. It displayed `1 cambios pendientes de sincronización`.
- Native Save was not mistaken for project persistence: these steps used the
  parent's explicit `Guardar proyecto` action.

Visually inspected screenshot after recomputation:
`/tmp/.playwright-cli/page-2026-10-11T01-19-52-959Z.png`. The actual editor,
pending text, recomputed R plot with y-axis reaching 16, elevated shadow and
orange rectangle were visible. The rectangle overlays part of the plot because
that was the native default insertion position in this test.

## Original S0 native HTML capture workflow

A separate temporary fixture `/tmp/qbento-native-probe` was rendered using the
CLI and served as plain standalone HTML, without the Studio wrapper.

1. In native Bento select the actual computed image and set x 260, w 700, and
   shadow `soft` using its property panel.
2. Call the real upstream `window.bento.serialize()` and download those returned
   HTML bytes to `native-edited.bento.html` using a browser Blob download.
3. Run `qbento capture presentation.qmd native-edited.bento.html` explicitly.
4. Change CSV value 8 to 20 and run `qbento render presentation.qmd`.
5. Open the newly generated file in a fresh browser tab and inspect it.

Native Save and Save a copy were attempted, but the headless browser's File
System Access picker did not yield an observable download. The verified path
therefore uses **native serialize plus browser download**, not a claimed
successful operating-system file-picker save. The HTML bytes came entirely from
upstream; no test code patched the edited model or generated HTML to simulate an
edit.

Observed:

- Capture: revision 2, pending 0, overrides 2 (figure fields plus native
  modified timestamp).
- Re-render: revision 3, pending 0, no projection diagnostics.
- Figure source SHA-256 changed from `31e9064e…` to
  `cd715822185b4d95c180dd1cb86a89f1e4d974743a6a107c82acc5ee06951fb9`.
- x 260, w 700, h 394 and shadow `{y:10,blur:28,color:"rgba(10,16,28,0.32)"}`
  were unchanged.
- `docId` remained `111bebe2-92aa-42c1-bfcd-c47aaa667f7a`.
- Native serialized HTML retained CSP, isolation bootstrap and exact
  credential-free collaboration sentinel `{room:"",key:"",on:false}`.
- QMD SHA-256 remained the original fixture value above.
- Replacing the generated output with the actual earlier native-edited HTML made
  the next render fail immediately with `UNCAPTURED_HTML_EDITS`. The verified
  recomputed output was restored after this refusal check.

Fresh regenerated editor screenshot inspected:
`/tmp/.playwright-cli/page-2026-10-11T01-23-50-827Z.png`. The recomputed plot
reached 20, retained the smaller width and soft shadow, and showed no editor
recovery overlay.

## Receipt preservation for stale-copy protection

A separate HTML fixture added the following original-shell script before boot:

```html
<script id="qbento-receipt" type="application/json">
{
  "version": 1,
  "generation": "9cbf51f6-3168-4c1e-8e59-782e79a07a5b",
  "docId": "111bebe2-92aa-42c1-bfcd-c47aaa667f7a",
  "publishedDocSha256": "43fafd343fc76179b220f8d10596a6e4b38551fbba1e9329045336755a0a11f1"
}
</script>
```

Fresh upstream serialization preserved exactly one `#qbento-receipt` whose
`textContent` was byte-identical to the original. This confirms the upstream
pristine-shell mechanism can retain an immutable publication receipt outside
`#bento-doc`. It does not, by itself, validate the host's generation/receipt
rules.

## API boundary checks

Against the running Studio on 127.0.0.1:

| Request                                   | Actual status |
| ----------------------------------------- | ------------: |
| GET state, missing token                  |           403 |
| GET state, invalid token                  |           403 |
| GET state, valid token but foreign Origin |           403 |
| GET state, valid token but forged Host    |           403 |
| POST save, valid token but text/plain     |           415 |
| GET state, valid token and local origin   |           200 |

These are targeted checks, not a full security audit. Remote update requests
were blocked by the advertised CSP. A missing favicon produced 403; it did not
affect the document workflow.

## P1 finding: edits during recalculation can strand the bridge

Reproduced on the initial implementation above; a later fix must be retested.

1. Add `Sys.sleep(8)` to the R chunk in the **temporary copy**, so the race is
   repeatable.
2. Click Recalcular. Once the status says `Recalculando…`, edit the native
   paragraph to `EDIT DURING RENDER MUST SURVIVE` and Escape out of editing.
3. When computation completes, upstream opens a beforeunload confirmation
   because the frame is being reloaded with newer unsaved edits.
4. Cancel that navigation, keeping the visible text.
5. Click Guardar proyecto.

The newer text remains on screen, but console reports `BENTO_BRIDGE_DISPOSED`
from `bridge.save()` called by `client.js`'s save handler. The render handler
disposed the bridge **before** knowing the iframe navigation would succeed. The
synchronous exception also escapes `.catch()` attached to the promise-returning
call. The editor was left editable while computing, permitting the new unsaved
text in the first place. Accepting the navigation risks replacing that newer
text with the pre-render saved version; that destructive branch was not needed
to confirm the bug and was not claimed as directly observed.

Suggested acceptance for a correction: editing is explicitly blocked during the
render operation, or every post-start edit is captured/reconciled before iframe
replacement; canceling any navigation must leave a functioning save bridge.
