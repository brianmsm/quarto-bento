import { applySync, previewSync } from "../src/core/sync.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { readProject, renderProject } from "../src/core/project.ts";
import { startStudio } from "../src/studio/server.ts";
import { canonical } from "../src/state/mod.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
const browserRequested = (await Deno.permissions.query({
      name: "env",
      variable: "QBENTO_LAYOUT_BROWSER",
    })).state === "granted" && Deno.env.get("QBENTO_LAYOUT_BROWSER") === "1";
Deno.test({
  name:
    "Studio actual pinned Apply layout preserves unsaved source edits, explicitly lays out image/caption, table and chart, without native placeholder mutation",
  ignore: !browserRequested,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-studio-layout-" }),
      source = dir + "/deck.qmd";
    const qmd =
      '---\nqbento-annotations: none\n---\n\n## Figure {#figure}\n\n<!-- qb:body -->\nSource finding.\n\n![Local **β** figure](plot.svg)\n\n## Table {#tables}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<!-- qb:tablebody -->\nTable summary.\n\n## Chart {#charts}\n\n::: {#bars .bento-chart bento-chart-kind="bar"}\n| | N |\n|---|---:|\n| A | 2 |\n| B | 3 |\n:::\n\n<!-- qb:chartbody -->\nChart summary.\n';
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(
      dir + "/plot.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect x="10" y="10" width="140" height="60" fill="#156f65"/></svg>',
    );
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      const original = (await renderProject(source)).state;
      studio = await startStudio(source);
      const page = await (await fetch(studio.url)).text(),
        token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const unauthorized = await fetch(studio.url + "/api/layouts");
      ok(unauthorized.status === 403);
      await unauthorized.body?.cancel();
      const hostile = await fetch(studio.url + "/api/layouts/apply", {
        method: "POST",
        headers: {
          "x-qbento-token": token,
          origin: "https://foreign.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      ok(hostile.status === 403);
      await hostile.body?.cancel();
      const snapshot = await (await fetch(studio.url + "/api/layouts", {
        headers: { "x-qbento-token": token },
      })).json();
      ok(snapshot.layouts["two-column"]);
      await withHeadlessChromium({ timeoutMs: 60000 }, async (browser) => {
        await browser.send("Page.enable");
        await browser.send("Runtime.enable");
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const evaluate = async <T>(expression: string): Promise<T> => {
          const result = await browser.send<
            { result: { value: T }; exceptionDetails?: unknown }
          >("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.exceptionDetails) {
            throw new Error(JSON.stringify(result.exceptionDetails));
          }
          return result.result.value;
        };
        const wait = (condition: string) =>
          evaluate(
            `(async()=>{for(let i=0;i<500;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,30));}throw Error('layout condition timeout: '+${
              JSON.stringify(condition)
            }+' note='+document.getElementById('layout-note')?.textContent+' status='+document.getElementById('status')?.textContent);})()`,
          );
        const click = (id: string) =>
          evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
        const select = (id: string, value: string) =>
          evaluate(
            `(()=>{const s=document.getElementById(${
              JSON.stringify(id)
            });s.value=${
              JSON.stringify(value)
            };s.dispatchEvent(new Event('change'));})()`,
          );
        const assign = (id: string, column: number) =>
          evaluate(
            `(()=>{const s=[...document.querySelectorAll('#layout-objects select')].find(s=>s.dataset.elementId===${
              JSON.stringify(id)
            });if(!s)throw Error('No selector');s.value=${
              JSON.stringify(String(column))
            };s.dispatchEvent(new Event('change'));})()`,
          );
        const screenshot = async (name: string) => {
          await wait(
            '!document.getElementById("editor").contentDocument.getElementById("bento-splash")',
          );
          await evaluate(
            '(async()=>{const w=document.getElementById("editor").contentWindow;await w.document.fonts.ready;await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));})()',
          );
          const evidence = Deno.env.get("QBENTO_LAYOUT_EVIDENCE");
          if (evidence) {
            await Deno.mkdir(evidence, { recursive: true });
            const pixels = await browser.send<{ data: string }>(
              "Page.captureScreenshot",
              { format: "png" },
            );
            await Deno.writeFile(
              `${evidence}/${name}.png`,
              Uint8Array.from(atob(pixels.data), (c) => c.charCodeAt(0)),
            );
          }
        };
        await browser.send("Page.navigate", { url: studio!.url });
        await wait(
          'document.getElementById("layouts") && !document.getElementById("layouts").disabled && document.getElementById("editor").contentWindow.bento && !document.getElementById("editor").contentDocument.getElementById("bento-splash")',
        );
        // Source/origin + stale iframe snapshot requests cannot open the selector.
        await evaluate(
          `dispatchEvent(new MessageEvent('message',{source:document.getElementById('editor').contentWindow,origin:location.origin,data:{type:'qbento:apply-layout',docId:'foreign',revision:0}}))`,
        );
        ok(!await evaluate('document.getElementById("layouts-dialog").open'));
        await evaluate(
          `(async()=>{const f=document.getElementById('editor').contentWindow,s=f.__qbentoSnapshot;for(const bad of [{source:window,origin:location.origin,data:{type:'qbento:apply-layout',...s}},{source:f,origin:'https://foreign.invalid',data:{type:'qbento:apply-layout',...s}},{source:f,origin:location.origin,data:{type:'qbento:apply-layout',docId:s.docId,revision:s.revision-1}}])dispatchEvent(new MessageEvent('message',bad));await new Promise(r=>setTimeout(r,100));if(document.getElementById('layouts-dialog').open)throw Error('Spoofed selector request accepted');})()`,
        );
        const report = await evaluate<{ ok: boolean; dropped: unknown[] }>(
          `(()=>{const b=document.getElementById('editor').contentWindow.bento,d=structuredClone(b.doc);d.slides[0].elements.find(e=>e.id==='body').html='Unsaved β finding.';return b.loadDoc(JSON.stringify(d));})()`,
        );
        ok(report.ok && !report.dropped.length);
        // Click the real pinned native button. managedBoot must intercept before
        // native applyLayoutToCurrent can replace source IDs with template IDs.
        await evaluate(
          `(()=>{const d=document.getElementById('editor').contentDocument;const button=[...d.querySelectorAll('button')].find(b=>b.title.startsWith('Re-arrange this slide'));if(!button)throw Error('Native Apply layout missing');button.click();})()`,
        );
        await wait('document.getElementById("layouts-dialog").open');
        const presaved = await readProject(source);
        ok(presaved.pending.some((p) => p.path[0] === "html"));
        eq(
          presaved.emitted.slides[0].elements.map((e) => e.id),
          original.emitted.slides[0].elements.map((e) => e.id),
        );
        ok(
          !await evaluate(
            '!!document.getElementById("editor").contentDocument.querySelector(".ed-layoutpick-item")',
          ),
        );
        const image = presaved.emitted.slides[0].elements.find((e) =>
            e.type === "image"
          )!,
          caption = presaved.emitted.slides[0].elements.find((e) =>
            e.html === "Local <b>β</b> figure"
          )!;
        await assign("body", 0);
        await assign(image.id, 1);
        await assign(caption.id, 1);
        await click("layout-preview-button");
        await wait('!document.getElementById("layout-apply").disabled');
        await screenshot("layout-selector");
        await click("layout-apply");
        await wait(
          `!document.getElementById('layouts-dialog').open && !document.getElementById('layouts').disabled && document.getElementById('editor').contentWindow.__qbentoSnapshot.revision>${presaved.revision}`,
        );
        const applied = await readProject(source);
        eq(applied.provenance, presaved.provenance);
        eq(applied.pending, presaved.pending);
        eq(
          applied.emitted.slides[0].elements[0],
          original.emitted.slides[0].elements[0],
        );
        ok(
          applied.emitted.slides[0].elements.find((e) => e.id === image.id)!
            .w === 544,
        );
        eq(
          applied.emitted.slides[0].elements.find((e) => e.id === image.id)!
            .src,
          image.src,
        );
        await screenshot("layout-figure");
        for (
          const [slide, first, second] of [[
            "tables",
            original.emitted.slides[1].elements.find((e) => e.type === "table")!
              .id,
            "tablebody",
          ], ["charts", "bars/chart", "chartbody"]]
        ) {
          await click("layouts");
          await wait('document.getElementById("layouts-dialog").open');
          await select("layout-slide", slide);
          await assign(first, 0);
          await assign(second, 1);
          await click("layout-preview-button");
          await wait('!document.getElementById("layout-apply").disabled');
          const revision = (await readProject(source)).revision;
          await click("layout-apply");
          await wait(
            `!document.getElementById('layouts-dialog').open && !document.getElementById('layouts').disabled && document.getElementById('editor').contentWindow.__qbentoSnapshot.revision>${revision}`,
          );
        }
        await evaluate(
          `document.getElementById('editor').contentDocument.querySelectorAll('.ed-thumb')[1].click()`,
        );
        await wait(
          `!!document.getElementById('editor').contentDocument.querySelector('[data-el-id="${
            original.emitted.slides[1].elements.find((e) => e.type === "table")!
              .id
          }"] table')`,
        );
        await evaluate(
          `(()=>{const d=document.getElementById('editor').contentDocument, tables=[...d.querySelectorAll('[data-el-id] table')];if(!tables.length)throw Error('No native table');for(const t of tables){const outer=t.closest('[data-el-id]').getBoundingClientRect(), rows=[...t.querySelectorAll('tr')];if(rows.length!==2)throw Error('Missing table rows');for(const row of rows){const b=row.getBoundingClientRect();if(b.bottom>outer.bottom+1)throw Error('Clipped table row');}if(getComputedStyle(t.querySelector('td')).fontSize!=='18px')throw Error('Scaled table font');}})()`,
        );
        await screenshot("layout-table");
        // View actual chart slide through the pinned native thumbnail.
        await evaluate(
          `(()=>{const d=document.getElementById('editor').contentDocument;const t=[...d.querySelectorAll('.ed-thumb')][2];if(!t)throw Error('No native thumbnail');t.click();})()`,
        );
        await wait(
          `!!document.getElementById('editor').contentDocument.querySelector('[data-el-id="bars/chart"] svg')`,
        );
        const metrics = await evaluate(
          `(()=>{const d=document.getElementById('editor').contentDocument,svg=[...d.querySelectorAll('[data-el-id="bars/chart"] svg')].find(s=>s.viewBox.baseVal.width===544);if(!svg)throw Error('No resized native chart');const v=svg.viewBox.baseVal,labels=[...svg.querySelectorAll('text')].map(t=>{const b=t.getBBox();if(b.x<-.5||b.y<-.5||b.x+b.width>v.width+.5||b.y+b.height>v.height+.5)throw Error('Clipped label '+t.textContent);return t.textContent});for(const t of ['A','B','N'])if(!labels.includes(t))throw Error('Missing label '+t);return {w:v.width,h:v.height,labels};})()`,
        );
        await screenshot("layout-chart");
        const evidence = Deno.env.get("QBENTO_LAYOUT_EVIDENCE");
        if (evidence) {
          await Deno.writeTextFile(
            evidence + "/native-metrics.json",
            JSON.stringify({ browser: browser.version, metrics }, null, 2),
          );
        }
      });
      const final = await readProject(source);
      ok(final.pending.length === 1);
      eq(await Deno.readTextFile(source), qmd);
      await applySync(source, await previewSync(source));
      const recomputed = (await renderProject(source)).state;
      eq(recomputed.emitted, final.emitted);
      eq(recomputed.pending, []);

      eq(
        final.emitted.slides.flatMap((s) => s.elements.map((e) => e.id)),
        original.emitted.slides.flatMap((s) => s.elements.map((e) => e.id)),
      );
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
