import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { readProject, renderProject } from "../src/core/project.ts";
import { startStudio } from "../src/studio/server.ts";
import { fork, timeline } from "./helpers/graphs.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
const browserRequested = (await Deno.permissions.query({
      name: "env",
      variable: "QBENTO_RELATIONS_BROWSER",
    })).state === "granted" &&
  Deno.env.get("QBENTO_RELATIONS_BROWSER") === "1";
async function fixture(counter = false) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-studio-relations-" }),
    source = dir + "/deck.qmd";
  const sentinel = dir + "/executions.txt";
  const text = "---\nqbento-annotations: none\n---\n\n" + fork + "\n" +
    timeline +
    (counter
      ? "\n```{r}\n#| echo: false\n#| include: false\nfile <- " +
        JSON.stringify(sentinel) +
        "\nn <- if (file.exists(file)) as.integer(readLines(file)) else 0L\nwriteLines(as.character(n + 1L), file)\n```\n"
      : "");
  await Deno.writeTextFile(source, text);
  const rendered = await renderProject(source);
  return { dir, source, text, sentinel, rendered };
}

Deno.test({
  name:
    "Studio relationship routes require session origin, JSON and bounded body, and preserve CAS/source guards",
  ignore: !canServe,
  fn: async () => {
    const f = await fixture();
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      studio = await startStudio(f.source);
      const page = await (await fetch(studio.url)).text(),
        token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      assert(
        page.includes('id="relations"') && page.includes('for="relation-from"'),
      );
      const endpoint = studio.url + "/api/graphs/relations";
      const get = () =>
        fetch(endpoint, { headers: { "x-qbento-token": token } });
      const post = (payload: unknown, headers: Record<string, string> = {}) =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            "x-qbento-token": token,
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(payload),
        });
      const snapshot = await (await get()).json(),
        request = {
          expectedDocId: snapshot.docId,
          expectedRevision: snapshot.revision,
          expectedSourceHash: snapshot.sourceHash,
          slideId: "flow",
          componentId: "graph",
          edgeId: "edge-a",
          fromNodeId: "right",
          toNodeId: "left",
        };
      const before = await Deno.readTextFile(f.dir + "/.qbento/state.json");
      for (
        const headers of [{ "x-qbento-token": "" }, {
          Origin: "https://hostile.invalid",
        }] as Record<string, string>[]
      ) {
        const response = await post(request, headers);
        assert(response.status === 403);
        await response.body?.cancel();
      }
      const missingToken = await fetch(endpoint);
      assert(missingToken.status === 403);
      await missingToken.body?.cancel();
      const wrongType = await post(request, { "Content-Type": "text/plain" });
      assert(wrongType.status === 415);
      await wrongType.body?.cancel();
      const large = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-qbento-token": token,
          "Content-Type": "application/json",
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(8193));
            controller.close();
          },
        }),
      });
      assert(large.status === 413);
      await large.body?.cancel();
      const foreign = await post({
        ...request,
        fromNodeId: "input/paragraph:1",
      });
      assert(
        foreign.status === 409 &&
          (await foreign.json()).error === "GRAPH_ENDPOINT_SCOPE",
      );
      assert(await Deno.readTextFile(f.dir + "/.qbento/state.json") === before);
      const saved = await post(request);
      assert(saved.status === 200);
      const receipt = await saved.json();
      assert(
        receipt.docId === snapshot.docId &&
          receipt.revision > snapshot.revision && receipt.pending === 1,
      );
      const stale = await post(request);
      assert(
        stale.status === 409 && (await stale.json()).error === "STALE_REVISION",
      );
      await Deno.writeTextFile(f.source, f.text + "\nCambio externo.\n");
      const staleSource = await post({
        ...request,
        expectedRevision: receipt.revision,
      });
      assert(
        staleSource.status === 409 &&
          (await staleSource.json()).error === "STALE_SOURCE",
      );
      const js = await (await fetch(studio.url + "/relations.js")).text();
      assert(js.includes("attachGraphRelations"));
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "optional headless Studio reconnects detached anchors, saves/reopens Relations, reviews exact QMD and recalculates only on request",
  ignore: !canServe || !browserRequested,
  fn: async () => {
    const f = await fixture(true);
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      assert((await Deno.readTextFile(f.sentinel)).trim() === "1");
      studio = await startStudio(f.source);
      await withHeadlessChromium({ timeoutMs: 60_000 }, async (browser) => {
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
            const detail = await browser.send("Runtime.evaluate", {
              expression:
                '({status:document.getElementById("status")?.textContent,note:document.getElementById("relation-note")?.textContent,sync:document.getElementById("sync-note")?.textContent})',
              returnByValue: true,
            });
            throw new Error(
              JSON.stringify({ exception: result.exceptionDetails, detail }),
            );
          }
          return result.result.value;
        };
        const wait = (condition: string) =>
          evaluate(`(async () => {
          for (let i = 0; i < 400; i++) { if (${condition}) return true; await new Promise(resolve => setTimeout(resolve, 50)); }
          throw new Error("Studio relationship condition timed out");
        })()`);
        const click = (id: string) =>
          evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
        const select = (id: string, value: string) =>
          evaluate(
            `(() => { const select=document.getElementById(${
              JSON.stringify(id)
            }); select.value=${
              JSON.stringify(value)
            }; select.dispatchEvent(new Event("change")); })()`,
          );
        await browser.send("Page.navigate", { url: studio!.url });
        await wait(
          'document.getElementById("relations") && !document.getElementById("relations").disabled && !!document.getElementById("editor").contentWindow.bento',
        );
        // Use the actual pinned native API to reproduce the saved shape left by
        // LineEditor endpoint drag. The explicit selector supplies semantic IDs.
        const report = await evaluate<{ ok: boolean; dropped: unknown[] }>(
          '(() => { const api=document.getElementById("editor").contentWindow.bento, doc=structuredClone(api.doc); const edge=doc.slides[0].elements.find(element=>element.id==="edge-a/qb-edge"); edge.from.side="top"; edge.fill="#21856c"; return api.loadDoc(JSON.stringify(doc)); })()',
        );
        assert(report.ok && !report.dropped.length, JSON.stringify(report));
        await click("save");
        await wait(
          'document.getElementById("status").textContent === "Proyecto guardado"',
        );
        await evaluate(
          '(() => { const api=document.getElementById("editor").contentWindow.bento, doc=structuredClone(api.doc); const edge=doc.slides[0].elements.find(element=>element.id==="edge-a/qb-edge"); delete edge.from; delete edge.to; return api.loadDoc(JSON.stringify(doc)); })()',
        );
        await click("relations");
        await wait('document.getElementById("relations-dialog").open');
        assert(
          (await evaluate<string>(
            'document.getElementById("relation-note").textContent',
          )).includes("desvinculado"),
        );
        const nodes = await evaluate<string[]>(
          'Array.from(document.getElementById("relation-from").options).map(option=>option.textContent)',
        );
        assert(
          nodes.length === 3 && nodes[2].includes("Modelo B") &&
            nodes[2].includes("#right"),
        );
        await select("relation-from", "right");
        await select("relation-to", "left");
        const dialogEvidence = Deno.env.get("QBENTO_RELATIONS_EVIDENCE_DIR");
        if (dialogEvidence) {
          await Deno.mkdir(dialogEvidence, { recursive: true });
          const pixels = await browser.send<{ data: string }>(
            "Page.captureScreenshot",
            { format: "png" },
          );
          await Deno.writeFile(
            dialogEvidence + "/relations.png",
            Uint8Array.from(atob(pixels.data), (char) => char.charCodeAt(0)),
          );
        }
        const detachedRevision = (await readProject(f.source)).revision;
        await click("relation-save");
        await wait(
          `!document.getElementById("relations-dialog").open && document.getElementById("editor").contentWindow.__qbentoSnapshot?.revision > ${detachedRevision} && !document.getElementById("relations").disabled`,
        );
        const saved = await readProject(f.source),
          edge = saved.emitted.slides[0].elements.find((element) =>
            element.id === "edge-a/qb-edge"
          )!;
        assert(
          (edge.from as { el: string; side: string }).el === "right/qb-node" &&
            (edge.from as { side: string }).side === "top",
        );
        assert(edge.fill === "#21856c" && saved.pending.length === 1);
        assert(await Deno.readTextFile(f.source) === f.text);
        assert(
          (await Deno.readTextFile(f.sentinel)).trim() === "1",
          "relationship Save executed R",
        );
        await click("relations");
        await wait('document.getElementById("relations-dialog").open');
        assert(
          await evaluate(
            'document.getElementById("relation-from").value === "right" && document.getElementById("relation-to").value === "left"',
          ),
        );
        await select("relation-slide", "history");
        assert(
          await evaluate(
            'document.getElementById("relation-from").disabled && document.getElementById("relation-to").disabled && document.getElementById("relation-save").disabled && document.getElementById("relation-note").textContent.includes("solo lectura") && document.getElementById("relation-sequence").textContent.includes("Diseño (#start) → Estudio (#study) → Informe (#report)")',
          ),
        );
        await click("relation-close");
        await click("review");
        await wait(
          'document.getElementById("review-dialog").open && !document.getElementById("apply").disabled',
        );
        const review = await evaluate<string>(
          'document.getElementById("patches").innerText',
        );
        assert(
          review.includes("6. Relación del diagrama") &&
            review.includes("QMD completo propuesto") &&
            review.includes('from="right" to="left"'),
          review,
        );
        assert(
          await evaluate(
            '(() => { const section=Array.from(document.getElementById("patches").querySelectorAll("section")).find(section=>section.querySelector("h3")?.textContent.includes("6. Relación del diagrama")); return section?.querySelector("h3")?.textContent.includes("graph · edge-a · from") && section.querySelector(".before").textContent==="input" && section.querySelector(".after").textContent==="right"; })()',
          ),
        );
        assert(
          (await Deno.readTextFile(f.sentinel)).trim() === "1",
          "relationship review executed R",
        );
        if (dialogEvidence) {
          const pixels = await browser.send<{ data: string }>(
            "Page.captureScreenshot",
            { format: "png" },
          );
          await Deno.writeFile(
            dialogEvidence + "/review.png",
            Uint8Array.from(atob(pixels.data), (char) => char.charCodeAt(0)),
          );
        }
        await click("apply");
        await wait(
          'document.getElementById("sync-note").textContent.startsWith("Cambios aplicados al QMD.") && !document.getElementById("close").disabled',
        );
        assert(
          (await Deno.readTextFile(f.source)).includes(
            'from="right" to="left"',
          ),
        );
        assert(
          (await Deno.readTextFile(f.sentinel)).trim() === "1",
          "relationship Apply executed R",
        );
        await click("close");
        const appliedRevision = (await readProject(f.source)).revision;
        await click("render");
        await wait(
          `document.getElementById("editor").contentWindow.__qbentoSnapshot?.revision > ${appliedRevision} && !document.getElementById("relations").disabled`,
        );
        const final = await readProject(f.source);
        assert(final.docId === saved.docId && !final.pending.length);
        assert((await Deno.readTextFile(f.sentinel)).trim() === "2");
        assert(
          await evaluate(
            '(() => { const api=document.getElementById("editor").contentWindow.bento; const edge=api.doc.slides[0].elements.find(element=>element.id==="edge-a/qb-edge"); return edge.from.el==="right/qb-node" && edge.from.side==="top" && edge.to.el==="left/qb-node" && edge.fill==="#21856c"; })()',
          ),
        );
        if (dialogEvidence) {
          await Deno.writeTextFile(
            dialogEvidence + "/receipt.json",
            JSON.stringify(
              {
                chromium: browser.version,
                docId: final.docId,
                revision: final.revision,
                pending: final.pending.length,
                sourceHash: final
                  .provenance[JSON.stringify(["flow", "edge-a/qb-edge"])].source
                  ?.hash,
                executions: 2,
                validation:
                  "headless actual pinned native API + Studio selectors, review/apply/recalculate; screenshots of actual dialogs",
              },
              null,
              2,
            ),
          );
        }
      });
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.dir, { recursive: true });
    }
  },
});
