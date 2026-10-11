import { measureNativeText } from "../src/render/measure.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { spliceDocument } from "../src/render/html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("Pinned native browser measurement matches wide glyph, accents, rich code and explicit breaks", async () => {
  const results = await measureNativeText([
    {
      id: "wide",
      type: "text",
      html: "WWWW",
      w: 150,
      fontSize: 52,
      fontFamily: "Arial",
      fontWeight: 700,
      lineHeight: 1.25,
    },
    {
      id: "rich",
      type: "text",
      html: "WWWW <code>12345</code><br>Éxito.",
      w: 150,
      fontSize: 52,
      fontFamily: "Arial",
      fontWeight: 700,
      lineHeight: 1.25,
    },
  ]);
  assert(results[0].height === 134, JSON.stringify(results));
  assert(
    results[1].height > 300 && results[1].height < 400,
    JSON.stringify(results),
  );
  assert(results.every((row) => row.width <= 150));
});

Deno.test("native text metrics load persisted built-in font faces before measuring", async () => {
  const element = {
    id: "font-alias",
    type: "text",
    html: "iiiiiiiiiiiiiiiiiiii",
    w: 120,
    fontSize: 52,
    fontFamily: "KpiBuiltinAlias",
    fontWeight: 900,
    lineHeight: 1.25,
  };
  const fallback = await measureNativeText([element]);
  const embedded = await measureNativeText(
    [element],
    {
      fonts: [{
        family: "KpiBuiltinAlias",
        asset: "builtin:fraunces-900",
        weight: "900",
      }],
    } as unknown as BentoDoc,
  );
  assert(
    fallback[0].height === 199 && embedded[0].height === 264,
    JSON.stringify({ fallback, embedded }),
  );
});

Deno.test("native text measurement refuses unfaithful automatic math and document fields", async () => {
  for (
    const html of [
      "$$x^2$$",
      "$x$",
      "\\(x\\)",
      "\\[x\\]",
      "{{page}}",
      "{{ title }}",
      "<code>{{date:yyyy}}</code>",
      "&#36;&#36;x&#36;&#36;",
      "&#123;&#123;page&#125;&#125;",
      '<a href="https://example.org/{{page}}">Click</a>',
    ]
  ) {
    let refused = false;
    try {
      await measureNativeText([{
        id: "transform",
        type: "text",
        html,
        w: 200,
        fontSize: 26,
      }]);
    } catch (error) {
      refused = String(error).includes("NATIVE_TEXT_TRANSFORM_UNSUPPORTED");
    }
    assert(refused, html);
  }
});

Deno.test("native Range rectangles expose glyph overhang hidden by extreme CSS line boxes", async () => {
  const result = await measureNativeText([
    {
      id: "glyph",
      type: "text",
      html: "A",
      w: 264,
      h: 124,
      fontSize: 300,
      fontFamily: "Arial",
      fontWeight: 400,
      lineHeight: .01,
    },
    {
      id: "lines",
      type: "text",
      html: "A<br>B",
      w: 264,
      h: 124,
      fontSize: 300,
      fontFamily: "Arial",
      fontWeight: 400,
      lineHeight: .01,
    },
    {
      id: "collapsed",
      type: "text",
      html: "A<br>B",
      w: 264,
      fontSize: 100,
      fontFamily: "Arial",
      lineHeight: .00001,
    },
    {
      id: "collapsed-wrap",
      type: "text",
      html: "AAAA",
      w: 70,
      fontSize: 100,
      fontFamily: "Arial",
      lineHeight: .00001,
    },
    {
      id: "zero-lines",
      type: "text",
      html: "A<br>B",
      w: 264,
      fontSize: 100,
      fontFamily: "Arial",
      lineHeight: 0,
    },
  ]);
  assert(
    result[0].lineBoxHeight === 3 && result[0].lineCount === 1,
    JSON.stringify(result),
  );
  assert(
    result[0].height >= 336 && result[0].overhangTop > 100 &&
      result[0].overhangBottom > 100,
    JSON.stringify(result),
  );
  assert(
    result[0].width === 264 && result[0].overhangLeft === 0 &&
      result[0].overhangRight === 0,
    JSON.stringify(result),
  );
  assert(
    result[1].lineCount === 2 && result[1].height > result[0].height,
    JSON.stringify(result),
  );
  assert(
    result[2].lineBoxHeight === 0 && result[2].lineCount >= 2 &&
      result[3].lineBoxHeight === 0 && result[3].lineCount >= 2 &&
      result[4].lineBoxHeight === 0 && result[4].lineCount >= 2,
    JSON.stringify(result),
  );
});

Deno.test("omitted native typography matches actual pinned DOM and composed theme", async () => {
  const elements: Element[] = [{
    id: "theme-default",
    type: "text",
    html: "iiiiiiiiiiiiiiiiiiii",
    x: 20,
    y: 20,
    w: 120,
    h: 600,
    fontSize: 52,
  }, {
    id: "size-default",
    type: "text",
    html: "A",
    x: 200,
    y: 20,
    w: 120,
    h: 100,
  }];
  const document: BentoDoc = {
    format: "bento/slides",
    version: 1,
    docId: "native-defaults",
    title: "Native defaults",
    size: { width: 1280, height: 720 },
    theme: {
      background: "#ffffff",
      accent: "#156f65",
      color: "#172a35",
      fontFamily: "Liberation Mono",
    },
    slides: [{
      id: "defaults",
      background: "#ffffff",
      transition: "fade",
      notes: "",
      elements,
    }],
  };
  const measured = await measureNativeText(elements, document);
  const shell = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    prepareIsolatedDocument(document) as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  const native = await withHeadlessChromium({}, async (browser) => {
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html,
    });
    const result = await browser.send<{
      result: {
        value: {
          lineBoxHeight: number;
          fontSize: string;
          fontFamily: string;
          lineHeight: string;
          fontWeight: string;
          align: string;
          justify: string;
        }[];
      };
    }>("Runtime.evaluate", {
      expression: `(async()=>{
        for(let attempt=0;attempt<200&&!document.querySelector('[data-el-id="size-default"] > .bento-text-inner');attempt++) await new Promise(resolve=>setTimeout(resolve,25));
        const nodes=['theme-default','size-default'].map(id=>document.querySelector('[data-el-id="'+id+'"] > .bento-text-inner'));
        nodes.forEach(node=>node.getBoundingClientRect());await document.fonts.ready;
        return nodes.map(node=>{const style=getComputedStyle(node);return {
          lineBoxHeight:parseFloat(style.height),fontSize:style.fontSize,
          fontFamily:style.fontFamily,lineHeight:style.lineHeight,
          fontWeight:style.fontWeight,align:style.textAlign,
          justify:getComputedStyle(node.parentElement).justifyContent
        }});
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result.value;
  });
  assert(
    native[0].fontFamily.includes("Liberation Mono"),
    JSON.stringify(native),
  );
  assert(native[1].fontSize === "16px", JSON.stringify(native));
  for (const [index, row] of native.entries()) {
    assert(
      row.lineHeight === "normal" && row.fontWeight === "400" &&
        row.align === "start" && row.justify === "normal" &&
        measured[index].lineBoxHeight === row.lineBoxHeight &&
        measured[index].lineCount >= 1,
      JSON.stringify({ native, measured }),
    );
  }
});
