/** Content bounds from the pinned native renderer, never a character estimate. */
import { loadBentoShell } from "./shell.ts";
import { withHeadlessChromium } from "../browser/chromium.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../bridge/isolation.ts";
import { spliceDocument } from "./html.ts";
import type { BentoDoc, Diagnostic } from "./types.ts";

export const TEXT_DIAGNOSTIC_CODES = [
  "TEXT_OVERFLOW",
  "TEXT_MEASUREMENT_UNAVAILABLE",
];

/** A warning must not make an otherwise browser-free save/render destructive.
 * All supported text forms use the real runtime (including lists, KaTeX and
 * highlighted code). Rotation and painted effects are outside these DOM bounds.
 * A single local browser measures the complete deck; no network/font download.
 */
// Bound reuse to identical document bytes within this process, for concurrent
// Studio inspection of one saved snapshot. Failures are retried (a browser may
// become available); successful entries expire after 30s and at most eight stay.
// A local font installation change may require expiry/restart, never a document
// edit to invalidate the snapshot.
const cache = new Map<string, { at: number; result: Promise<Diagnostic[]> }>();
export async function textOverflowDiagnostics(
  document: BentoDoc,
): Promise<Diagnostic[]> {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const key = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  const now = Date.now();
  const previous = cache.get(key);
  if (previous && now - previous.at < 30_000) {
    return structuredClone(await previous.result);
  }
  cache.delete(key);
  while (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const result = measureTextOverflow(document);
  cache.set(key, { at: now, result });
  const diagnostics = await result;
  if (diagnostics.some((d) => d.code === "TEXT_MEASUREMENT_UNAVAILABLE")) {
    cache.delete(key);
  }
  return structuredClone(diagnostics);
}
async function measureTextOverflow(
  document: BentoDoc,
): Promise<Diagnostic[]> {
  const targets = document.slides.flatMap((slide) =>
    slide.elements.filter((e) => e.type === "text" || e.type === "code").map(
      (element) => ({ slideId: slide.id, element }),
    )
  );
  if (!targets.length) return [];
  const diagnostics: Diagnostic[] = [];
  const measured = targets.filter(({ slideId, element }) => {
    if (
      Number(element.rotation ?? 0) !== 0 ||
      (element.type === "text" &&
        /\{\{\s*(?:page|pages|title|date|time|author|company|subject|event)(?::[^}]*?)?\s*\}\}/i
          .test(String(element.html)))
    ) {
      diagnostics.push({
        code: "TEXT_MEASUREMENT_UNAVAILABLE",
        slideId,
        elementId: element.id,
        message:
          "Native text bounds were not checked for rotated text or document-field substitutions. Inspect the final slide; resize or simplify the text if it does not fit.",
      });
      return false;
    }
    return true;
  });
  if (!measured.length) return diagnostics;
  // Unique probe IDs preserve duplicate per-slide source IDs. Only placement is
  // neutralized; geometry, native content, typography and embedded fonts stay exact.
  const probes = prepareIsolatedDocument({
    ...document,
    slides: [{
      id: "qbento-text-metrics",
      background: document.theme.background,
      transition: "fade",
      notes: "",
      elements: measured.map(({ element }, index) => ({
        ...element,
        id: `qbento-probe-${index}`,
        x: 0,
        y: 0,
      })),
    }],
  });
  try {
    const shell = await loadBentoShell();
    const html = spliceDocument(
      shell,
      probes,
      ISOLATION_BOOTSTRAP,
      OFFLINE_CSP,
    );
    const bounds = await withHeadlessChromium({}, async (browser) => {
      const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
      );
      await browser.send("Page.setDocumentContent", {
        frameId: tree.frameTree.frame.id,
        html,
      });
      const response = await browser.send<
        {
          result: {
            value?: {
              error?: string;
              left?: number;
              top?: number;
              right?: number;
              bottom?: number;
            }[];
          };
          exceptionDetails?: unknown;
        }
      >("Runtime.evaluate", {
        expression: `(async()=>{
          const count=${measured.length};
          for(let i=0;i<240&&!window.bento?.doc;i++)await new Promise(r=>setTimeout(r,25));
          if(!window.bento?.doc)throw new Error('Pinned Bento renderer did not load');
          for(let i=0;i<120&&document.querySelectorAll('.ed-canvas-wrap [data-el-id]').length<count;i++)await new Promise(r=>setTimeout(r,25));
          document.querySelectorAll('.ed-canvas-wrap [data-el-id]').forEach(node=>node.getBoundingClientRect());
          await document.fonts.ready;
          return Array.from({length:count},(_,index)=>{
            const el=window.bento.doc.slides[0].elements[index];
            const root=document.querySelector('.ed-canvas-wrap [data-el-id="qbento-probe-'+index+'"]');
            if(!root)return {error:'Native canvas text probe missing'};
            const content=root.querySelector('.bento-text-inner');
            if(!content)return {error:'Native text content missing'};
            const box=root.getBoundingClientRect(), scale=box.width/el.w;
            if(!(scale>0)||!Number.isFinite(scale))return {error:'Invalid native probe scale'};
            const range=document.createRange();range.selectNodeContents(content);
            const rects=[content.getBoundingClientRect(),...range.getClientRects()].filter(r=>r.width>0||r.height>0);
            const left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right));
            const top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));
            return {left:(box.left-left)/scale,top:(box.top-top)/scale,right:(right-box.right)/scale,bottom:(bottom-box.bottom)/scale};
          });
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const values = response.result?.value;
      if (
        response.exceptionDetails || !values ||
        values.length !== measured.length || values.some((row) =>
          !row.error && [row.left, row.top, row.right, row.bottom].some((n) =>
            !Number.isFinite(n)
          )
        )
      ) {
        throw new Error("Incomplete native text measurement");
      }
      return values;
    });
    bounds.forEach((bound, index) => {
      // One CSS pixel tolerance absorbs subpixel layout rounding, not extra lines.
      if (bound.error) {
        const { slideId, element } = measured[index];
        diagnostics.push({
          code: "TEXT_MEASUREMENT_UNAVAILABLE",
          slideId,
          elementId: element.id,
          message:
            `Native text bounds could not be checked: ${bound.error}. Inspect this element in the final slide.`,
        });
        return;
      }
      if (Object.values(bound).some((n) => typeof n === "number" && n > 1)) {
        const { slideId, element } = measured[index];
        diagnostics.push({
          code: "TEXT_OVERFLOW",
          slideId,
          elementId: element.id,
          message:
            `Native ${element.type} content exceeds its saved box (left ${
              Math.max(0, bound.left!).toFixed(1)
            }px, top ${Math.max(0, bound.top!).toFixed(1)}px, right ${
              Math.max(0, bound.right!).toFixed(1)
            }px, bottom ${
              Math.max(0, bound.bottom!).toFixed(1)
            }px). Increase its size or adjust typography/content; saved geometry and QMD are preserved.`,
        });
      }
    });
  } catch (error) {
    for (const { slideId, element } of measured) {
      diagnostics.push({
        code: "TEXT_MEASUREMENT_UNAVAILABLE",
        slideId,
        elementId: element.id,
        message: `Native text bounds could not be checked: ${
          String(error).slice(0, 350)
        }. Configure an installed local Chromium or inspect the final slide. Rendering and saved work remain available.`,
      });
    }
  }
  return diagnostics;
}
