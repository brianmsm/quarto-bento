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
export interface NativeTextMeasurement {
  /** Preferred height includes symmetric slack for vertically centered text. */
  height: number;
  width: number;
  lineBoxHeight: number;
  /** Conservative fragment count when native CSS line boxes collapse. */
  lineCount: number;
  overhangTop: number;
  overhangBottom: number;
  overhangLeft: number;
  overhangRight: number;
}
/** Measure the pinned native text inner style with the installed local browser.
 * Text fields and the native inline-code rule match Bento revision 3d6f7f1.
 * No runtime/font is downloaded; document.fonts uses the same local fallback
 * as the native editor. Range text rectangles also bound font overhang outside
 * CSS line boxes. This does not claim arbitrary painted effects or rotation.
 * Preferred height is safe only when the consumer checks native alignment and
 * multiline overlap; allocating height alone does not move top-aligned glyphs.
 */
export async function measureNativeText(
  elements: Element[],
  resources?: BentoDoc,
): Promise<NativeTextMeasurement[]> {
  if (!elements.length) return [];
  const data = elements.map((element) => {
    const html = canonicalInlineHtml(String(element.html));
    const plain = html.replace(/<[^>]*>/g, "");
    if (
      /\{\{\s*(?:page|pages|title|date|time|author|company|subject|event)(?::[^}]*?)?\s*\}\}/i
        .test(html) ||
      /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(
        plain,
      )
    ) {
      fail(
        "NATIVE_TEXT_TRANSFORM_UNSUPPORTED",
        "Native mathematical or document-field markers transform text semantics; use supported literal text or an explicit faithful adapter.",
      );
    }
    const fontSize = Number(element.fontSize ?? 16),
      w = Number(element.w),
      lineHeight = element.lineHeight == null
        ? "normal"
        : Number(element.lineHeight),
      letterSpacing = Number(element.letterSpacing ?? 0);
    if (
      ![fontSize, w, letterSpacing].every(Number.isFinite) ||
      fontSize <= 0 || w <= 0 ||
      (typeof lineHeight === "number" &&
        (!Number.isFinite(lineHeight) || lineHeight < 0))
    ) {
      fail(
        "INVALID_TEXT_MEASUREMENT",
        "Native text requires finite positive geometry/font size and nonnegative line-height.",
      );
    }
    return {
      html,
      w,
      fontSize,
      lineHeight,
      letterSpacing,
      fontFamily: String(
        element.fontFamily ?? resources?.theme?.fontFamily ??
          designTheme().fontFamily,
      ),
      fontWeight: Number(element.fontWeight ?? 400),
      align: String(element.align ?? "start"),
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
    theme: resources?.theme ?? designTheme(),
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
        result: { value?: NativeTextMeasurement[] };
        exceptionDetails?: unknown;
      }
    >("Runtime.evaluate", {
      expression: `(async () => {
        for(let attempt=0;attempt<200&&!window.bento?.loadDoc;attempt++) await new Promise(resolve=>setTimeout(resolve,25));
        if(!window.bento?.loadDoc) throw new Error('Pinned Bento text runtime did not load');
        document.body.style.margin='0';
        const metrics=${JSON.stringify(data)};
        const probes=[];
        const nodes=metrics.map((e,index)=>{
          const outer=document.createElement('div');outer.className='bento-el bento-el-text';
          Object.assign(outer.style,{position:'absolute',width:e.w+'px',overflowWrap:'break-word',display:'flex',flexDirection:'column',contain:'layout style'});
          const inner=document.createElement('div');inner.className='bento-text-inner';inner.dir='auto';
          Object.assign(inner.style,{width:'100%',fontSize:e.fontSize+'px',fontFamily:e.fontFamily,fontWeight:String(e.fontWeight),textAlign:e.align,lineHeight:String(e.lineHeight),letterSpacing:e.letterSpacing+'px'});
          inner.innerHTML=e.html;outer.appendChild(inner);document.body.appendChild(outer);
          if(e.lineHeight==='normal'){
            const probe=inner.cloneNode(false);probe.textContent='M';outer.appendChild(probe);probes[index]=probe;
          }
          return inner;
        });
        nodes.forEach(node=>node.getBoundingClientRect());
        probes.forEach(node=>node.getBoundingClientRect());
        await document.fonts.ready;
        return nodes.map((node,index)=>{
          const box=node.getBoundingClientRect();
          const range=document.createRange();range.selectNodeContents(node);
          const rects=[...range.getClientRects()].filter(rect=>rect.width>0||rect.height>0);
          const top=Math.min(box.top,...rects.map(rect=>rect.top));
          const bottom=Math.max(box.bottom,...rects.map(rect=>rect.bottom));
          const left=Math.min(box.left,...rects.map(rect=>rect.left));
          const right=Math.max(box.right,...rects.map(rect=>rect.right));
          const overhangTop=box.top-top,overhangBottom=bottom-box.bottom;
          const overhangLeft=box.left-left,overhangRight=right-box.right;
          const lineStep=metrics[index].lineHeight==='normal'
            ? probes[index].getBoundingClientRect().height
            : metrics[index].fontSize*metrics[index].lineHeight;
          const lineCount=Math.max(1,node.querySelectorAll('br').length+1,
            lineStep>0?Math.round(box.height/lineStep):0,box.height===0?rects.length:0);
          return {height:box.height+2*Math.max(overhangTop,overhangBottom)+4,
            width:Math.max(node.scrollWidth,right-left),lineBoxHeight:box.height,
            lineCount,
            overhangTop,overhangBottom,overhangLeft,overhangRight};
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const measured = result.result?.value;
    if (
      result.exceptionDetails || !measured || measured.length !== data.length ||
      measured.some((row) =>
        Object.values(row).some((value) => !Number.isFinite(value) || value < 0)
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
