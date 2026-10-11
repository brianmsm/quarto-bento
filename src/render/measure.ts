import { withHeadlessChromium } from "../browser/chromium.ts";
import { spliceDocument } from "./html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../bridge/isolation.ts";
import { canonicalInlineHtml } from "./inline.ts";
import { DesignError, designTheme } from "./design.ts";
import type { BentoDoc, Element } from "./types.ts";
function fail(code: string, message: string): never {
  throw new DesignError(code, message);
}
/** Measure the pinned native text inner style with the installed local browser.
 * Text fields and the native inline-code rule match Bento revision 3d6f7f1.
 * No runtime/font is downloaded; document.fonts uses the same local fallback
 * as the native editor. Height includes a small pixel rounding allowance.
 */
export async function measureNativeText(
  elements: Element[],
  resources?: BentoDoc,
): Promise<{ height: number; width: number }[]> {
  if (!elements.length) return [];
  const data = elements.map((element) => {
    const html = canonicalInlineHtml(String(element.html));
    const plain = html.replace(/<[^>]*>/g, "");
    if (
      /\{\{\s*(?:page|pages|title|date|time|author|company|subject|event)(?::[^}]*?)?\s*\}\}/i
        .test(plain) ||
      /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(
        plain,
      )
    ) {
      fail(
        "NATIVE_TEXT_TRANSFORM_UNSUPPORTED",
        "Native mathematical or document-field markers transform text semantics; use supported literal text or an explicit faithful adapter.",
      );
    }
    const fontSize = Number(element.fontSize),
      w = Number(element.w),
      lineHeight = Number(element.lineHeight ?? 1.25),
      letterSpacing = Number(element.letterSpacing ?? 0);
    if (
      ![fontSize, w, lineHeight, letterSpacing].every(Number.isFinite) ||
      fontSize <= 0 || w <= 0 || lineHeight <= 0
    ) {
      fail(
        "INVALID_TEXT_MEASUREMENT",
        "Native text requires finite positive geometry and typography.",
      );
    }
    return {
      html,
      w,
      fontSize,
      lineHeight,
      letterSpacing,
      fontFamily: String(element.fontFamily ?? "Arial, sans-serif"),
      fontWeight: Number(element.fontWeight ?? 400),
      align: String(element.align ?? "left"),
    };
  });
  const resourceFields = resources as unknown as
    | Record<string, unknown>
    | undefined;
  const metricsDocument = prepareIsolatedDocument({
    format: "bento/slides",
    version: 1,
    docId: "native-text-metrics",
    title: "Native text metrics",
    size: { width: 1280, height: 720 },
    theme: designTheme(),
    slides: [{
      id: "metrics",
      background: "#ffffff",
      transition: "fade",
      notes: "",
      elements: [],
    }],
    ...(resourceFields?.fonts ? { fonts: resourceFields.fonts } : {}),
    ...(resourceFields?.assets ? { assets: resourceFields.assets } : {}),
  });
  const shell = await Deno.readTextFile(
    new URL("../../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    metricsDocument as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  return await withHeadlessChromium({}, async (browser) => {
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html,
    });
    const result = await browser.send<
      {
        result: { value?: { height: number; width: number }[] };
        exceptionDetails?: unknown;
      }
    >("Runtime.evaluate", {
      expression: `(async () => {
        for(let attempt=0;attempt<200&&!window.bento?.loadDoc;attempt++) await new Promise(resolve=>setTimeout(resolve,25));
        if(!window.bento?.loadDoc) throw new Error('Pinned Bento text runtime did not load');
        document.body.style.margin='0';
        const nodes=${JSON.stringify(data)}.map(e=>{
          const outer=document.createElement('div');outer.className='bento-el bento-el-text';
          Object.assign(outer.style,{position:'absolute',width:e.w+'px',overflowWrap:'break-word',display:'flex',flexDirection:'column',contain:'layout style'});
          const inner=document.createElement('div');inner.className='bento-text-inner';inner.dir='auto';
          Object.assign(inner.style,{width:'100%',fontSize:e.fontSize+'px',fontFamily:e.fontFamily,fontWeight:String(e.fontWeight),textAlign:e.align,lineHeight:String(e.lineHeight),letterSpacing:e.letterSpacing+'px'});
          inner.innerHTML=e.html;outer.appendChild(inner);document.body.appendChild(outer);return inner;
        });
        nodes.forEach(node=>node.getBoundingClientRect());
        await document.fonts.ready;
        return nodes.map(node=>({height:node.getBoundingClientRect().height+4,width:node.scrollWidth}));
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const measured = result.result?.value;
    if (
      result.exceptionDetails || !measured || measured.length !== data.length ||
      measured.some((row) =>
        !Number.isFinite(row.height) || !Number.isFinite(row.width)
      )
    ) {
      fail(
        "TEXT_MEASUREMENT_FAILED",
        "The installed browser could not measure the complete native text.",
      );
    }
    return measured;
  });
}
