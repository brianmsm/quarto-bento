import { readProject, renderProjectFromAst } from "../src/core/project.ts";
import { hashSource } from "../src/source/mod.ts";
import { startStudio } from "../src/studio/server.ts";
import { extractDocument } from "../src/render/html.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
Deno.test({
  name:
    "Studio binds deck revision to its document and rejects stale second-editor saves",
  ignore: !canServe,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-studio-" });
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      const source = dir + "/deck.qmd",
        text = "## Slide {#slide}\n\n::: {#body}\nText\n:::\n";
      await Deno.writeTextFile(source, text);
      const { state } = await renderProjectFromAst(source, {
        ast: {
          meta: {},
          blocks: [
            {
              t: "Header",
              c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]],
            },
            {
              t: "Div",
              c: [["body", [], []], [{
                t: "Para",
                c: [{ t: "Str", c: "Text" }],
              }]],
            },
          ],
        },
        sourceHash: hashSource(text),
        assetDirectories: [dir],
      });
      studio = await startStudio(source);
      const page = await (await fetch(studio.url)).text();
      const token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const oldDeck = await (await fetch(studio.url + "/deck")).text();
      const receipt = JSON.parse(
        oldDeck.match(/Object\.freeze\((\{"docId"[^\n]+?\})\)/)![1],
      );
      assert(
        receipt.revision === state.revision && receipt.docId === state.docId,
      );
      const newer = structuredClone(state.emitted);
      newer.slides[0].elements[1].html = "Saved in another tab";
      const post = (payload: unknown, headers: Record<string, string> = {}) =>
        fetch(studio!.url + "/api/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": token,
            ...headers,
          },
          body: JSON.stringify(payload),
        });
      const saved = await post({ doc: newer, revision: state.revision });
      assert(saved.status === 200);
      const savedReceipt = await saved.json();
      assert(savedReceipt.revision > receipt.revision);
      const stale = await post({
        doc: extractDocument(oldDeck),
        revision: receipt.revision,
      });
      assert(stale.status === 409);
      assert((await stale.json()).error === "STALE_REVISION");
      assert(
        (await readProject(source)).emitted.slides[0].elements[1].html ===
          "Saved in another tab",
      );
      const crossOrigin = await post({
        doc: newer,
        revision: savedReceipt.revision,
      }, { Origin: "https://hostile.invalid" });
      assert(crossOrigin.status === 403);
      await crossOrigin.body?.cancel();
      const noToken = await post({}, { "x-qbento-token": "" });
      assert(noToken.status === 403);
      await noToken.body?.cancel();
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
