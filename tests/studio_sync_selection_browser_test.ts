import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { canonical } from "../src/state/mod.ts";
import { startStudio } from "../src/studio/server.ts";

function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown) {
  ok(
    canonical(actual) === canonical(expected),
    `${canonical(actual)} != ${canonical(expected)}`,
  );
}

const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const canEnv =
  (await Deno.permissions.query({ name: "env" })).state === "granted";
const browserRequested = canEnv &&
  Deno.env.get("QBENTO_STUDIO_BROWSER_TEST") === "1";

Deno.test({
  name:
    "real Studio selectively reviews text independently of deletion consent and preserves excluded pending edits through render",
  ignore: !canServe || !canRun || !browserRequested,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-selection-browser-" }),
      source = dir + "/deck.qmd",
      original =
        "---\nqbento-annotations: none\n---\n\n## Selection {#selection}\n\n::: {#first}\nFirst original.\n:::\n\n::: {#second}\nSecond original.\n:::\n\n::: {#third}\nThird original.\n:::\n";
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      await Deno.writeTextFile(source, original);
      const initial = (await renderProject(source)).state,
        edited = structuredClone(initial.emitted),
        slide = edited.slides[0],
        first = slide.elements.find((e) => e.id.startsWith("first/"))!,
        second = slide.elements.find((e) => e.id.startsWith("second/"))!,
        third = slide.elements.find((e) => e.id.startsWith("third/"))!;
      ok(first && second && third);
      first.html = "First selected edit.";
      first.x = 287;
      second.html = "Second excluded edit.";
      slide.elements = slide.elements.filter((e) => e.id !== third.id);
      const saved = await saveProject(source, edited, initial.revision);
      eq(saved.pending.length, 3);
      const selected = saved.pending.find((p) =>
          p.target.elementId === first.id
        )!,
        excluded = saved.pending.find((p) => p.target.elementId === second.id)!,
        deletion = saved.pending.find((p) => p.kind === "delete-element")!;
      ok(selected && excluded && deletion);
      studio = await startStudio(source);
      await withHeadlessChromium({ timeoutMs: 120_000 }, async (browser) => {
        const evaluate = async <T>(expression: string): Promise<T> => {
          const result = await browser.send<
            { result: { value: T }; exceptionDetails?: unknown }
          >("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
          return result.result.value;
        };
        const wait = (condition: string) =>
          evaluate(
            `(async()=>{for(let n=0;n<600;n++){if(${condition})return true;await new Promise(r=>setTimeout(r,25));}throw new Error('Studio condition timed out: '+${
              JSON.stringify(condition)
            });})()`,
          );
        const box = (parent: string, id: string) =>
          `[...document.querySelectorAll('${parent} input[data-change]')].find(box=>box.dataset.change===${
            JSON.stringify(id)
          })`;
        const select = (id: string, checked: boolean) =>
          evaluate(
            `(()=>{const box=${
              box("#sync-selection", id)
            };box.checked=${checked};box.dispatchEvent(new Event('change',{bubbles:true}));})()`,
          );
        await browser.send("Page.navigate", { url: studio!.url });
        await wait(
          `!document.getElementById('save').disabled && !!document.getElementById('editor').contentWindow.bento?.doc`,
        );
        // Capture the actual UI's checked transaction receipt without bypassing its controls.
        await evaluate(
          `(()=>{const request=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await request(...args);if(String(args[0]).endsWith('/api/sync/apply'))globalThis.selectionReceipt=await response.clone().json();return response;};})()`,
        );
        await evaluate("document.getElementById('review').click()");
        await wait("document.getElementById('review-dialog').open");
        eq(
          await evaluate(
            "document.querySelectorAll('#sync-selection input:checked').length",
          ),
          3,
        );
        eq(
          await evaluate(
            "document.querySelectorAll('#delete-confirmations input').length",
          ),
          1,
        );
        eq(
          await evaluate(
            "document.querySelectorAll('#delete-confirmations input:checked').length",
          ),
          0,
        );
        eq(await evaluate("document.getElementById('apply').disabled"), true);

        // Excluding a deletion must not require consent to delete it.
        await select(deletion.id, false);
        await wait("!document.getElementById('apply').disabled");
        eq(
          await evaluate(
            `${box("#delete-confirmations", deletion.id)}.disabled`,
          ),
          true,
        );
        ok(
          (await evaluate<string>(
            "document.getElementById('patches').innerText",
          )).includes("Second excluded edit."),
        );
        await select(excluded.id, false);
        await wait(
          `!document.getElementById('apply').disabled && !document.getElementById('patches').innerText.includes('Second excluded edit.')`,
        );
        const review = await evaluate<string>(
          "document.getElementById('patches').innerText",
        );
        ok(review.includes("First selected edit."));
        ok(!review.includes("Second excluded edit."));
        eq(await Deno.readTextFile(source), original);
        eq(
          await evaluate(
            "document.querySelectorAll('#sync-selection input:checked').length",
          ),
          1,
        );
        ok(
          (await evaluate<string>(
            "document.getElementById('sync-selection-summary').textContent",
          )).includes("2 excluidos"),
        );
        await evaluate("document.getElementById('apply').click()");
        await wait(
          "document.getElementById('sync-note').textContent.startsWith('Cambios aplicados al QMD.')",
        );
        const receipt = await evaluate<
          {
            pendingRetained: boolean;
            renderNeeded: boolean;
            appliedChangeIds: string[];
          }
        >("globalThis.selectionReceipt");
        eq(receipt.pendingRetained, true);
        eq(receipt.renderNeeded, true);
        eq(receipt.appliedChangeIds, [selected.id]);
        const applied = await Deno.readTextFile(source);
        ok(applied.includes("First selected edit."));
        ok(applied.includes("Second original."));
        ok(applied.includes("Third original."));
        ok(!applied.includes("Second excluded edit."));
        eq((await readProject(source)).pending.length, 3);
        await evaluate("document.getElementById('close').click()");
        await evaluate("document.getElementById('render').click()");
        await wait(
          "document.getElementById('status').textContent==='2 cambios pendientes de sincronización' && !document.getElementById('render').disabled",
        );
        const rebuilt = await readProject(source);
        eq(rebuilt.docId, initial.docId);
        eq(
          rebuilt.pending.map((p) => p.id).sort(),
          [excluded.id, deletion.id].sort(),
        );
        eq(rebuilt.emitted, edited);
        eq(
          rebuilt.emitted.slides[0].elements.find((e) => e.id === first.id)!.x,
          287,
        );
        eq(await Deno.readTextFile(source), applied);
        eq(
          await evaluate(
            "document.getElementById('editor').contentWindow.bento.doc.docId",
          ),
          initial.docId,
        );
      });
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
