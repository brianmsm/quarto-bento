import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { readProject, renderProjectFromAst } from "../src/core/project.ts";
import { hashSource } from "../src/source/mod.ts";
import { startStudio } from "../src/studio/server.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
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
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-studio-diagnostics-" });
  const source = dir + "/deck.qmd",
    text =
      "## Advertencia β {#slide .qbento-design}\n\n::: {#body}\nText\n:::\n";
  await Deno.writeTextFile(source, text);
  const rendered = await renderProjectFromAst(source, {
    ast: {
      meta: {},
      blocks: [
        {
          t: "Header",
          c: [2, ["slide", ["qbento-design"], []], [{
            t: "Str",
            c: "Advertencia β",
          }]],
        },
        {
          t: "Div",
          c: [["body", [], []], [{ t: "Para", c: [{ t: "Str", c: "Text" }] }]],
        },
      ],
    },
    sourceHash: hashSource(text),
    assetDirectories: [dir],
  });
  return { dir, source, text, rendered };
}
Deno.test({
  name:
    "Studio exposes protected read-only design warnings and retains render diagnostics without pending changes",
  ignore: !canServe || !canRun,
  fn: async () => {
    const f = await fixture();
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      studio = await startStudio(f.source);
      const page = await (await fetch(studio.url)).text();
      assert(
        page.includes('id="project-diagnostics"') &&
          page.includes('aria-live="polite"'),
      );
      const token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const api = (path: string, body?: unknown) =>
        fetch(studio!.url + "/api/" + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-qbento-token": token,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const denied = await fetch(studio.url + "/api/diagnostics");
      assert(denied.status === 403);
      await denied.body?.cancel();
      const stateBefore = await Deno.readTextFile(
        f.dir + "/.qbento/state.json",
      );
      const diagnostic = await (await api("diagnostics")).json();
      assert(
        diagnostic.length === 1 && diagnostic[0].code === "MISSING_DESIGN",
      );
      assert(
        diagnostic[0].slideId === "slide" &&
          diagnostic[0].reference === ".qbento/",
      );
      assert(diagnostic[0].message.includes("Git or backup"));
      assert(
        await Deno.readTextFile(f.dir + "/.qbento/state.json") === stateBefore,
      );
      const response = await api("render", {});
      assert(response.status === 200, await response.clone().text());
      const receipt = await response.json();
      assert(
        receipt.pending === 0 &&
          receipt.diagnostics[0].code === "MISSING_DESIGN",
      );
      // The read-only endpoint reevaluates current saved bounds after render
      // and Save, so reconnects retain warnings without a stale render receipt.
      await Deno.writeTextFile(
        f.source,
        f.text +
          Array.from(
            { length: 9 },
            (_, i) =>
              `\n::: {#overflow-${i}}\n<!-- qb:overflow-body-${i} -->\nLine ${i}.\n:::\n`,
          ).join("\n"),
      );
      const overflowResponse = await api("render", {});
      assert(
        overflowResponse.status === 200,
        await overflowResponse.clone().text(),
      );
      const overflowing = await overflowResponse.json();
      assert(
        overflowing.diagnostics.some((d: { code: string }) =>
          d.code === "OVERFLOW"
        ),
      );
      assert(
        (await (await api("diagnostics")).json()).some((d: { code: string }) =>
          d.code === "OVERFLOW"
        ),
      );
      await Deno.writeTextFile(f.source, f.text);
      const corrected = await (await api("render", {})).json();
      assert(
        !corrected.diagnostics.some((d: { code: string }) =>
          d.code === "OVERFLOW"
        ),
      );
      const current = await readProject(f.source);
      const edited = structuredClone(current.emitted);
      edited.slides[0].elements[1].x = 222;
      edited.slides[0].elements[1].w = 800;
      const save = await api("save", {
        doc: edited,
        revision: current.revision,
      });
      assert(save.status === 200);
      await save.body?.cancel();
      assert((await (await api("diagnostics")).json()).length === 0);
      await Deno.writeTextFile(f.dir + "/.qbento/design-save.json", "{}");
      const interrupted = await api("diagnostics");
      assert(interrupted.status === 409);
      assert(
        (await interrupted.json()).error ===
          "DESIGN_REGISTRY_RECOVERY_REQUIRED",
      );
      assert(await Deno.readTextFile(f.source) === f.text);
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "optional headless native Studio shows missing-design banner initially and after Recalc",
  ignore: !canServe || !canRun || !browserRequested,
  fn: async () => {
    const f = await fixture();
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      studio = await startStudio(f.source);
      const url = studio.url;
      await withHeadlessChromium({ timeoutMs: 45_000 }, async (browser) => {
        await browser.send("Page.enable");
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
        let cursor = 0;
        const requests = new Set<Promise<unknown>>();
        const intercept = setInterval(() => {
          for (const event of browser.events.slice(cursor)) {
            if (event.method !== "Fetch.requestPaused") continue;
            const request = event.params.request as { url: string };
            const local = new URL(request.url).origin === new URL(url).origin;
            const promise = browser.send(
              local ? "Fetch.continueRequest" : "Fetch.failRequest",
              {
                requestId: event.params.requestId,
                ...(!local ? { errorReason: "BlockedByClient" } : {}),
              },
            ).catch(() => {}).finally(() => requests.delete(promise));
            requests.add(promise);
          }
          cursor = browser.events.length;
        }, 10);
        const evaluate = async <T>(expression: string): Promise<T> => {
          const result = await browser.send<
            { result: { value: T }; exceptionDetails?: unknown }
          >("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.exceptionDetails) {
            const debug = await browser.send("Runtime.evaluate", {
              expression:
                '({status: document.getElementById("status")?.textContent, warning: document.getElementById("project-diagnostics")?.innerText, disabled: document.getElementById("render")?.disabled, iframe: document.getElementById("editor")?.contentDocument?.body.innerText?.slice(0,2000), bento: !!document.getElementById("editor")?.contentWindow.bento})',
              returnByValue: true,
            });
            throw new Error(
              JSON.stringify({ exception: result.exceptionDetails, debug }),
            );
          }
          return result.result.value;
        };
        const wait = (condition: string) =>
          evaluate(`(async () => {
          for (let i = 0; i < 300; i++) {
            if (${condition}) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error("Studio condition timed out");
        })()`);
        try {
          await browser.send("Page.navigate", { url });
          await wait(
            'document.getElementById("project-diagnostics") && !document.getElementById("project-diagnostics").hidden && document.getElementById("render") && !document.getElementById("render").disabled',
          );
          const banner = await evaluate<string>(
            'document.getElementById("project-diagnostics").innerText',
          );
          assert(
            banner.includes("MISSING_DESIGN") && banner.includes("slide") &&
              banner.includes("Git or backup"),
            banner,
          );
          await evaluate('document.getElementById("render").click()');
          await wait(
            `document.getElementById("editor").contentWindow.__qbentoSnapshot?.revision > ${f.rendered.state.revision} && !document.getElementById("render").disabled`,
          );
          const next = await evaluate<
            { visible: boolean; text: string; pending: number }
          >('({ visible: !document.getElementById("project-diagnostics").hidden, text: document.getElementById("project-diagnostics").innerText, pending: document.getElementById("editor").contentWindow.__qbentoSnapshot.pending })');
          assert(
            next.visible && next.text.includes("MISSING_DESIGN") &&
              next.pending === 0,
            JSON.stringify(next),
          );
          await wait(
            'document.getElementById("editor").contentDocument?.body.innerText.includes("Advertencia β") && (() => { const frame = document.getElementById("editor"); const splash = frame.contentDocument?.getElementById("bento-splash"); return !splash || Number(frame.contentWindow.getComputedStyle(splash).opacity) < 0.01; })()',
          );
          const screenshot = canEnv &&
            Deno.env.get("QBENTO_STUDIO_DIAGNOSTICS_SCREENSHOT");
          if (screenshot) {
            const pixels = await browser.send<{ data: string }>(
              "Page.captureScreenshot",
              { format: "png" },
            );
            await Deno.writeFile(
              screenshot,
              Uint8Array.from(atob(pixels.data), (c) => c.charCodeAt(0)),
            );
          }
        } finally {
          clearInterval(intercept);
          await Promise.all(requests);
        }
      });
      assert(await Deno.readTextFile(f.source) === f.text);
      assert((await readProject(f.source)).pending.length === 0);
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.dir, { recursive: true });
    }
  },
});
