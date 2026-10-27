import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ChromiumClient,
  withHeadlessChromium,
} from "../src/browser/chromium.ts";
import {
  captureProject,
  readProject,
  readProjectPresenter,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import {
  loadProjectWidgets,
  persistedInlineWidgets,
  preparedInlineWidgets,
} from "../src/core/widgets.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { startStudio } from "../src/studio/server.ts";
import { savePlotlyCamera } from "../src/core/widget-camera.ts";
import { verifyStaticPng } from "../src/widgets/presenter.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => Promise<unknown>, expected: RegExp) {
  try {
    await action();
  } catch (error) {
    assert(expected.test(String(error)), String(error));
    return;
  }
  throw new Error("Expected refusal " + expected);
}

interface WidgetContext {
  contextId?: number;
  sessionId?: string;
}

/** Identify the actual owner frame, including opaque-origin out-of-process iframes. */
async function plotlyChildContext(
  browser: ChromiumClient,
): Promise<WidgetContext> {
  const root = await browser.send<{ root: { nodeId: number } }>(
    "DOM.getDocument",
  );
  const iframe = await browser.send<{ nodeId: number }>("DOM.querySelector", {
    nodeId: root.root.nodeId,
    selector: ".qbento-widget-layer iframe",
  });
  assert(iframe.nodeId, "active native widget iframe exists");
  const owner = await browser.send<{ node: { frameId?: string } }>(
    "DOM.describeNode",
    {
      nodeId: iframe.nodeId,
    },
  );
  const frameId = owner.node.frameId;
  assert(frameId, "native iframe has a CDP owner frame identity");
  const targets = await browser.send<{
    targetInfos: { targetId: string; type: string; url: string }[];
  }>("Target.getTargets");
  const target = targets.targetInfos.find((info) => info.targetId === frameId);
  if (target) {
    const attached = await browser.send<{ sessionId: string }>(
      "Target.attachToTarget",
      {
        targetId: target.targetId,
        flatten: true,
      },
    );
    await browser.send("Runtime.enable", {}, attached.sessionId);
    return { sessionId: attached.sessionId };
  }
  for (const event of [...browser.events].reverse()) {
    if (event.method !== "Runtime.executionContextCreated") continue;
    const context = event.params.context as {
      id: number;
      auxData?: { frameId?: string; isDefault?: boolean };
    };
    if (context.auxData?.frameId === frameId && context.auxData.isDefault) {
      return { contextId: context.id, sessionId: event.sessionId };
    }
  }
  throw new Error(
    "No execution target for native widget frame " +
      JSON.stringify({ frameId, targets: targets.targetInfos }),
  );
}

/** CDP input coordinates are local to the OOPIF target, not its owner's viewport. */
async function dragPlotlyCamera(
  browser: ChromiumClient,
  context: WidgetContext,
  rootPoint: { x: number; y: number },
) {
  const inspected = await browser.send<{
    result: { value: { x: number; y: number; diagnostics: unknown } };
    exceptionDetails?: unknown;
  }>("Runtime.evaluate", {
    expression: `(()=>{
      const canvas=[...document.querySelectorAll('#chart .gl-container canvas')].find(c=>{const r=c.getBoundingClientRect();return r.width>100&&r.height>100});
      if(!canvas)throw new Error('Real Plotly canvas has no usable input surface');
      const r=canvas.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
      window.__qbentoPointerEvidence={events:[],canvas:r.toJSON(),viewport:{width:innerWidth,height:innerHeight},hit:hit?.tagName+' '+hit?.className};
      for(const type of ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup'])document.addEventListener(type,event=>{
        const evidence=window.__qbentoPointerEvidence;
        if(evidence.events.length<64)evidence.events.push({type:event.type,trusted:event.isTrusted,x:event.clientX,y:event.clientY,buttons:event.buttons,target:event.target?.tagName+' '+event.target?.className});
      },true);
      return{x,y,diagnostics:window.__qbentoPointerEvidence};
    })()`,
    returnByValue: true,
    ...(context.contextId === undefined
      ? {}
      : { contextId: context.contextId }),
  }, context.sessionId);
  assert(
    !inspected.exceptionDetails,
    JSON.stringify(inspected.exceptionDetails),
  );
  const sessionId = context.contextId === undefined
    ? context.sessionId
    : undefined;
  const point = sessionId ? inspected.result.value : rootPoint;
  await browser.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  }, sessionId);
  await browser.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  }, sessionId);
  for (let i = 1; i <= 12; i++) {
    await browser.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + i * 6,
      y: point.y + i * 3,
      button: "left",
      buttons: 1,
    }, sessionId);
    await browser.send("Runtime.evaluate", {
      expression:
        "(()=>{const next=Promise.withResolvers();requestAnimationFrame(()=>next.resolve(true));return next.promise})()",
      awaitPromise: true,
      ...(context.contextId === undefined
        ? {}
        : { contextId: context.contextId }),
    }, context.sessionId);
  }
  await browser.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x + 72,
    y: point.y + 36,
    button: "left",
    buttons: 0,
    clickCount: 1,
  }, sessionId);
  const observed = await browser.send<{
    result: {
      value: { pressed: boolean; released: boolean; evidence: unknown };
    };
    exceptionDetails?: unknown;
  }>("Runtime.evaluate", {
    expression:
      "(()=>{const evidence=window.__qbentoPointerEvidence;return{pressed:evidence.events.some(e=>e.type==='mousedown'&&e.trusted),released:evidence.events.some(e=>e.type==='mouseup'&&e.trusted),evidence}})()",
    returnByValue: true,
    ...(context.contextId === undefined
      ? {}
      : { contextId: context.contextId }),
  }, context.sessionId);
  assert(!observed.exceptionDetails, JSON.stringify(observed.exceptionDetails));
  assert(
    observed.result.value.pressed && observed.result.value.released,
    "Actual mouse input did not reach the Plotly child: " +
      JSON.stringify(observed.result.value.evidence),
  );
}

const source = `---
title: Native offline Plotly
---

## Three dimensions {#three}

::: {#cloud}

\`\`\`{r}
#| label: plot-cloud
#| echo: false
#| output-location: slide
plotly::plot_ly(x=c(1,2,3,4), y=c(3,1,4,2), z=c(2,4,1,3),
                type="scatter3d", mode="lines+markers") |>
  plotly::layout(scene=list(camera=list(eye=list(x=1.4,y=1.4,z=1.1))))
\`\`\`

:::
`;
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";

Deno.test({
  name:
    "real offline Plotly inline activation, camera, native Save and verified Studio views",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-inline-plotly-" });
    let studio: { url: string; shutdown: () => Promise<void> } | undefined;
    let nativeSave: { path: string; camera: string } | undefined;
    try {
      const path = join(dir, "deck.qmd"), stateDir = join(dir, ".qbento");
      await Deno.writeTextFile(path, source);
      const rendered = await renderProject(path), state = rendered.state;
      const displayIndex = state.emitted.slides.findIndex((slide) =>
        slide.elements.some((e) => e.id === "cloud")
      );
      assert(displayIndex >= 0);
      const display = state.emitted.slides[displayIndex];
      const staticSrc = String(
        display.elements.find((e) => e.id === "cloud")!.src,
      );
      assert(
        display.id !== "three",
        "output-location publishes a separate display slide",
      );
      assert(state.widgets!.entries[0].slideId === display.id);
      const key = targetKey({ slideId: display.id, elementId: "cloud" });
      const prepared = await loadProjectWidgets(path, stateDir, state);
      assert(prepared.bundles.length === 1);
      assert(prepared.bundles[0].candidate.spec.data[0].type === "scatter3d");
      assert(
        prepared.bundles[0].candidate.source.sourceHash ===
          scanSource(source).hash,
      );
      assert(prepared.bundles[0].candidate.source.slideId === "three");
      const presenter = await readProjectPresenter(path, state.revision);
      const payload = JSON.parse(
        presenter.match(
          /<script id="qb-presenter-data" type="application\/json">([\s\S]*?)<\/script>/,
        )![1],
      );
      assert(
        payload.widgets.length === 1 &&
          payload.widgets[0].slideId === display.id,
      );
      assert(
        (await persistedInlineWidgets(path, stateDir, state)).length === 1,
      );
      assert(
        (await preparedInlineWidgets(prepared, prepared.source, state.emitted))
          .length === 1,
      );
      const hidden = structuredClone(state);
      hidden.emitted.slides[displayIndex].hidden = true;
      assert(
        (await persistedInlineWidgets(path, stateDir, hidden)).length === 0,
      );
      assert(
        (await preparedInlineWidgets(prepared, prepared.source, hidden.emitted))
          .length === 0,
      );
      const detached = structuredClone(state);
      detached.provenance[key].origin = "detached";
      assert(
        (await persistedInlineWidgets(path, stateDir, detached)).length === 0,
      );
      assert(
        (await preparedInlineWidgets(
          prepared,
          prepared.source,
          state.emitted,
          new Set([key]),
        )).length === 0,
      );
      const replaced = structuredClone(state);
      replaced.emitted.slides[displayIndex].elements.find((e) =>
        e.id === "cloud"
      )!.src = "data:image/png;base64,not-the-verified-fallback";
      assert(
        (await persistedInlineWidgets(path, stateDir, replaced)).length === 0,
      );
      assert(
        (await preparedInlineWidgets(
          prepared,
          prepared.source,
          replaced.emitted,
        )).length === 0,
      );
      const missing = structuredClone(state.emitted);
      missing.slides[displayIndex].elements = [];
      assert(
        (await preparedInlineWidgets(prepared, prepared.source, missing))
          .length === 0,
      );
      const badReceipt = structuredClone(state);
      badReceipt.widgets!.entries[0].receipt.bundleHash = "0".repeat(64);
      assert(
        (await persistedInlineWidgets(path, stateDir, badReceipt)).length === 0,
      );
      await refuses(
        () => loadProjectWidgets(path, stateDir, badReceipt),
        /receipt|hash|bundle/i,
      );
      await Deno.writeTextFile(path, source + "\nChanged QMD.\n");
      assert(
        (await persistedInlineWidgets(path, stateDir, state)).length === 0,
      );
      await refuses(
        () =>
          preparedInlineWidgets(
            prepared,
            scanSource(source + "\nChanged QMD.\n"),
            state.emitted,
          ),
        /source|stale/i,
      );
      await Deno.writeTextFile(path, source);

      studio = await startStudio(path);
      const deckResponse = await fetch(studio.url + "/deck");
      assert(deckResponse.ok);
      await deckResponse.body?.cancel();
      await withHeadlessChromium({ timeoutMs: 120_000 }, async (browser) => {
        const evaluate = async <T>(
          expression: string,
          context?: WidgetContext,
        ): Promise<T> => {
          const result = await browser.send<{
            result: { value: T };
            exceptionDetails?: unknown;
          }>("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            ...(context?.contextId === undefined
              ? {}
              : { contextId: context.contextId }),
          }, context?.sessionId);
          assert(
            !result.exceptionDetails,
            JSON.stringify(result.exceptionDetails),
          );
          return result.result.value;
        };
        const wait = (condition: string, contextId?: WidgetContext) =>
          evaluate(
            `(async()=>{for(let i=0;i<600;i++){if(${condition})return true;const delay=Promise.withResolvers();setTimeout(delay.resolve,25);await delay.promise;}throw new Error('Timed out: '+${
              JSON.stringify(condition)
            }+' Pointer evidence: '+JSON.stringify(globalThis.__qbentoPointerEvidence??null))})()`,
            contextId,
          );
        const navigate = async (url: string) => {
          const offset = browser.events.length;
          let complete = false;
          const navigation = browser.send("Page.navigate", { url }).finally(
            () => complete = true,
          );
          for (let i = 0; i < 200 && !complete; i++) {
            if (
              browser.events.slice(offset).some((event) =>
                event.method === "Page.javascriptDialogOpening"
              )
            ) {
              await browser.send("Page.handleJavaScriptDialog", {
                accept: true,
              });
              break;
            }
            const delay = Promise.withResolvers<void>();
            setTimeout(delay.resolve, 10);
            await delay.promise;
          }
          await navigation;
          await wait(
            `!!globalThis.bento && !!document.querySelector('.ed-thumb[data-index="${displayIndex}"]')`,
          );
          await evaluate(
            `document.querySelector('.ed-thumb[data-index="${displayIndex}"]').click()`,
          );
          await wait("!!document.querySelector('.qbento-widget-layer button')");
        };
        const clickWidgetToggle = async () => {
          const point = await evaluate<{ x: number; y: number }>(
            "(()=>{const r=document.querySelector('.qbento-widget-layer button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
          );
          await browser.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...point,
          });
          assert(
            await evaluate(
              `document.elementFromPoint(${point.x},${point.y})===document.querySelector('.qbento-widget-layer button')`,
            ),
            "native widget toggle receives the actual mouse hit",
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
        };
        // CDP inspects the real opaque-origin child without weakening its sandbox.
        const activate = async () => {
          await clickWidgetToggle();
          await wait(
            "!document.querySelector('.qbento-widget-layer iframe').hidden",
          );
          const context = await plotlyChildContext(browser);
          await wait(
            "!!document.querySelector('#chart .gl-container canvas') && !!document.getElementById('chart')._fullLayout?.scene?._scene",
            context,
          );
          assert(
            await evaluate(
              "document.querySelector('#chart .gl-container canvas').width>0 && document.getElementById('chart').data[0].type==='scatter3d'",
              context,
            ),
          );
          assert(
            await evaluate(
              "document.querySelector('.qbento-widget-layer iframe').getAttribute('sandbox')==='allow-scripts'",
            ),
          );
          return context;
        };
        const aligned = () =>
          evaluate<boolean>(
            "(()=>{const f=document.querySelector('.qbento-widget-layer iframe'),n=f.closest('.bento-el'),a=f.getBoundingClientRect(),b=n.getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1})()",
          );
        await browser.send("Page.enable");
        await browser.send("Runtime.enable");
        await browser.send("Network.enable");
        const downloadDir = join(dir, "downloads");
        await Deno.mkdir(downloadDir);
        await browser.send("Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: downloadDir,
          eventsEnabled: true,
        });
        // Exercise the real native download path on browsers without File System Access.
        await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source:
            "Object.defineProperty(globalThis,'showSaveFilePicker',{value:undefined,configurable:true})",
        });
        await browser.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await navigate(pathToFileURL(rendered.output).href);
        assert(
          await evaluate(
            "document.querySelector('.qbento-widget-layer iframe').hidden",
          ),
        );
        let context = await activate();
        assert(await aligned());
        const before = await evaluate<string>(
          "JSON.stringify(document.getElementById('chart')._fullLayout.scene._scene.getCamera())",
          context,
        );
        const point = await evaluate<{ x: number; y: number }>(
          "(()=>{const r=document.querySelector('.qbento-widget-layer iframe').getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.5}})()",
        );
        await dragPlotlyCamera(browser, context, point);
        await wait(
          `JSON.stringify(document.getElementById('chart')._fullLayout.scene._scene.getCamera())!==${
            JSON.stringify(before)
          }`,
          context,
        );
        const navigatedCamera = await evaluate<string>(
          "JSON.stringify(document.getElementById('chart')._fullLayout.scene._scene.getCamera())",
          context,
        );
        assert(
          await evaluate(
            `bento.doc.slides.flatMap(s=>s.elements).find(e=>e.id==='cloud').src===${
              JSON.stringify(staticSrc)
            }`,
          ),
          "navigation alone does not change the static document",
        );
        const savePoint = await evaluate<{ x: number; y: number }>(
          "(()=>{const b=[...document.querySelectorAll('.qbento-widget-layer button')].find(b=>b.textContent==='Save view');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...savePoint,
        });
        assert(
          await evaluate(
            `document.elementFromPoint(${savePoint.x},${savePoint.y})===[...document.querySelectorAll('.qbento-widget-layer button')].find(b=>b.textContent==='Save view')`,
          ),
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...savePoint,
          button: "left",
          clickCount: 1,
        });
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...savePoint,
          button: "left",
          clickCount: 1,
        });
        await wait(
          `(()=>{const failure=[...document.querySelectorAll('.qbento-widget-layer button')].find(b=>b.textContent==='Save view failed');if(failure)throw new Error(failure.title);return bento.doc.slides.flatMap(s=>s.elements).find(e=>e.id==='cloud').src!==${
            JSON.stringify(staticSrc)
          }})()`,
        );
        await wait("!!document.querySelector('.qbento-widget-layer button')");
        assert(
          await evaluate(
            `(()=>{const layer=document.querySelector('.qbento-widget-layer');return layer?.closest('.bento-slide[data-slide-id]')?.dataset.slideId===${
              JSON.stringify(display.id)
            }&&layer.getBoundingClientRect().width>0})()`,
          ),
          "Save view retains the actual native output continuation slide",
        );
        context = await activate();
        await wait(
          `(()=>{const expected=${navigatedCamera},actual=document.getElementById('chart')._fullLayout.scene._scene.getCamera();return ['eye','up','center'].every(k=>['x','y','z'].every(a=>Math.abs(actual[k][a]-expected[k][a])<1e-6))})()`,
          context,
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
            "document.activeElement===document.querySelector('.qbento-widget-layer button')",
          ),
        );
        await evaluate(
          "(()=>{const doc=structuredClone(bento.doc),el=doc.slides.flatMap(s=>s.elements).find(e=>e.id==='cloud');Object.assign(el,{x:190,y:150,w:610,h:340,rotation:17});bento.loadDoc(JSON.stringify(doc));})()",
        );
        // This fixture replaces the native document to edit geometry; native replacement resets its slide selection.
        await evaluate(
          `document.querySelector('.ed-thumb[data-index="${displayIndex}"]').click()`,
        );
        await wait("!!document.querySelector('.qbento-widget-layer button')");
        context = await activate();
        assert(
          await aligned(),
          "real plot follows native rotation and geometry",
        );
        await wait(
          "Math.abs(document.getElementById('chart')._fullLayout.width-innerWidth)<2 && Math.abs(document.getElementById('chart')._fullLayout.height-innerHeight)<2",
          context,
        );
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: 1100,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        });
        assert(await aligned(), "real plot follows viewport resize");
        const offset = browser.events.length;
        const nativeSavePoint = await evaluate<{ x: number; y: number }>(
          "(()=>{const b=document.querySelector('.ed-topbar .ed-split>button');if(!b)throw new Error('Native Save button missing');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...nativeSavePoint,
          button: "left",
          clickCount: 1,
        });
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...nativeSavePoint,
          button: "left",
          clickCount: 1,
        });
        let downloaded: string | undefined;
        for (let i = 0; i < 400; i++) {
          const events = browser.events.slice(offset);
          const begin = events.find((event) =>
            event.method === "Browser.downloadWillBegin"
          );
          if (
            begin &&
            events.some((event) =>
              event.method === "Browser.downloadProgress" &&
              event.params.guid === begin.params.guid &&
              event.params.state === "completed"
            )
          ) {
            assert(typeof begin.params.suggestedFilename === "string");
            downloaded = join(downloadDir, begin.params.suggestedFilename);
            break;
          }
          const delay = Promise.withResolvers<void>();
          setTimeout(delay.resolve, 25);
          await delay.promise;
        }
        assert(
          downloaded,
          "private native Save must finish a real HTML download",
        );
        nativeSave = { path: downloaded, camera: navigatedCamera };
        const serialized = await Deno.readTextFile(downloaded);
        assert(
          !serialized.includes('class="qbento-widget-layer"') &&
            !serialized.includes('<iframe title="Gráfico interactivo'),
          "native Save omits live transient iframe",
        );
        await navigate(pathToFileURL(downloaded).href);
        assert(
          await evaluate(
            "globalThis.__qbentoInlineWidgets===true && bento.doc.slides.flatMap(s=>s.elements).find(e=>e.id==='cloud').rotation===17",
          ),
        );
        context = await activate();
        await wait(
          `(()=>{const expected=${navigatedCamera},actual=document.getElementById('chart')._fullLayout.scene._scene.getCamera();return ['eye','up','center'].every(k=>['x','y','z'].every(a=>Math.abs(actual[k][a]-expected[k][a])<1e-6))})()`,
          context,
        );
        assert(
          await aligned(),
          "downloaded offline native output restores actual Plotly camera",
        );
        await browser.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await navigate(studio!.url + "/deck");
        context = await activate();
        assert(
          await aligned(),
          "Studio deck uses the verified native Plotly view",
        );
        const requests = browser.events.filter((event) =>
          event.method === "Network.requestWillBeSent"
        );
        assert(
          !requests.some((event) => {
            const request = event.params.request;
            assert(
              request && typeof request === "object" && "url" in request &&
                typeof request.url === "string",
            );
            const url = request.url;
            return /^https?:/.test(url) && !url.startsWith(studio!.url + "/");
          }),
          "offline widgets must not request remote resources",
        );
        await evaluate(
          "document.querySelector('#chart .gl-container canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}))",
          context,
        );
        await wait(
          "document.querySelector('.qbento-widget-layer iframe').hidden && document.querySelector('.qbento-widget-layer button').textContent==='Interacción no disponible'",
        );
        assert(
          await evaluate(
            "(()=>{const img=document.querySelector('.qbento-widget-layer').closest('.bento-el').querySelector('img');return !!img&&img.complete&&img.naturalWidth>0})()",
          ),
          "context loss on the actual Plotly canvas restores the native static fallback",
        );

        // Only the failure phase denies WebGL; all preceding canvas/camera evidence is real.
        const denyWebGL =
          "const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args)}";
        await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: "if(location.href==='about:srcdoc'){" + denyWebGL + "}",
        });
        await browser.send("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }, { exclude: true }],
        });
        await navigate(pathToFileURL(rendered.output).href);
        await clickWidgetToggle();
        if (
          !await evaluate(
            "document.querySelector('.qbento-widget-layer button').textContent==='Interacción no disponible'",
          )
        ) {
          const deniedFrame = await browser.send<
            { result: { objectId?: string } }
          >("Runtime.evaluate", {
            expression: "document.querySelector('.qbento-widget-layer iframe')",
          });
          assert(
            deniedFrame.result.objectId,
            "paused widget iframe remains attached",
          );
          const deniedOwner = await browser.send<{ node: { frameId: string } }>(
            "DOM.describeNode",
            {
              objectId: deniedFrame.result.objectId,
            },
          );
          let deniedSession: string | undefined;
          for (let attempt = 0; attempt < 200; attempt++) {
            const attached = [...browser.events].reverse().find((event) => {
              const info = event.params.targetInfo;
              return event.method === "Target.attachedToTarget" &&
                info !== null &&
                typeof info === "object" && "targetId" in info &&
                info.targetId === deniedOwner.node.frameId;
            });
            if (attached) {
              assert(typeof attached.params.sessionId === "string");
              deniedSession = attached.params.sessionId;
              break;
            }
            if (
              await evaluate(
                "document.querySelector('.qbento-widget-layer button').textContent==='Interacción no disponible'",
              )
            ) break;
            const next = Promise.withResolvers<void>();
            setTimeout(next.resolve, 25);
            await next.promise;
          }
          if (deniedSession) {
            await browser.send("Page.addScriptToEvaluateOnNewDocument", {
              source: "{" + denyWebGL + "}",
              runImmediately: true,
            }, deniedSession);
            await browser.send(
              "Runtime.runIfWaitingForDebugger",
              {},
              deniedSession,
            );
          }
        }
        await wait(
          "document.querySelector('.qbento-widget-layer button').textContent==='Interacción no disponible'",
        );
        assert(
          await evaluate(
            "document.querySelector('.qbento-widget-layer iframe').hidden && /WebGL/.test(document.querySelector('.qbento-widget-layer button').title)",
          ),
        );
        assert(
          await evaluate(
            "(()=>{const node=document.querySelector('.qbento-widget-layer').closest('.bento-el'),img=node.querySelector('img');return !!img&&img.complete&&img.naturalWidth>0})()",
          ),
          "WebGL failure retains the actual static PNG",
        );
      });
      assert(nativeSave);
      const captured = await captureProject(path, nativeSave.path);
      assert(
        canonical(captured.state.widgetCameras?.[0].camera) ===
          canonical(JSON.parse(nativeSave.camera)),
      );
      const reopened = await readProject(path);
      assert(
        canonical(reopened.widgetCameras) ===
          canonical(captured.state.widgetCameras),
      );
      const recaptured = await loadProjectWidgets(path, stateDir, reopened);
      verifyStaticPng(recaptured.bundles[0].fallback.png!);
      const rebuilt = await renderProject(path);
      assert(
        canonical(rebuilt.state.widgetCameras) ===
          canonical(reopened.widgetCameras),
      );
      assert(
        (await persistedInlineWidgets(path, stateDir, rebuilt.state)).length ===
          1,
      );
      await readProjectPresenter(path, rebuilt.state.revision);
      assert(
        await Deno.readTextFile(path) === source,
        "native interaction never rewrites QMD",
      );
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "real Plotly camera save renews trusted snapshots and survives recomputation and state-only rebuild",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-camera-operation-" });
    try {
      const path = join(dir, "deck.qmd"), stateDir = join(dir, ".qbento");
      const qmd = source.replace(
        "plotly::plot_ly(x=c(1,2,3,4), y=c(3,1,4,2), z=c(2,4,1,3),",
        'v <- read.csv("values.csv")\nplotly::plot_ly(x=v$x, y=v$y, z=v$z,',
      );
      await Deno.writeTextFile(path, qmd);
      await Deno.writeTextFile(
        join(dir, "values.csv"),
        "x,y,z\n1,3,2\n2,1,4\n3,4,1\n4,2,3\n",
      );
      const first = await renderProject(path);
      const doc = structuredClone(first.state.emitted);
      const slide = doc.slides.find((s) =>
        s.elements.some((e) => e.id === "cloud")
      )!;
      const element = slide.elements.find((e) => e.id === "cloud")!;
      Object.assign(element, { x: 170, y: 140, w: 640, h: 350, rotation: 12 });
      const before = await saveProject(path, doc, first.state.revision);
      const camera = {
        eye: { x: 2.1, y: -1.2, z: 0.8 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
        projection: { type: "perspective" },
      };
      const request = {
        docId: before.docId,
        revision: before.revision,
        sourceHash: scanSource(qmd).hash,
        slideId: slide.id,
        elementId: "cloud",
        staticSrc: String(element.src),
        camera,
      };
      const outputBefore = await Deno.readTextFile(first.output);
      await refuses(
        () =>
          savePlotlyCamera(path, { ...request, docId: crypto.randomUUID() }),
        /original widget project/i,
      );
      await refuses(
        () =>
          savePlotlyCamera(path, { ...request, revision: before.revision - 1 }),
        /reload|revision/i,
      );
      await refuses(
        () =>
          savePlotlyCamera(path, {
            ...request,
            staticSrc: "data:image/png;base64,wrong",
          }),
        /static identity/i,
      );
      await Deno.writeTextFile(path, qmd + "\nChanged source.\n");
      await refuses(
        () => savePlotlyCamera(path, request),
        /changed QMD|source/i,
      );
      await Deno.writeTextFile(path, qmd);
      assert(
        canonical(await readProject(path)) === canonical(before),
        "refused saves do not mutate state",
      );
      assert(
        await Deno.readTextFile(first.output) === outputBefore,
        "refused saves do not mutate output",
      );

      const saved = await savePlotlyCamera(path, request);
      assert(saved.revision > before.revision);
      assert(saved.output!.generation !== before.output!.generation);
      assert(saved.widgets!.generation === saved.output!.generation);
      assert(
        saved.widgets!.entries[0].receipt.bundleHash !==
          before.widgets!.entries[0].receipt.bundleHash,
      );
      const updated = saved.emitted.slides.find((s) => s.id === slide.id)!
        .elements.find((e) => e.id === "cloud")!;
      assert(updated.src !== element.src);
      assert(
        updated.x === 170 && updated.y === 140 && updated.w === 640 &&
          updated.h === 350 && updated.rotation === 12,
      );
      assert(canonical(saved.provenance) === canonical(before.provenance));
      assert(canonical(saved.widgetCameras?.[0].camera) === canonical(camera));
      assert(await Deno.readTextFile(path) === qmd);
      const reopened = await readProject(path);
      assert(
        canonical(reopened.widgetCameras) === canonical(saved.widgetCameras),
      );
      const verified = await loadProjectWidgets(path, stateDir, reopened);
      verifyStaticPng(verified.bundles[0].fallback.png!);
      const verifiedScene = verified.bundles[0].candidate.spec.layout.scene;
      assert(
        verifiedScene && typeof verifiedScene === "object" &&
          "camera" in verifiedScene,
      );
      assert(canonical(verifiedScene.camera) === canonical(camera));
      await readProjectPresenter(path, reopened.revision);

      await Deno.writeTextFile(
        join(dir, "values.csv"),
        "x,y,z\n1,3,2\n2,1,40\n3,4,1\n4,2,3\n",
      );
      const changed = await renderProject(path);
      assert(
        canonical(changed.state.widgetCameras) ===
          canonical(saved.widgetCameras),
      );
      const changedWidgets = await loadProjectWidgets(
        path,
        stateDir,
        changed.state,
      );
      const changedZ = changedWidgets.bundles[0].candidate.spec.data[0].z;
      assert(Array.isArray(changedZ) && changedZ[1] === 40);
      const scene = changedWidgets.bundles[0].candidate.spec.layout.scene;
      assert(scene && typeof scene === "object" && "camera" in scene);
      assert(canonical(scene.camera) === canonical(camera));
      assert(
        changed.state.emitted.slides.find((s) => s.id === slide.id)!.elements
          .find((e) => e.id === "cloud")!.x === 170,
      );
      await Deno.remove(first.output);
      const restored = await renderProject(path);
      assert(
        canonical(restored.state.widgetCameras) ===
          canonical(saved.widgetCameras),
      );
      const restoredWidgets = await loadProjectWidgets(
        path,
        stateDir,
        restored.state,
      );
      verifyStaticPng(restoredWidgets.bundles[0].fallback.png!);
      const restoredScene =
        restoredWidgets.bundles[0].candidate.spec.layout.scene;
      assert(
        restoredScene && typeof restoredScene === "object" &&
          "camera" in restoredScene,
      );
      assert(canonical(restoredScene.camera) === canonical(camera));
      await readProjectPresenter(path, restored.state.revision);
      assert(await Deno.readTextFile(path) === qmd);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "selected native card lets real Plotly camera drag bypass Moveable and restores design hit testing on Escape",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-card-plotly-hit-" });
    try {
      const path = join(dir, "deck.qmd");
      const qmd = source.replace("#| output-location: slide\n", "").replace(
        "::: {#cloud}",
        "::: {#cloud .bento-card}",
      );
      await Deno.writeTextFile(path, qmd);
      const rendered = await renderProject(path);
      await withHeadlessChromium({ timeoutMs: 60_000 }, async (browser) => {
        const evaluate = async <T>(
          expression: string,
          context?: WidgetContext,
        ): Promise<T> => {
          const result = await browser.send<{
            result: { value: T };
            exceptionDetails?: unknown;
          }>("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            ...(context?.contextId === undefined
              ? {}
              : { contextId: context.contextId }),
          }, context?.sessionId);
          assert(
            !result.exceptionDetails,
            JSON.stringify(result.exceptionDetails),
          );
          return result.result.value;
        };
        const wait = (condition: string, contextId?: WidgetContext) =>
          evaluate(
            `(async()=>{for(let i=0;i<600;i++){if(${condition})return true;const delay=Promise.withResolvers();setTimeout(delay.resolve,25);await delay.promise;}throw new Error('Timed out: '+${
              JSON.stringify(condition)
            }+' Pointer evidence: '+JSON.stringify(globalThis.__qbentoPointerEvidence??null))})()`,
            contextId,
          );
        const click = async (point: { x: number; y: number }) => {
          await browser.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...point,
          });
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
        };
        await browser.send("Page.enable");
        await browser.send("Runtime.enable");
        await browser.send("Page.navigate", {
          url: pathToFileURL(rendered.output).href,
        });
        await wait("!!document.querySelector('.qbento-widget-layer button')");
        const center = await evaluate<{ x: number; y: number }>(
          "(()=>{const r=document.querySelector('.qbento-widget-layer').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await click(center);
        await wait(
          `document.elementFromPoint(${center.x},${center.y})?.classList.contains('moveable-area')`,
        );
        const pointerBefore = await evaluate<string>(
          `getComputedStyle(document.elementFromPoint(${center.x},${center.y})).pointerEvents`,
        );
        const geometry =
          "JSON.stringify(bento.doc.slides.map(s=>({id:s.id,elements:s.elements.map(e=>({id:e.id,x:e.x,y:e.y,w:e.w,h:e.h,rotation:e.rotation}))})))";
        const before = await evaluate<string>(geometry);
        const activatePoint = await evaluate<{ x: number; y: number }>(
          "(()=>{const r=document.querySelector('.qbento-widget-layer button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...activatePoint,
        });
        assert(
          await evaluate(
            `document.elementFromPoint(${activatePoint.x},${activatePoint.y})===document.querySelector('.qbento-widget-layer button')`,
          ),
          "hovered Interactuar is the actual pointer target above selected-card controls",
        );
        await click(activatePoint);
        await wait(
          "!document.querySelector('.qbento-widget-layer iframe').hidden",
        );
        assert(
          await evaluate(
            `document.elementFromPoint(${center.x},${center.y})===document.querySelector('.qbento-widget-layer iframe')`,
          ),
          "real pointer hits the active chart, not the selected card's Moveable area",
        );
        const child = await plotlyChildContext(browser);
        await wait(
          "!!document.querySelector('#chart .gl-container canvas') && !!document.getElementById('chart')._fullLayout?.scene?._scene",
          child,
        );
        const cameraBefore = await evaluate<string>(
          "JSON.stringify(document.getElementById('chart')._fullLayout.scene._scene.getCamera())",
          child,
        );
        await dragPlotlyCamera(browser, child, center);
        await wait(
          `JSON.stringify(document.getElementById('chart')._fullLayout.scene._scene.getCamera())!==${
            JSON.stringify(cameraBefore)
          }`,
          child,
        );
        assert(
          await evaluate<string>(geometry) === before,
          "camera navigation must not move or resize any native card/image",
        );
        const saveViewPoint = await evaluate<{ x: number; y: number }>(
          "(()=>{const b=[...document.querySelectorAll('.qbento-widget-layer button')].find(b=>b.textContent==='Save view'&&!b.hidden);if(!b)throw new Error('Ready 3D Save view button missing');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...saveViewPoint,
        });
        assert(
          await evaluate(
            `document.elementFromPoint(${saveViewPoint.x},${saveViewPoint.y})===[...document.querySelectorAll('.qbento-widget-layer button')].find(b=>b.textContent==='Save view')`,
          ),
          "Save view remains the actual pointer target while the native card is selected",
        );
        const returnPoint = await evaluate<{ x: number; y: number }>(
          "(()=>{const r=document.querySelector('.qbento-widget-layer button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...returnPoint,
        });
        assert(
          await evaluate(
            `document.elementFromPoint(${returnPoint.x},${returnPoint.y})===document.querySelector('.qbento-widget-layer button')`,
          ),
          "return-to-design toggle remains the actual pointer target",
        );
        await click(returnPoint);
        await wait(
          "document.querySelector('.qbento-widget-layer iframe').hidden",
        );
        await wait(
          `document.elementFromPoint(${center.x},${center.y})?.classList.contains('moveable-area')`,
        );
        assert(
          await evaluate<string>(
            `getComputedStyle(document.elementFromPoint(${center.x},${center.y})).pointerEvents`,
          ) === pointerBefore,
          "return toggle restores native Moveable hit testing",
        );
        assert(await evaluate<string>(geometry) === before);
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...activatePoint,
        });
        assert(
          await evaluate(
            `document.elementFromPoint(${activatePoint.x},${activatePoint.y})===document.querySelector('.qbento-widget-layer button')`,
          ),
          "native controls do not steal the second activation",
        );
        await click(activatePoint);
        await wait(
          "!document.querySelector('.qbento-widget-layer iframe').hidden",
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
            "document.activeElement===document.querySelector('.qbento-widget-layer button')",
          ),
        );
        await wait(
          `document.elementFromPoint(${center.x},${center.y})?.classList.contains('moveable-area')`,
        );
        assert(
          await evaluate<string>(
            `getComputedStyle(document.elementFromPoint(${center.x},${center.y})).pointerEvents`,
          ) === pointerBefore,
          "Escape restores native Moveable hit testing",
        );
        assert(await evaluate<string>(geometry) === before);
      });
      assert(await Deno.readTextFile(path) === qmd);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
