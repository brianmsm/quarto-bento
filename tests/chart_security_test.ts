import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import { designTheme } from "../src/render/design.ts";
import { spliceDocument } from "../src/render/html.ts";
import { loadBentoShell } from "../src/render/shell.ts";
import type { BentoDoc } from "../src/render/types.ts";
import {
  assertProjectDocument,
  BentoContractError,
} from "../src/render/validate.ts";

const hostileColor = 'red"><img src=x onerror="globalThis.__tooltipProof=1">';

function chart(color: string): BentoDoc {
  return prepareIsolatedDocument({
    format: "bento/slides",
    version: 1,
    docId: "chart-tooltip-check",
    title: "Tooltip check",
    size: { width: 1280, height: 720 },
    theme: designTheme(),
    slides: [{
      id: "slide",
      background: "#ffffff",
      transition: "fade",
      notes: "",
      elements: [{
        id: "chart",
        type: "chart",
        x: 100,
        y: 100,
        w: 700,
        h: 400,
        option: {
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: ["A", "B"] },
          yAxis: { type: "value" },
          series: [{
            name: "Series",
            type: "bar",
            data: [2, 3],
            itemStyle: { color },
          }],
        },
      }],
    }],
  });
}

Deno.test("project chart options refuse tooltip attribute injection", () => {
  assertProjectDocument(chart("#dd3344"));
  try {
    assertProjectDocument(chart(hostileColor));
    throw new Error("hostile chart color was accepted");
  } catch (error) {
    if (!(error instanceof BentoContractError)) throw error;
    if (!error.details.some((item) => item.path.endsWith("/itemStyle/color"))) {
      throw new Error(`Unexpected rejection: ${error.message}`);
    }
  }
  const palette = chart("#dd3344");
  const element = palette.slides[0].elements[0] as unknown as {
    option: Record<string, unknown>;
  };
  element.option.color = [hostileColor];
  try {
    assertProjectDocument(palette);
    throw new Error("hostile chart palette was accepted");
  } catch (error) {
    if (!(error instanceof BentoContractError)) throw error;
    if (!error.details.some((item) => item.path.endsWith("/color/0"))) {
      throw new Error(`Unexpected palette rejection: ${error.message}`);
    }
  }
});

Deno.test({
  name: "native dropped chart cannot execute tooltip color on hover",
  ignore: Deno.env.get("QBENTO_STUDIO_BROWSER_TEST") !== "1",
  fn: async () => {
    // A native file drop bypasses project validation before its first render.
    const html = spliceDocument(
      await loadBentoShell(),
      chart(hostileColor),
      ISOLATION_BOOTSTRAP,
      OFFLINE_CSP,
    );
    await withHeadlessChromium({}, async (browser) => {
      const tree = await browser.send<
        { frameTree: { frame: { id: string } } }
      >("Page.getFrameTree");
      await browser.send("Page.setDocumentContent", {
        frameId: tree.frameTree.frame.id,
        html,
      });
      const result = await browser.send<{
        result: {
          value?: {
            proof: unknown;
            images: number;
            bars: number;
            savedGuard: boolean;
          };
        };
        exceptionDetails?: unknown;
      }>("Runtime.evaluate", {
        expression: `(async () => {
          for (let i=0; i<200 && !window.bento?.serialize; i++) await new Promise(r=>setTimeout(r,25));
          if (!window.bento?.serialize) throw new Error('native runtime unavailable');
          document.querySelector('.ed-present-pill .ed-pill-main')?.click();
          await new Promise(r=>setTimeout(r,1000));
          for (const bar of document.querySelectorAll('svg rect')) {
            bar.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:200,clientY:200}));
          }
          await new Promise(r=>setTimeout(r,300));
          return {proof:globalThis.__tooltipProof ?? null,
            images:document.querySelectorAll('img').length,
            bars:document.querySelectorAll('svg rect').length,
            savedGuard:window.bento.serialize().includes('qbentoTooltipSink')};
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails || !result.result.value) {
        throw new Error(JSON.stringify(result));
      }
      const value = result.result.value;
      if (
        value.proof !== null || value.images !== 0 || value.bars < 1 ||
        !value.savedGuard
      ) {
        throw new Error(
          `Native tooltip guard failed: ${JSON.stringify(value)}`,
        );
      }
    });
  },
});
