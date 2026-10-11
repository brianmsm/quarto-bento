import { producerOutputChildren } from "../render/producer-capture.ts";
/** Computed gt HTML tables only: preserve executed rich content as a static PNG. */
import { hashSource, scanSource, type SourceDocument } from "../source/mod.ts";
import { canonical } from "../state/json.ts";
import { tableProducer } from "../source/table.ts";
import type { Ast, Node } from "../render/types.ts";
import { withHeadlessChromium } from "../browser/chromium.ts";
export interface RichTableCandidate {
  version: 1;
  kind: "gt-static";
  source: {
    sourceHash: string;
    sourceId: string;
    producerId: string;
    slideId: string;
    chunkHash: string;
    outputHash: string;
  };
  pandocApiVersion: number[];
  blocks: Node[];
}
export interface RichTableReceipt {
  version: 1;
  kind: "gt-static-png";
  source: RichTableCandidate["source"];
  htmlHash: string;
  pngHash: string;
  textHash: string;
  browser: string;
  width: number;
  height: number;
  pixelRatio: 2;
  rows: number;
  cells: number;
  minFontSize: number;
  minBodyFontSize: number;
}
export interface RichTableSnapshot {
  candidate: RichTableCandidate;
  png: Uint8Array;
  receipt: RichTableReceipt;
  diagnostic: { code: "STATIC_TABLE_PNG_FALLBACK"; message: string };
}
function fail(message: string): never {
  throw new Error(`UNSUPPORTED_RICH_TABLE: ${message}`);
}
function attr(node: Node): [string, string[], unknown[]] {
  return (node.c as [[string, string[], unknown[]], unknown])[0];
}
function children(node: Node): Node[] {
  return (node.c as [unknown, Node[]])[1];
}
function richOutput(contents: Node[]): Node[] | undefined {
  if (
    contents.length !== 1 || contents[0].t !== "Div" ||
    canonical(attr(contents[0])) !== canonical(["", ["cell"], []])
  ) return;
  const outputs = children(contents[0]);
  if (
    outputs.length !== 1 || outputs[0].t !== "Div" ||
    canonical(attr(outputs[0])) !== canonical(["", ["cell-output-display"], []])
  ) return;
  const output = children(outputs[0]);
  // The ordinary extension captures before Quarto's final descaffold pass.
  // Quarto 1.10.19 removes exactly this anonymous scaffold without presentation.
  if (
    output.length === 1 && output[0].t === "Div" &&
    canonical(attr(output[0])) === canonical(["", ["quarto-scaffold"], []])
  ) {
    return children(output[0]);
  }
  return output;
}
function looksLikeGt(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(looksLikeGt);
  if (value && typeof value === "object") {
    const n = value as Node;
    if (n.t === "Table") {
      return (n.c as unknown[][])?.[0]?.[1] instanceof Array &&
        ((n.c as unknown[][])[0][1] as string[]).includes("gt_table");
    }
    return looksLikeGt(n.c);
  }
  return false;
}
export function collectRichTableCandidates(
  ast: Ast,
  document: SourceDocument,
): RichTableCandidate[] {
  if (hashSource(document.text) !== document.hash) {
    fail("source snapshot hash is stale");
  }
  const source = scanSource(document.text);
  if (source.diagnostics.length) {
    fail("resolve original source mapping diagnostics first");
  }
  const api = (ast as unknown as Record<string, unknown>)["pandoc-api-version"];
  const result: RichTableCandidate[] = [], visited = new Set<string>();
  function visit(nodes: Node[]) {
    for (const node of nodes) {
      if (node.t !== "Div") continue;
      const [id] = attr(node),
        matches = source.blocks.filter((b) =>
          b.id === id && b.kind === "div" && b.stable && b.explicitId
        );
      if (matches.length === 1 && looksLikeGt(children(node))) {
        if (visited.has(id)) fail("duplicate executed wrapper identity");
        visited.add(id);
        if (
          canonical(attr(node)) !== canonical([id, [], []]) ||
          matches[0].raw.split(/\r?\n/, 1)[0].trim() !== `::: {#${id}}`
        ) {
          fail(
            "this slice requires a standalone wrapper declared exactly as ::: {#id}",
          );
        }
        const producer = tableProducer(source, id),
          blocks = richOutput(
            producerOutputChildren(
              ast,
              children(node),
              source.hash,
              producer.id,
            ),
          );
        if (
          !blocks || blocks.length !== 3 || blocks[0].t !== "RawBlock" ||
          blocks[1].t !== "Table" || blocks[2].t !== "RawBlock"
        ) {
          fail(
            "use exactly one gt table under one non-echoed producer cell; additional output cannot be dropped",
          );
        }
        const open = blocks[0].c as [string, string],
          close = blocks[2].c as [string, string];
        if (
          open[0] !== "html" || close[0] !== "html" ||
          !/^\s*<div\b[^>]*>\s*<style>[\s\S]*<\/style>\s*$/.test(open[1]) ||
          !/^\s*<\/div>\s*$/.test(close[1])
        ) fail("gt output needs one original scoped CSS container and table");
        if (
          !Array.isArray(api) || !api.length || api.length > 8 ||
          api.some((v) => !Number.isSafeInteger(v) || Number(v) < 0)
        ) fail("captured Pandoc API version is required");
        if (
          !matches[0].slideId ||
          !source.slides.some((s) => s.id === matches[0].slideId && s.stable)
        ) fail("use an explicit stable slide for the table");
        if (canonical(blocks).length > 2_000_000) {
          fail("table output exceeds 2 MB");
        }
        result.push({
          version: 1,
          kind: "gt-static",
          source: {
            sourceHash: source.hash,
            sourceId: id,
            producerId: producer.id,
            slideId: matches[0].slideId,
            chunkHash: hashSource(producer.raw),
            outputHash: hashSource(canonical(blocks)),
          },
          pandocApiVersion: api as number[],
          blocks: structuredClone(blocks),
        });
      } else visit(children(node));
    }
  }
  visit(ast.blocks);
  return result;
}
export async function richTableHtml(
  candidate: RichTableCandidate,
): Promise<string> {
  if (
    candidate.version !== 1 || candidate.kind !== "gt-static" ||
    hashSource(canonical(candidate.blocks)) !== candidate.source.outputHash
  ) fail("candidate output receipt mismatch");
  const command = new Deno.Command("quarto", {
    args: ["pandoc", "--from=json", "--to=html5", "--wrap=none"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(
      JSON.stringify({
        "pandoc-api-version": candidate.pandocApiVersion,
        meta: {},
        blocks: candidate.blocks,
      }),
    ),
  );
  await writer.close();
  const output = await command.output();
  if (!output.success) {
    fail(
      `fragment HTML writer failed: ${
        new TextDecoder().decode(output.stderr).slice(-1000)
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}
const inspectExpression = String.raw`(async()=>{
 await document.fonts.ready;
 const root=document.getElementById('qb-rich-table-root');
 if(!root||document.body.children.length!==1||document.body.firstElementChild!==root||[...document.body.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))throw new Error('static fragment escaped its capture container');
 const container=root.firstElementChild;
 if(root.children.length!==1||!container||container.tagName!=='DIV'||!/^[-a-zA-Z0-9_]+$/.test(container.id)||container.id==='qb-rich-table-root')throw new Error('one scoped gt container is required');
 const styles=root.querySelectorAll('style');
 if(styles.length!==1||styles[0].parentElement!==container)throw new Error('one original scoped gt stylesheet is required');
 const allowed=new Set('DIV STYLE TABLE CAPTION COLGROUP COL THEAD TBODY TFOOT TR TH TD SPAN P STRONG EM B I SUP SUB BR HR ABBR'.split(' '));
 const attributes=new Set('id class style colspan rowspan headers scope role aria-label aria-hidden title data-quarto-postprocess data-quarto-disable-processing data-quarto-bootstrap data-quarto-table-cell-role'.split(' '));
 function fail(message){throw new Error(message)};
 for(const e of root.querySelectorAll('*')){
  if(!allowed.has(e.tagName))fail('unsupported static HTML tag '+e.tagName);
  for(const a of e.attributes)if(!attributes.has(a.name))fail('unsupported static HTML attribute '+a.name);
  const css=e.tagName==='STYLE'?e.textContent:e.getAttribute('style')||'';
  if(/[\\@]|url\s*\(|image-set\s*\(/i.test(css))fail('external resources, font imports and escaped CSS need a faithful bundled adapter');
  if(e.tagName==='STYLE'){
   for(const rule of e.sheet.cssRules)if(rule.type!==CSSRule.STYLE_RULE||rule.selectorText.split(',').some(selector=>!selector.trim().startsWith('#'+container.id+' ')))fail('CSS must stay scoped to the original gt container');
  }else{
   const s=getComputedStyle(e);
   if(s.animationName!=='none'||s.transitionDuration.split(',').some(v=>parseFloat(v)!==0)||['absolute','fixed','sticky'].includes(s.position)||s.transform!=='none'||s.scale!=='none'||s.rotate!=='none'||s.translate!=='none'||s.zoom!=='1'||s.filter!=='none'||s.clipPath!=='none'||s.maskImage!=='none'||s.boxShadow!=='none')fail('animated transformed or positioned HTML needs a separate layout adapter');
   if(s.visibility!=='visible'||s.opacity!=='1')fail('hidden or transparent table content cannot be validated');
   for(const pseudo of ['::before','::after'])if(!['none','normal'].includes(getComputedStyle(e,pseudo).content))fail('generated CSS content needs a separate content adapter');
  }
 }
 const tables=root.querySelectorAll('table');if(tables.length!==1||!tables[0].classList.contains('gt_table'))fail('one gt table is required');
 const box=root.getBoundingClientRect(),tableBox=tables[0].getBoundingClientRect();
 if(tableBox.left<box.left-0.01||tableBox.right>box.right+0.01||tableBox.top<box.top-0.01||tableBox.bottom>box.bottom+0.01)fail('complete table box exceeds capture bounds');
 let minFontSize=Infinity,minBodyFontSize=Infinity;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 function invisibleColor(color){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]===0;}
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const n=walker.currentNode;if(!n.textContent.trim()||n.parentElement.tagName==='STYLE')continue;
  const range=document.createRange();range.selectNodeContents(n);const rects=[...range.getClientRects()];
  if(!rects.length)fail('text is hidden instead of captured');
  const textStyle=getComputedStyle(n.parentElement);
  if(invisibleColor(textStyle.color)||invisibleColor(textStyle.webkitTextFillColor))fail('transparent text cannot be validated');
  const fontSize=parseFloat(textStyle.fontSize);
  minFontSize=Math.min(minFontSize,fontSize);
  const marker=n.parentElement.closest('.gt_footnote_marks');
  if(!marker||marker.textContent.trim().length>6)minBodyFontSize=Math.min(minBodyFontSize,fontSize);
  for(const r of rects){
   if(!r.width||!r.height||r.left<box.left-0.01||r.right>box.right+0.01||r.top<box.top-0.01||r.bottom>box.bottom+0.01)fail('table text exceeds the complete capture bounds');
   for(let e=n.parentElement;e&&root.contains(e);e=e.parentElement){
    const s=getComputedStyle(e),b=e.getBoundingClientRect();
    if(['hidden','clip','auto','scroll'].includes(s.overflowX)&&(r.left<b.left-0.01||r.right>b.right+0.01))fail('horizontal text clipping');
    if(['hidden','clip','auto','scroll'].includes(s.overflowY)&&(r.top<b.top-0.01||r.bottom>b.bottom+0.01))fail('vertical text clipping');
   }
  }
 }
 if(minFontSize<8||minBodyFontSize<10||!Number.isFinite(minBodyFontSize))fail('table text is below the supported readable size');
 const cells=[...tables[0].querySelectorAll('th,td')];
 return {width:Math.ceil(box.width),height:Math.ceil(box.height),minFontSize,minBodyFontSize,rows:tables[0].rows.length,cells:cells.length,text:cells.map(e=>e.innerText).join('\n')};
})()`;
export async function snapshotRichTable(
  candidate: RichTableCandidate,
  options: { chromium?: string; timeoutMs?: number; maxHeight?: number } = {},
): Promise<RichTableSnapshot> {
  const maxHeight = options.maxHeight ?? 534;
  if (!Number.isSafeInteger(maxHeight) || maxHeight < 1 || maxHeight > 534) {
    fail(
      "remaining capture frame height must be an integer from 1 through 534",
    );
  }
  const html = await richTableHtml(candidate);
  if (html.length > 2_000_000) fail("HTML output exceeds 2 MB");
  return await withHeadlessChromium(options, async (client) => {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["*"] });
    await client.send("Emulation.setScriptExecutionDisabled", { value: true });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1120,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const tree = await client.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await client.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html:
        `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>html,body{margin:0;padding:0;background:white}#qb-rich-table-root{display:flow-root;width:1120px}</style><div id="qb-rich-table-root">${html}</div>`,
    });
    const evaluated = await client.send<
      {
        result: {
          value: {
            width: number;
            height: number;
            rows: number;
            cells: number;
            minFontSize: number;
            minBodyFontSize: number;
            text: string;
          };
        };
        exceptionDetails?: unknown;
      }
    >("Runtime.evaluate", {
      expression: inspectExpression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) {
      fail(
        `static capture validation failed: ${
          canonical(evaluated.exceptionDetails)
        }`,
      );
    }
    const measured = evaluated.result.value;
    if (
      measured.width !== 1120 || measured.height < 1 ||
      measured.height > maxHeight
    ) {
      fail(
        "complete table exceeds the remaining slide frame; split it in the source, do not clip or shrink it",
      );
    }
    if (client.events.some((e) => e.method === "Network.requestWillBeSent")) {
      fail(
        "static table attempted to request a resource; offline dependency bundling is unsupported",
      );
    }
    const capture = await client.send<{ data: string }>(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1120, height: measured.height, scale: 2 },
      },
    );
    const png = Uint8Array.from(atob(capture.data), (c) => c.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", png);
    const pngHash = Array.from(
      new Uint8Array(digest),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    return {
      candidate,
      png,
      diagnostic: {
        code: "STATIC_TABLE_PNG_FALLBACK",
        message:
          "This computed gt table is preserved as a static 2x PNG, including its executed formatting. It is raster, not a native editable table or vector image; change its data and formatting in the source producer.",
      },
      receipt: {
        version: 1,
        kind: "gt-static-png",
        source: structuredClone(candidate.source),
        htmlHash: hashSource(html),
        pngHash,
        textHash: hashSource(measured.text),
        browser: client.version,
        width: 1120,
        height: measured.height,
        pixelRatio: 2,
        rows: measured.rows,
        cells: measured.cells,
        minFontSize: measured.minFontSize,
        minBodyFontSize: measured.minBodyFontSize,
      },
    };
  });
}
