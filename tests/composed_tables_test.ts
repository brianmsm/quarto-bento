import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import {
  applyComponentDesign,
  parseDesignAttributes,
} from "../src/render/design.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { spliceDocument } from "../src/render/html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import type { BentoDoc as StateDoc } from "../src/state/types.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    ok(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const example = new URL("../examples/composed-tables/", import.meta.url);
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-composed-tables-" });
  for (const name of ["deck.qmd", "data.csv"]) {
    await Deno.copyFile(new URL(name, example), `${dir}/${name}`);
  }
  return { dir, source: `${dir}/deck.qmd` };
}
function tables(doc: StateDoc) {
  return doc.slides[0].elements.filter((e) => e.type === "table");
}
interface NativeMetrics {
  id: string;
  width: number;
  height: number;
  font: string;
  columns: number[];
  cells: {
    text: string;
    glyphFits: boolean;
    width: number;
    height: number;
    scrollWidth: number;
    scrollHeight: number;
    padX: string;
    padY: string;
    lineHeight: string;
  }[];
}
async function nativeMetrics(doc: StateDoc, name: string) {
  const shell = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    prepareIsolatedDocument(doc) as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  return await withHeadlessChromium({}, async (browser) => {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html,
    });
    const ids = tables(doc).map((e) => e.id);
    const result = await browser.send<
      { result: { value: NativeMetrics[] }; exceptionDetails?: unknown }
    >("Runtime.evaluate", {
      expression: `(async()=>{
        const ids=${JSON.stringify(ids)};
        const node=id=>document.querySelector('[data-el-id="'+id+'"] .bento-table');
        for(let attempt=0;attempt<200&&!ids.every(id=>node(id));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
        await document.fonts.ready;
        for(let attempt=0;attempt<200&&document.getElementById('bento-splash');attempt++)await new Promise(resolve=>setTimeout(resolve,25));
        if(document.getElementById('bento-splash'))throw new Error('native splash did not dismiss');
        return ids.map(id=>{const table=node(id);if(!table)throw new Error('missing native table '+id);const style=getComputedStyle(table);return {
          id,width:parseFloat(style.width),height:parseFloat(style.height),font:style.fontSize,
          columns:[...table.querySelectorAll('tr:first-of-type td')].map(td=>parseFloat(getComputedStyle(td).width)),
          cells:[...table.querySelectorAll('.bento-cell-inner')].map(cell=>{const style=getComputedStyle(cell.parentElement);const bounds=cell.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(cell);const glyphFits=[...range.getClientRects()].every(rect=>rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1);return {text:cell.textContent,glyphFits,width:cell.clientWidth,height:cell.clientHeight,scrollWidth:cell.scrollWidth,scrollHeight:cell.scrollHeight,padX:style.paddingLeft,padY:style.paddingTop,lineHeight:style.lineHeight};})
        };});
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const metrics = result.result.value;
    for (const [index, metric] of metrics.entries()) {
      const element = tables(doc)[index],
        style = element.style as Record<string, number>;
      ok(
        Math.abs(metric.width - Number(element.w)) < 2,
        JSON.stringify(metric),
      );
      ok(metric.height <= Number(element.h) + 1, JSON.stringify(metric));
      eq(metric.font, `${style.fontSize}px`);
      const weights = element.columns as { w: number }[],
        sum = weights.reduce((a, b) => a + b.w, 0);
      for (const [index, width] of metric.columns.entries()) {
        ok(
          Math.abs(width - Number(element.w) * weights[index].w / sum) < 2,
          JSON.stringify(metric),
        );
      }
      for (const cell of metric.cells) {
        ok(cell.glyphFits, JSON.stringify(cell));
        eq(cell.padX, `${style.cellPadX}px`);
        eq(cell.padY, `${style.cellPadY}px`);
        ok(
          cell.scrollWidth <= cell.width + 1 &&
            cell.scrollHeight <= cell.height + 1,
          JSON.stringify(cell),
        );
        ok(
          cell.height <= parseFloat(cell.lineHeight) + 1,
          JSON.stringify(cell),
        );
      }
    }
    const evidence = Deno.env.get("QBENTO_COMPOSED_TABLES_EVIDENCE");
    if (evidence) {
      await Deno.mkdir(evidence, { recursive: true });
      await Deno.writeTextFile(
        `${evidence}/${name}.json`,
        JSON.stringify({ browser: browser.version, metrics }, null, 2) + "\n",
      );
      const screenshot = await browser.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png" },
      );
      await Deno.writeFile(
        `${evidence}/${name}.png`,
        Uint8Array.from(atob(screenshot.data), (c) => c.charCodeAt(0)),
      );
    }
    return metrics;
  });
}
Deno.test("composed native tables retain final metrics, producer authority, data updates and source-only rebuild", async () => {
  const { dir, source } = await fixture();
  const fresh = await Deno.makeTempDir({ prefix: "qbento-composed-fresh-" });
  try {
    const original = await Deno.readTextFile(source),
      first = await renderProject(source);
    const [authored, computed] = tables(first.state.emitted);
    eq(tables(first.state.emitted).length, 2);
    eq([authored.x, authored.y, authored.w, authored.h], [104, 250, 496, 168]);
    eq([computed.x, computed.y, computed.w, computed.h], [680, 190, 496, 168]);
    const body = first.state.emitted.slides[0].elements.find((e) =>
      e.id === "left/paragraph:1"
    )!;
    ok(Number(body.y) >= Number(authored.y) + Number(authored.h) + 16);
    const proof = first.state
      .provenance[targetKey({ slideId: "data", elementId: computed.id })];
    eq(proof.origin, "computed");
    eq(proof.producer, "maker");
    eq(
      first.state
        .provenance[targetKey({ slideId: "data", elementId: authored.id })]
        .origin,
      "authored",
    );
    await nativeMetrics(first.state.emitted, "initial");
    const edited = structuredClone(first.state.emitted),
      table = tables(edited)[1];
    table.x = 688;
    table.style = {
      ...(table.style as Record<string, string | number>),
      headerBg: "#156f65",
    };
    const saved = await saveProject(source, edited, first.state.revision);
    eq(saved.pending.length, 0);
    eq(await Deno.readTextFile(source), original);
    await Deno.writeTextFile(`${dir}/data.csv`, "Group,N\nAlpha,30\nBeta,7\n");
    const next = await renderProject(source),
      current = tables(next.state.emitted)[1];
    eq(current.x, 688);
    eq(current.style, table.style);
    eq(current.columns, table.columns);
    ok(canonical(current.rows).includes("30"));
    eq(next.state.pending.length, 0);
    eq(next.state.docId, first.state.docId);
    await nativeMetrics(next.state.emitted, "changed-data");
    await Deno.mkdir(`${fresh}/.qbento`);
    for (
      const name of [
        "deck.qmd",
        "data.csv",
        ".qbento/project.json",
        ".qbento/state.json",
      ]
    ) await Deno.copyFile(`${dir}/${name}`, `${fresh}/${name}`);
    const rebuilt = await renderProject(`${fresh}/deck.qmd`);
    eq(rebuilt.state.emitted, next.state.emitted);
    eq(rebuilt.state.pending.length, 0);
    // Computed cell changes remain conflicts; layout support grants no reverse data mapping.
    const tampered = structuredClone(next.state.emitted);
    tables(tampered)[1].rows = computed.rows;
    const pending = await saveProject(source, tampered, next.state.revision);
    eq(pending.pending[0].origin, "computed");
    eq(pending.pending[0].status, "conflict");
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(fresh, { recursive: true });
  }
});
Deno.test("authored composed table cells stay recoverable pending edits without rewriting QMD", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source),
      first = await renderProject(source),
      edit = structuredClone(first.state.emitted);
    const table = tables(edit)[0];
    (table.rows as { cells: { html: string }[] }[])[1].cells[1].html = "99";
    const saved = await saveProject(source, edit, first.state.revision);
    eq(saved.pending.length, 1);
    eq(saved.pending[0].origin, "authored");
    await refuses(() => previewSync(source), "UNSUPPORTED_SYNC");
    const next = await renderProject(source);
    eq(tables(next.state.emitted)[0].rows, table.rows);
    eq(next.state.pending.length, 1);
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("composed table width height and mixed-wrapper failures never publish or replace prior state", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source),
      first = await renderProject(source);
    const output = await Deno.readTextFile(`${dir}/deck.bento.html`);
    for (
      const [qmd, code] of [
        [
          original.replace(
            'bento-layout-name="two-column"',
            'bento-layout-name="two-column" w="400"',
          ),
          "UNSUPPORTED_TABLE_LAYOUT",
        ],
        [
          original.replace(
            'bento-layout-name="two-column"',
            'bento-layout-name="two-column" h="200"',
          ),
          "CARD_CONTENT_OVERFLOW",
        ],
        [
          original.replace(
            "| Beta | 5 |",
            "| Beta | 5 |\n\nSibling inside table wrapper.",
          ),
          "COMPONENT_TABLE_SUBTREE",
        ],
        [
          original.replace(
            "| Beta | 5 |",
            "| Beta | 5 |\n" + "| Z | 1 |\n".repeat(7),
          ),
          "CARD_CONTENT_OVERFLOW",
        ],
      ]
    ) {
      await Deno.writeTextFile(source, qmd);
      await refuses(() => renderProject(source), code);
      eq(await Deno.readTextFile(source), qmd);
      eq(await Deno.readTextFile(`${dir}/deck.bento.html`), output);
      eq((await readProject(source)).revision, first.state.revision);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("direct layout tables retain their own metrics and table groups cannot be scaled", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source);
    await Deno.writeTextFile(
      source,
      original.replace(" .bento-card", "").replace(" .bento-card", "").replace(
        "### Table\n\n",
        "",
      ).replace("Below.\n\n", ""),
    );
    const result = await renderProject(source);
    for (const table of tables(result.state.emitted)) {
      eq([table.w, table.h], [544, 168]);
    }
    const table = tables(result.state.emitted)[0] as Element;
    const moved = applyComponentDesign(
      [[table]],
      parseDesignAttributes(["card", ["bento-card"], []]),
    ).elements.find((e) => e.type === "table")!;
    for (const field of ["rows", "columns", "style", "w", "h"]) {
      eq(moved[field], table[field]);
    }
    await refuses(
      () =>
        applyComponentDesign(
          [[table]],
          parseDesignAttributes(["card", ["bento-card"], [["w", "300"]]]),
        ),
      "COMPONENT_CONTENT_OVERFLOW",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("explicit composed table geometry remains source-owned and pending edits survive render", async () => {
  const { dir, source } = await fixture();
  try {
    const original =
      '## Tables {#tables}\n\n:::: {#card .bento-card x="120" w="900"}\n\n::: {#values}\n| Group | N |\n| :--- | ---: |\n| Alpha | 12 |\n| Beta | 5 |\n:::\n\n::::\n';
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    const table = tables(edited)[0];
    eq([table.x, table.w], [144, 852]);
    table.x = 160;
    const saved = await saveProject(source, edited, first.state.revision);
    ok(saved.pending.some((change) => change.path[0] === "x"));
    await refuses(() => previewSync(source), "UNMAPPED_DESIGN");
    const next = await renderProject(source);
    eq(tables(next.state.emitted)[0].x, 160);
    eq(next.state.pending.length, saved.pending.length);
    eq(next.state.pending[0].after, saved.pending[0].after);
    eq(next.state.pending[0].status, "bento-ahead");
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
