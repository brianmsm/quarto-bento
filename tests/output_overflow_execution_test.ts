import { pathToFileURL } from "node:url";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { extractDocument } from "../src/render/html.ts";
import { outputOverflowTargets } from "../src/render/output-overflow.ts";
import { scanSource } from "../src/source/mod.ts";
import { initializeDesignPackage } from "../src/core/design-initialize.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("long computed outputs retain complete content through scroll native save print and recomputation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-scroll-" });
  try {
    const source = dir + "/deck.qmd";
    const qmd = `## Text {#text}

\`\`\`{r}
#| label: long-text
#| echo: false
#| bento-overflow: scroll
#| bento-overflow-height: 180
cat(paste0(readLines("prefix.txt"), seq_len(120)), sep="\\n")
\`\`\`

## Table {#table}

\`\`\`{r}
#| label: long-table
#| echo: false
#| bento-overflow: scroll
#| bento-overflow-height: 220
knitr::kable(data.frame(item=seq_len(40), label=ifelse(seq_len(40)==40,"TABLE_FINAL40","a & b")), format="pipe")
\`\`\`

## Widget {#widget}

::: {#combined-result}

\`\`\`{r}
#| label: combined-widget
#| echo: false
plotly::plot_ly(x=1:3,y=c(2,4,3),type="scatter",mode="markers")
\`\`\`

:::
`;
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(dir + "/prefix.txt", "row\n");
    const rendered = await renderProject(source);
    assert(
      !rendered.diagnostics.some((d) =>
        ["TEXT_OVERFLOW", "NATIVE_CONTENT_OVERFLOW", "OVERFLOW"].includes(
          d.code,
        )
      ),
      JSON.stringify(rendered.diagnostics),
    );
    const state = rendered.state;
    const code = state.emitted.slides[0].elements.find((e) =>
      e.type === "code"
    )!;
    const table = state.emitted.slides[1].elements.find((e) =>
      e.type === "table"
    )!;
    assert(
      code.h === 180 && String(code.content).trimEnd().endsWith("row120"),
      JSON.stringify(code),
    );
    assert(
      table.h === 220 && Array.isArray(table.rows) && table.rows.length === 41,
    );
    const browserResult = await withHeadlessChromium({}, async (browser) => {
      await browser.send("Page.enable");
      await browser.send("Runtime.enable");
      await browser.send("Page.navigate", {
        url: pathToFileURL(dir + "/deck.bento.html").href,
      });
      const result = await browser.send<{
        result: {
          value: {
            content: string;
            saved: string;
            print: string;
            scroll: boolean;
            tableScroll: boolean;
            css: string;
          };
        };
        exceptionDetails?: unknown;
      }>("Runtime.evaluate", {
        expression: `(async()=>{
          for(let i=0;i<200&&!document.querySelector('.qb-overflow-control');i++)await new Promise(r=>setTimeout(r,25));
          const target=id=>[...document.querySelectorAll('[data-slide-id="'+id+'"]')].find(s=>!s.closest('.bento-thumb-surface')) ;
          const outer=target("text")?.querySelector('[data-el-id="${code.id}"]');
          if(!outer)throw new Error('native output missing');
          outer.querySelector('.qb-overflow-control').click();
          outer.scrollTop=outer.scrollHeight;
          const scroll=outer.scrollTop>0;
          const css=getComputedStyle(outer.querySelector('.qb-overflow-control')).position;
          outer.querySelector('.qb-overflow-full').click();
          const content=document.querySelector('dialog').textContent;
          if(getComputedStyle(document.querySelector('dialog pre')).fontSize!=='${code.fontSize}px')throw new Error('Complete view changed native typography');
          document.querySelector('dialog').close();
          document.querySelectorAll('.ed-thumb')[1].click();
          for(let i=0;i<200&&!target('table')?.querySelector('.qb-overflow-control');i++)await new Promise(r=>setTimeout(r,25));
          const table=target('table').querySelector('[data-el-id="${table.id}"]');
          table.querySelector('.qb-overflow-control').click();table.scrollTop=table.scrollHeight;const tableScroll=table.scrollTop>0;
          window.dispatchEvent(new Event('beforeprint'));
          if(document.querySelector('.bento-thumb-surface .qb-overflow-control,#bento-print .qb-overflow-control'))throw new Error('Transient controls leaked into native previews');
          if(outer.querySelectorAll('.qb-overflow-control').length!==1)throw new Error('Duplicate overflow controls');
          return {content,saved:window.bento.serialize(),print:document.querySelector('#qb-overflow-print').textContent,scroll,tableScroll,css};
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      const pdf = await browser.send<{ data: string }>("Page.printToPDF", {
        printBackground: true,
      });
      await Deno.writeFile(
        dir + "/deck.pdf",
        Uint8Array.from(atob(pdf.data), (char) => char.charCodeAt(0)),
      );
      return result.result.value;
    });
    assert(
      browserResult.scroll && browserResult.tableScroll &&
        browserResult.css === "absolute" &&
        browserResult.content.includes("row120"),
    );
    assert(
      browserResult.print.includes("row120") &&
        browserResult.print.includes("a & b"),
    );
    assert(browserResult.saved.includes('id="qbento-output-overflow"'));
    const saved = extractDocument(browserResult.saved);
    assert(saved.docId === state.docId);
    const savedCode = saved.slides[0].elements.find((e) => e.id === code.id)!;
    const savedTable = saved.slides[1].elements.find((e) => e.id === table.id)!;
    assert(savedCode.content === code.content && savedCode.h === code.h);
    assert(JSON.stringify(savedTable.rows) === JSON.stringify(table.rows));
    const pdf = await new Deno.Command("pdftotext", {
      args: [dir + "/deck.pdf", "-"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const pdfText = new TextDecoder().decode(pdf.stdout);
    assert(
      pdf.success && Array.from({ length: 120 }, (_, i) =>
        `row${i + 1}`).every((line) =>
          new RegExp(`\\b${line}\\b`).test(pdfText)
        ) &&
        (pdfText.match(/^a&b$/gm)?.length ?? 0) === 39 &&
        pdfText.includes("TABLE_FINAL40"),
      pdfText.slice(-3000),
    );
    assert(rendered.presenter, "Combined widget Presenter was not staged");
    const presenterPath = rendered.presenter;
    await withHeadlessChromium({}, async (browser) => {
      await browser.send("Page.enable");
      await browser.send("Page.navigate", {
        url: pathToFileURL(presenterPath).href,
      });
      const ready = await browser.send<
        { result: { value: boolean }; exceptionDetails?: unknown }
      >(
        "Runtime.evaluate",
        {
          expression:
            `(async()=>{for(let i=0;i<200;i++){const child=document.getElementById('deck')?.contentWindow;if(child?.bento?.doc&&child.document.querySelector('.qb-overflow-control')){await child.document.fonts.ready;return true;}const {promise,resolve}=Promise.withResolvers();setTimeout(resolve,25);await promise;}return false;})()`,
          awaitPromise: true,
          returnByValue: true,
        },
      );
      assert(
        ready.result.value && !ready.exceptionDetails,
        JSON.stringify(ready),
      );
      const printed = await browser.send<{ data: string }>("Page.printToPDF", {
        printBackground: true,
      });
      await Deno.writeFile(
        dir + "/presenter.pdf",
        Uint8Array.from(atob(printed.data), (char) => char.charCodeAt(0)),
      );
      const projection = await browser.send<
        { result: { value: { pages: number; images: number; frames: number } } }
      >(
        "Runtime.evaluate",
        {
          expression:
            "({pages:document.querySelectorAll('#qb-presenter-print .bp-page').length,images:document.querySelectorAll('#qb-presenter-print .bp-page img').length,frames:document.querySelectorAll('#qb-presenter-print iframe').length})",
          returnByValue: true,
        },
      );
      assert(
        projection.result.value.pages === state.emitted.slides.length,
        "Presenter lost native slide print projection",
      );
      assert(
        projection.result.value.images > 0 &&
          projection.result.value.frames === 0,
        "Print must retain static widget fallback without interactive frames",
      );
    });
    const combined = await new Deno.Command("pdftotext", {
      args: [dir + "/presenter.pdf", "-"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const combinedText = new TextDecoder().decode(combined.stdout);
    assert(
      combined.success &&
        Array.from({ length: 120 }, (_, i) => `row${i + 1}`).every((line) =>
          new RegExp(`\\b${line}\\b`).test(combinedText)
        ) && combinedText.includes("TABLE_FINAL40") &&
        (combinedText.match(/a\s*&\s*b/g)?.length ?? 0) >= 39,
      combinedText.slice(-3000),
    );
    await Deno.writeTextFile(dir + "/reopened.html", browserResult.saved);
    await withHeadlessChromium({}, async (browser) => {
      await browser.send("Page.enable");
      await browser.send("Page.navigate", {
        url: pathToFileURL(dir + "/reopened.html").href,
      });
      const reopened = await browser.send<{ result: { value: boolean } }>(
        "Runtime.evaluate",
        {
          expression:
            `(async()=>{for(let i=0;i<200&&!document.querySelector('.qb-overflow-control');i++)await new Promise(r=>setTimeout(r,25));return !!document.querySelector('.qb-overflow-control')&&window.bento.doc.slides[0].elements.find(e=>e.id===${
              JSON.stringify(code.id)
            }).content.endsWith('row120');})()`,
          awaitPromise: true,
          returnByValue: true,
        },
      );
      assert(
        reopened.result.value,
        "Native save lost complete output or scroll controls",
      );
    });
    const edited = structuredClone(state.emitted);
    edited.slides[0].elements.find((e) => e.id === code.id)!.fontSize = 22;
    await saveProject(source, edited, state.revision);
    await Deno.writeTextFile(dir + "/prefix.txt", "changed\n");
    const rerendered = await renderProject(source);
    const next = rerendered.state.emitted.slides[0].elements.find((e) =>
      e.id === code.id
    )!;
    assert(
      next.fontSize === 22 &&
        String(next.content).trimEnd().endsWith("changed120"),
    );
    assert(
      rerendered.state.docId === state.docId &&
        rerendered.state.pending.length === 0,
    );
    assert((await readProject(source)).revision === rerendered.state.revision);
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("invalid scroll options refuse before producer execution", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(
      source,
      "## Result {#result}\n\n```{r}\n#| label: invalid\n#| bento-overflow: scroll\n#| bento-overflow-height: 10\nfile.create('producer-ran')\n```\n",
    );
    let error = "";
    try {
      await renderProject(source);
    } catch (caught) {
      error = String(caught);
    }
    assert(error.includes("INVALID_OUTPUT_OVERFLOW"), error);
    assert(
      !await Deno.stat(dir + "/producer-ran").then(() => true, () => false),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("scroll viewports reserve echoed code stdout and tables in cards columns grids and theme slots", async () => {
  const dir = await Deno.makeTempDir({
    prefix: "qbento-overflow-composition-",
  });
  try {
    const source = dir + "/deck.qmd";
    const qmd = ["plain", "card", "column", "grid", "slot"].map((kind) => {
      const wrapper = kind === "plain"
        ? ""
        : `::: {#${kind}-panel .bento-card${
          kind === "slot" ? ' bento-slot="panel"' : ""
        }}\n\n`;
      return `## ${kind} {#${kind}}\n\n${wrapper}\`\`\`{r}\n#| label: ${kind}-output\n#| echo: true\n#| bento-overflow: scroll\n#| bento-overflow-height: 120\n${
        ["column", "slot"].includes(kind) ? "#| output-location: column\n" : ""
      }${kind === "grid" ? "#| layout-ncol: 2\n" : ""}${
        Array.from({ length: 30 }, (_, i) => `# echoed line ${i + 1}`).join(
          "\n",
        )
      }\ncat(paste0("FULL_LINE_",seq_len(120)),sep="\\n")\nknitr::kable(data.frame(item=seq_len(30),value="full"),format="pipe")\n\`\`\`\n\n${
        wrapper ? ":::\n" : ""
      }`;
    }).join("\n");
    await Deno.writeTextFile(source, qmd);
    await initializeDesignPackage(source, {
      format: "qbento/design",
      version: 1,
      name: "Overflow composition",
      registry: {
        schemaVersion: 1,
        activeTheme: "course",
        themes: {
          course: {
            background: "#ffffff",
            color: "#243a42",
            accent: "#be2161",
            fontFamily: "Arial",
            styles: { code: { fontSize: 22 } },
            namedStyles: {
              panel: {
                target: "card",
                properties: { fill: "#eef8f6", radius: 12 },
              },
            },
            defaultVariant: "content",
            variants: {
              content: {
                contentFrame: { x: 64, y: 120, w: 1152, h: 590 },
                slots: {
                  panel: {
                    frame: { x: 64, y: 160, w: 1152, h: 420 },
                    style: "panel",
                  },
                },
              },
            },
          },
        },
      },
    });
    const rendered = await renderProject(source);
    assert(!rendered.diagnostics.length, JSON.stringify(rendered.diagnostics));
    const targets = outputOverflowTargets(
      scanSource(qmd),
      rendered.state.provenance,
      rendered.state.emitted,
    );
    for (const slide of rendered.state.emitted.slides) {
      const codes = slide.elements.filter((element) => element.type === "code");
      const table = slide.elements.find((element) => element.type === "table")!;
      assert(codes.length >= 2 && table, JSON.stringify(slide));
      assert(
        codes.every((code) => Number(code.h) <= 120 && code.fontSize === 22),
      );
      assert(codes[0].h === 120 && codes[1].h === 120);
      assert(String(codes[0].content).includes("echoed line 30"));
      assert(String(codes[1].content).includes("FULL_LINE_120"));
      assert(
        table.h === 120 && Array.isArray(table.rows) &&
          table.rows.length === 31,
      );
      assert(
        targets.filter((target) => target.slideId === slide.id).length ===
          codes.length + 1,
      );
      if (!["column", "grid", "slot"].includes(slide.id)) {
        assert(Number(codes[1].y) >= Number(codes[0].y) + 120 + 20);
        assert(Number(table.y) >= Number(codes[1].y) + 120 + 20);
      }
      const card = slide.elements.find((element) => element.type === "shape");
      if (card) {
        assert(
          [...codes, table].every((element) =>
            Number(element.y) >= Number(card.y) &&
            Number(element.y) + Number(element.h) <=
              Number(card.y) + Number(card.h)
          ),
        );
      }
    }
    const slot = rendered.state.emitted.slides.find((slide) =>
      slide.id === "slot"
    )!;
    const stdout = slot.elements.filter((element) =>
      element.type === "code"
    )[1];
    const table = slot.elements.find((element) => element.type === "table")!;
    const saved = await withHeadlessChromium({}, async (browser) => {
      await browser.send("Page.enable");
      await browser.send("Page.navigate", {
        url: pathToFileURL(dir + "/deck.bento.html").href,
      });
      const evaluate = async <T>(expression: string): Promise<T> => {
        const result = await browser.send<
          { result: { value: T }; exceptionDetails?: unknown }
        >(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
        );
        assert(
          !result.exceptionDetails,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      const wait = (condition: string) =>
        evaluate(
          `(async()=>{for(let i=0;i<200;i++){if(${condition})return true;const {promise,resolve}=Promise.withResolvers();setTimeout(resolve,25);await promise;}throw new Error('Timed out: '+${
            JSON.stringify(condition)
          });})()`,
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
      const escape = async () => {
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
      };
      await wait("!!window.bento?.doc");
      await evaluate("document.querySelectorAll('.ed-thumb')[4].click()");
      await evaluate(
        `globalThis.outputNode=id=>[...document.querySelectorAll('.bento-slide[data-slide-id="slot"]')].find(node=>!node.closest('.bento-thumb-surface'))?.querySelector('[data-el-id="'+id+'"]')`,
      );
      await wait(
        `!!outputNode(${
          JSON.stringify(stdout.id)
        })?.querySelector('.qb-overflow-control')`,
      );
      const original = await evaluate<string>(
        "JSON.stringify(bento.doc.slides.find(s=>s.id==='slot').elements)",
      );
      for (const element of [stdout, table]) {
        const node = `outputNode(${JSON.stringify(element.id)})`;
        const center = await evaluate<{ x: number; y: number }>(
          `(()=>{const r=${node}.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
        await click(center);
        await wait("!!document.querySelector('.moveable-area')");
        await evaluate(
          "globalThis.originalNativePointers=[...document.querySelectorAll('.moveable-area,.moveable-control,.moveable-line')].map(node=>({node,value:node.style.getPropertyValue('pointer-events'),priority:node.style.getPropertyPriority('pointer-events')}))",
        );
        const buttonPoint = await evaluate<{ x: number; y: number }>(
          `(()=>{const r=${node}.querySelector('.qb-overflow-control').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
        await click(buttonPoint);
        await wait(
          `${node}.querySelector('.qb-overflow-control').getAttribute('aria-pressed')==='true'`,
        );
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...center,
        });
        await browser.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...center,
          deltaY: 20000,
          deltaX: 0,
        });
        await wait(
          `${node}.scrollTop>0&&${node}.scrollTop+${node}.clientHeight>=${node}.scrollHeight-2`,
        );
        assert(
          await evaluate<boolean>(
            `${node}.textContent.includes(${
              JSON.stringify(element === stdout ? "FULL_LINE_120" : "30")
            })`,
          ),
        );
        assert(
          await evaluate<string>(
            "JSON.stringify(bento.doc.slides.find(s=>s.id==='slot').elements)",
          ) === original,
          "Mouse scrolling moved or edited native model content",
        );
        await escape();
        await wait(
          `${node}.querySelector('.qb-overflow-control').getAttribute('aria-pressed')==='false'&&!document.querySelector('.qbento-widget-native-mask')`,
        );
        assert(
          await evaluate<boolean>(
            "originalNativePointers.every(({node,value,priority})=>node.style.getPropertyValue('pointer-events')===value&&node.style.getPropertyPriority('pointer-events')===priority)",
          ),
          "Native pointer styles were not restored",
        );
        const morePoint = await evaluate<{ x: number; y: number }>(
          `(()=>{const r=${node}.querySelector('.qb-overflow-full').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
        await click(morePoint);
        await wait("!!document.querySelector('dialog[open]')");
        assert(
          await evaluate<boolean>(
            "document.activeElement===document.querySelector('dialog button')",
          ),
          "Complete dialog did not take focus",
        );
        if (element === stdout) {
          assert(
            await evaluate<boolean>(
              "document.querySelector('dialog pre').textContent.includes('FULL_LINE_120')&&getComputedStyle(document.querySelector('dialog pre')).fontSize==='22px'",
            ),
          );
        } else {
          assert(
            await evaluate<boolean>(
              "document.querySelector('dialog table').rows.length===31&&document.querySelector('dialog table').rows[30].cells[0].textContent==='30'",
            ),
          );
        }
        await escape();
        await wait(
          `!document.querySelector('dialog')&&document.activeElement===${node}.querySelector('.qb-overflow-full')&&!document.querySelector('.qbento-widget-native-mask')`,
        );
      }
      assert(
        await evaluate<string>(
          "JSON.stringify(bento.doc.slides.find(s=>s.id==='slot').elements)",
        ) === original,
        "Complete view or Escape changed authoritative native geometry/content",
      );
      return await evaluate<string>("window.bento.serialize()");
    });
    const savedSlot = extractDocument(saved).slides.find((slide) =>
      slide.id === "slot"
    )!;
    const savedStdout = savedSlot.elements.find((element) =>
      element.id === stdout.id
    )!;
    assert(
      savedStdout.content === stdout.content && savedStdout.h === 120 &&
        savedStdout.fontSize === 22,
    );
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
