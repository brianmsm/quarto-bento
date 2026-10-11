import { startStudio } from "../src/studio/server.ts";
import { readProject, renderProject } from "../src/core/project.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { canonical } from "../src/state/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
Deno.test("shipped Studio creates an explicit KPI and restores/discards incomplete saved components through its local UI", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qb-component-studio-" }),
    source = dir + "/deck.qmd";
  const original =
    "---\nqbento-annotations: none\n---\n\n## A\n\nAuthored **body**.\n";
  await Deno.writeTextFile(source, original);
  await renderProject(source);
  const studio = await startStudio(source);
  try {
    await withHeadlessChromium({}, async (browser) => {
      async function evaluate(expression: string) {
        const result = await browser.send<
          { result: { value?: unknown }; exceptionDetails?: unknown }
        >("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails) {
          throw new Error(JSON.stringify(result.exceptionDetails));
        }
        return result.result.value;
      }
      const waitFor = (condition: string) =>
        evaluate(
          `(async()=>{for(let i=0;i<400;i++){if(${condition})return true;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('UI condition timed out: '+${
            JSON.stringify(condition)
          });})()`,
        );
      await browser.send("Page.navigate", { url: studio.url });
      await waitFor(
        `!document.getElementById('components')?.disabled && !!document.getElementById('editor')?.contentWindow?.bento?.doc`,
      );
      await evaluate(`document.getElementById('components').click()`);
      await waitFor(`document.getElementById('component-dialog').open`);
      await evaluate(
        `(()=>{const kind=document.getElementById('component-kind');kind.value='kpi';kind.dispatchEvent(new Event('change'));for(const input of document.querySelectorAll('#component-fields input,#component-fields textarea'))input.value=({label:'Live participants',value:'250',detail:'Pending authored text'})[input.name];document.getElementById('component-form').requestSubmit();})()`,
      );
      await waitFor(
        `!document.getElementById('component-dialog').open && !document.getElementById('components').disabled`,
      );
      let state = await readProject(source);
      eq(state.componentCreations?.length, 1);
      eq(state.pending.length, 3);
      eq(state.componentCreations![0].members.map((member) => member.role), [
        "label",
        "value",
        "detail",
      ]);
      eq(await Deno.readTextFile(source), original);
      const intent = state.componentCreations![0];
      const absent = [intent.backgroundId, intent.members[2].nativeId];
      await evaluate(
        `(()=>{const native=document.getElementById('editor').contentWindow.bento;const doc=structuredClone(native.doc);doc.slides[0].elements=doc.slides[0].elements.filter(element=>!${
          JSON.stringify(absent)
        }.includes(element.id));native.loadDoc(JSON.stringify(doc));document.getElementById('save').click();})()`,
      );
      await waitFor(
        `document.getElementById('status').textContent==='Proyecto guardado'`,
      );
      state = await readProject(source);
      eq(
        state.componentCreations![0].members[2].snapshot.html,
        "Pending authored text",
      );
      await evaluate(`document.getElementById('components').click()`);
      await waitFor(
        `document.getElementById('component-dialog').open && [...document.querySelectorAll('#component-pending button')].some(button=>button.textContent==='Restaurar componente incompleto')`,
      );
      await evaluate(
        `[...document.querySelectorAll('#component-pending button')].find(button=>button.textContent==='Restaurar componente incompleto').click()`,
      );
      await waitFor(
        `!document.getElementById('component-dialog').open && !document.getElementById('components').disabled`,
      );
      state = await readProject(source);
      eq(state.pending.length, 3);
      eq(
        state.emitted.slides[0].elements.filter((element) =>
          absent.includes(element.id)
        ).length,
        2,
      );
      const elements = state.emitted.slides[0].elements.map((element) =>
        element.id
      );
      eq(
        elements.indexOf(intent.backgroundId) <
          elements.indexOf(intent.members[0].nativeId),
        true,
      );
      await evaluate(`document.getElementById('components').click()`);
      await waitFor(
        `document.getElementById('component-dialog').open && !!document.querySelector('#component-pending button')`,
      );
      await evaluate(
        `[...document.querySelectorAll('#component-pending button')].find(button=>button.textContent==='Descartar componente pendiente').click()`,
      );
      await waitFor(
        `!document.getElementById('component-dialog').open && !document.getElementById('components').disabled`,
      );
      state = await readProject(source);
      eq(state.componentCreations, undefined);
      eq(state.pending, []);
      eq(state.bentoOnly, []);
      eq(await Deno.readTextFile(source), original);
    });
  } finally {
    await studio.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
