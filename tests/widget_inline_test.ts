import { pathToFileURL } from "node:url";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { ISOLATION_BOOTSTRAP } from "../src/bridge/isolation.ts";
import { spliceDocument } from "../src/render/html.ts";
import { loadBentoShell } from "../src/render/shell.ts";
import type { BentoDoc } from "../src/state/types.ts";
import type { BentoDoc as RenderDoc } from "../src/render/types.ts";
import {
  INLINE_WIDGET_CSP,
  inlineWidgetBootstrap,
} from "../src/widgets/inline.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

const document: BentoDoc = {
  format: "bento/slides",
  version: 1,
  docId: "3b019060-9c93-4098-a8ba-d281ba368f35",
  title: "Inline widget",
  size: { width: 1280, height: 720 },
  theme: {
    background: "#ffffff",
    color: "#172a35",
    accent: "#be2161",
    fontFamily: "Arial",
  },
  collab: { on: false, key: "", room: "" },
  slides: [{
    id: "one",
    background: "#ffffff",
    elements: [{
      id: "plot",
      type: "image",
      x: 120,
      y: 150,
      w: 720,
      h: 400,
      rotation: 0,
      opacity: 1,
      src: "data:image/svg+xml;base64," +
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" fill="#eef8f6"/></svg>',
        ),
    }],
  }],
};

const widget = {
  slideId: "one",
  elementId: "plot",
  html:
    `<!doctype html><html><body style="margin:0"><button id="point">Gráfico</button><script>addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({qbentoWidgetEscape:true},'*')});parent.postMessage({qbentoWidgetReady:true},'*');</script></body></html>`,
};

Deno.test("inline widget bootstrap is preserved data outside the native document", () => {
  const boot = inlineWidgetBootstrap(document, [widget]);
  assert(!boot.includes("</script"));
  assert(inlineWidgetBootstrap(document, []) === "");
  let refused = false;
  try {
    inlineWidgetBootstrap(document, [{ ...widget, elementId: "missing" }]);
  } catch {
    refused = true;
  }
  assert(refused);
});

Deno.test("native inline widgets follow edited geometry, isolate interaction, and survive native Save", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-inline-browser-",
  });
  try {
    const path = directory + "/deck.html";
    await Deno.writeTextFile(
      path,
      spliceDocument(
        await loadBentoShell(),
        document as unknown as RenderDoc,
        ISOLATION_BOOTSTRAP + inlineWidgetBootstrap(document, [widget]),
        INLINE_WIDGET_CSP,
      ),
    );
    await withHeadlessChromium({ timeoutMs: 60_000 }, async (browser) => {
      const evaluate = async <T>(expression: string): Promise<T> => {
        const response = await browser.send<{
          result: { value: T };
          exceptionDetails?: unknown;
        }>("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        assert(
          !response.exceptionDetails,
          JSON.stringify(response.exceptionDetails),
        );
        return response.result.value;
      };
      const wait = (condition: string) =>
        evaluate(
          `(async()=>{for(let i=0;i<400;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+${
            JSON.stringify(condition)
          })})()`,
        );
      await browser.send("Page.enable");
      const navigate = async (url: string) => {
        const offset = browser.events.length;
        let complete = false;
        const navigation = browser.send("Page.navigate", { url }).finally(
          () => {
            complete = true;
          },
        );
        for (let i = 0; i < 200 && !complete; i++) {
          if (
            browser.events.slice(offset).some((event) =>
              event.method === "Page.javascriptDialogOpening"
            )
          ) {
            await browser.send("Page.handleJavaScriptDialog", { accept: true });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return await navigation;
      };
      await navigate(pathToFileURL(path).href);
      await wait("!!document.querySelector('.qbento-widget-layer button')");
      assert(
        await evaluate(
          "document.querySelector('.qbento-widget-layer iframe').hidden",
        ),
      );
      const point = await evaluate<{ x: number; y: number }>(
        "(()=>{const r=document.querySelector('.qbento-widget-layer button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      await browser.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...point,
        button: "left",
        clickCount: 1,
      });
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...point,
        button: "left",
        clickCount: 1,
      });
      await wait(
        "!document.querySelector('.qbento-widget-layer iframe').hidden",
      );
      assert(
        await evaluate(
          "document.querySelector('.qbento-widget-layer iframe').getAttribute('sandbox')==='allow-scripts'",
        ),
      );
      assert(
        await evaluate(
          "(()=>{const frame=document.querySelector('.qbento-widget-layer iframe');try{return frame.contentWindow.document===null}catch{return true}})()",
        ),
      );
      const aligned = () =>
        evaluate<boolean>(
          "(()=>{const frame=document.querySelector('.qbento-widget-layer iframe'),node=frame.closest('.bento-el'),a=frame.getBoundingClientRect(),b=node.getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1})()",
        );
      assert(
        await aligned(),
        await evaluate<string>(
          "JSON.stringify([document.querySelector('.qbento-widget-layer iframe').getBoundingClientRect().toJSON(),document.querySelector('.qbento-widget-layer iframe').closest('.bento-el').getBoundingClientRect().toJSON()])",
        ),
      );
      await evaluate(
        "(()=>{const frame=document.querySelector('.qbento-widget-layer iframe');window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{qbentoWidgetEscape:true}}));return frame.hidden})()",
      ).then((hidden) =>
        assert(!hidden, "foreign frames cannot stop interaction")
      );
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await wait(
        "document.querySelector('.qbento-widget-layer iframe').hidden",
      );
      assert(
        await evaluate(
          "document.querySelector('.qbento-widget-layer iframe').hidden",
        ),
      );
      assert(
        await evaluate(
          "document.activeElement===document.querySelector('.qbento-widget-layer button')",
        ),
      );
      await evaluate(
        "(()=>{const doc=structuredClone(bento.doc),el=doc.slides[0].elements[0];Object.assign(el,{x:230,y:170,w:500,h:310});bento.loadDoc(JSON.stringify(doc));})()",
      );
      await wait("!!document.querySelector('.qbento-widget-layer button')");
      await evaluate(
        "document.querySelector('.qbento-widget-layer button').click()",
      );
      await wait(
        "!document.querySelector('.qbento-widget-layer iframe').hidden",
      );
      assert(await aligned(), "widget follows native geometry after rerender");
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1100,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      assert(await aligned(), "widget follows viewport scaling");
      await browser.send("Emulation.setEmulatedMedia", { media: "print" });
      assert(
        await evaluate(
          "getComputedStyle(document.querySelector('.qbento-widget-layer')).display==='none'",
        ),
      );
      await browser.send("Emulation.setEmulatedMedia", { media: "screen" });
      const saved = await evaluate<string>("bento.serialize()");
      assert(saved.includes("__qbentoInlineWidgets"));
      assert(
        !saved.includes('class="qbento-widget-layer"'),
        "native Save excludes transient overlays",
      );
      await Deno.writeTextFile(directory + "/saved.html", saved);
      await navigate(pathToFileURL(directory + "/saved.html").href);
      await wait("!!document.querySelector('.qbento-widget-layer button')");
      assert(await evaluate("bento.doc.slides[0].elements[0].x===230"));
      await evaluate(
        "(()=>{const doc=structuredClone(bento.doc);doc.slides[0].elements[0].src='data:image/svg+xml;base64,'+btoa('<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>');bento.loadDoc(JSON.stringify(doc));})()",
      );
      await wait("!document.querySelector('.qbento-widget-layer')");
      const readonly = structuredClone(document);
      readonly.readonly = true;
      await Deno.writeTextFile(
        directory + "/present.html",
        spliceDocument(
          await loadBentoShell(),
          readonly as unknown as RenderDoc,
          ISOLATION_BOOTSTRAP + inlineWidgetBootstrap(readonly, [widget]),
          INLINE_WIDGET_CSP,
        ),
      );
      await navigate(pathToFileURL(directory + "/present.html").href);
      await wait(
        "!!document.querySelector('.qbento-widget-layer iframe:not([hidden])')",
      );
      assert(await aligned(), "readonly presentation activates in place");
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
