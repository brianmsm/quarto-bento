import { pathToFileURL } from "node:url";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { extractDocument } from "../src/render/html.ts";

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
knitr::kable(data.frame(item=seq_len(40), label="a & b"), format="pipe")
\`\`\`
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
          document.querySelector('dialog').close();
          document.querySelectorAll('.ed-thumb')[1].click();
          for(let i=0;i<200&&!target('table')?.querySelector('.qb-overflow-control');i++)await new Promise(r=>setTimeout(r,25));
          const table=target('table').querySelector('[data-el-id="${table.id}"]');
          table.querySelector('.qb-overflow-control').click();table.scrollTop=table.scrollHeight;const tableScroll=table.scrollTop>0;
          window.dispatchEvent(new Event('beforeprint'));
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
        (pdfText.match(/^a&b$/gm)?.length ?? 0) === 40,
      pdfText.slice(-3000),
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
