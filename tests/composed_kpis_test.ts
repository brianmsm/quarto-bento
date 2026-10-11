import { renderProject, saveProject } from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { retainedKpiAppearances } from "../src/core/kpi-appearance.ts";
import { measureNativeText } from "../src/render/measure.ts";
import { kpiSource } from "../src/source/kpi.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { spliceDocument } from "../src/render/html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
import type { BentoDoc as StateDoc } from "../src/state/types.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
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
const root = new URL("../examples/composed-kpis/", import.meta.url);
async function fixture(qmd?: string) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-composed-kpi-" }),
    source = `${dir}/deck.qmd`;
  await Deno.writeTextFile(
    source,
    qmd ?? await Deno.readTextFile(new URL("deck.qmd", root)),
  );
  await Deno.copyFile(new URL("data.csv", root), `${dir}/data.csv`);
  return { dir, source };
}
function element(doc: StateDoc, id: string) {
  const found = doc.slides.flatMap((s) => s.elements).find((e) => e.id === id);
  ok(found, `missing ${id}`);
  return found;
}
async function native(doc: StateDoc, name: string) {
  const roles = doc.slides[0].elements.filter((e) =>
    e.type === "text" && e.id.endsWith("/paragraph:1")
  ) as Element[];
  const measured = await measureNativeText(roles, doc as unknown as BentoDoc);
  for (const [i, metric] of measured.entries()) {
    ok(metric.width <= Number(roles[i].w) + 1, JSON.stringify(metric));
    ok(metric.height <= Number(roles[i].h) + 1, JSON.stringify(metric));
    ok(
      metric.overhangTop <= .1 && metric.overhangBottom <= .1,
      JSON.stringify(metric),
    );
  }
  const evidence = Deno.env.get("QBENTO_COMPOSED_KPIS_EVIDENCE");
  if (!evidence) return;
  await Deno.mkdir(evidence, { recursive: true });
  const shell = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    prepareIsolatedDocument(doc) as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  await withHeadlessChromium({}, async (browser) => {
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
    const result = await browser.send<
      { result: { value: unknown }; exceptionDetails?: unknown }
    >("Runtime.evaluate", {
      expression:
        `(async()=>{for(let i=0;i<300;i++){if(document.querySelector('[data-el-id="value/paragraph:1"]')&&!document.getElementById('bento-splash'))break;await new Promise(r=>setTimeout(r,25));}await document.fonts.ready;return ${
          JSON.stringify(roles.map((e) => e.id))
        }.map(id=>{const node=document.querySelector('[data-el-id="'+id+'"]');if(!node)throw new Error('missing role');return{id,text:node.textContent,font:getComputedStyle(node).fontSize,width:node.clientWidth,height:node.clientHeight};});})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    await Deno.writeTextFile(
      `${evidence}/${name}.json`,
      JSON.stringify(
        { browser: browser.version, measured, dom: result.result.value },
        null,
        2,
      ) + "\n",
    );
    const shot = await browser.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png" },
    );
    await Deno.writeFile(
      `${evidence}/${name}.png`,
      Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
    );
  });
}
Deno.test("composed KPI follows verified source frames and weak-heading data changes retain measured appearance and rebuild", async () => {
  const f = await fixture(),
    fresh = await Deno.makeTempDir({ prefix: "qbento-composed-kpi-fresh-" });
  try {
    const qmd = await Deno.readTextFile(f.source),
      first = await renderProject(f.source),
      doc = first.state.emitted;
    eq(kpiSource(scanSource(qmd), "metric").ancestors, ["card", "grid"]);
    eq(kpiSource(scanSource(qmd), "metric").groupId, "grid");
    const bg = element(doc, "metric/qb-kpi-background");
    eq([bg.x, bg.y, bg.w, bg.h], [104, 250, 496, 362]);
    eq([
      element(doc, "literal/qb-kpi-background").x,
      element(doc, "literal/qb-kpi-background").w,
    ], [656, 544]);
    for (
      const e of doc.slides[0].elements.filter((e) => e.id !== "results-title")
    ) eq(e.groupId, "grid");
    const slideId = doc.slides[0].id;
    eq(
      first.state
        .provenance[targetKey({ slideId, elementId: "value/paragraph:1" })]
        .origin,
      "computed",
    );
    eq(element(doc, "value/paragraph:1").html, "20.00");
    await native(doc, "initial");
    const edited = structuredClone(doc),
      value = element(edited, "value/paragraph:1");
    value.x = 140;
    value.fontSize = 28;
    value.lineHeight = 1.6;
    value.h = 70;
    value.color = "#156f65";
    const saved = await saveProject(f.source, edited, first.state.revision);
    eq(saved.pending.length, 0);
    eq(await Deno.readTextFile(f.source), qmd);
    ok(
      retainedKpiAppearances(saved, scanSource(qmd)).get(slideId)?.elements.has(
        value.id,
      ),
    );
    const wrong = structuredClone(saved);
    element(wrong.generatedBaseline, "metric/qb-kpi-background").groupId =
      "metric";
    ok(
      !retainedKpiAppearances(wrong, scanSource(qmd)).get(slideId)?.elements
        .has(value.id),
    );
    await Deno.writeTextFile(`${f.dir}/data.csv`, "value\n100\n200\n300\n");
    const next = await renderProject(f.source),
      kept = element(next.state.emitted, value.id);
    eq(kept.html, "200.00");
    for (const field of ["x", "fontSize", "lineHeight", "h", "color"]) {
      eq(kept[field], value[field]);
    }
    eq(next.state.pending.length, 0);
    eq(next.state.docId, first.state.docId);
    eq(next.diagnostics, []);
    await native(next.state.emitted, "changed-data");
    await Deno.mkdir(`${fresh}/.qbento`);
    for (
      const name of [
        "deck.qmd",
        "data.csv",
        ".qbento/project.json",
        ".qbento/state.json",
      ]
    ) await Deno.copyFile(`${f.dir}/${name}`, `${fresh}/${name}`);
    const rebuilt = await renderProject(`${fresh}/deck.qmd`);
    eq(rebuilt.state.emitted, next.state.emitted);
    eq(rebuilt.state.pending.length, 0);
    const tampered = structuredClone(next.state.emitted);
    element(tampered, value.id).html = "999";
    const conflict = await saveProject(f.source, tampered, next.state.revision);
    eq(conflict.pending[0].origin, "computed");
    await refuses(() => previewSync(f.source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(f.source), qmd);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
    await Deno.remove(fresh, { recursive: true });
  }
});
Deno.test("composed KPI data-only capacity rescue retains exact native boxes without scaling default source metrics", async () => {
  const original = (await Deno.readTextFile(new URL("deck.qmd", root))).replace(
    'sprintf("%.2f", mean(read.csv("data.csv")$value))',
    'paste(read.csv("data.csv")$value, collapse=" ")',
  ) + '\n\n::: {#after h="40"}\nAfter KPI.\n:::\n';
  const f = await fixture(original);
  try {
    const first = await renderProject(f.source),
      edit = structuredClone(first.state.emitted),
      bg = element(edit, "metric/qb-kpi-background");
    Object.assign(element(edit, "label/paragraph:1"), {
      y: Number(bg.y) + 24,
      h: 40,
    });
    Object.assign(element(edit, "value/paragraph:1"), {
      fontSize: 12,
      lineHeight: 1.6,
      y: Number(bg.y) + 80,
      h: 210,
    });
    Object.assign(element(edit, "detail/paragraph:1"), {
      y: Number(bg.y) + 310,
      h: 35,
    });
    const saved = await saveProject(f.source, edit, first.state.revision);
    eq(saved.pending.length, 0);
    await Deno.writeTextFile(
      `${f.dir}/data.csv`,
      "value\n" + "score\n".repeat(60),
    );
    const next = await renderProject(f.source),
      value = element(next.state.emitted, "value/paragraph:1");
    eq(value.html, Array(60).fill("score").join(" "));
    eq(element(next.state.emitted, "after/paragraph:1").y, 656);
    for (
      const id of [
        "label/paragraph:1",
        "value/paragraph:1",
        "detail/paragraph:1",
      ]
    ) {
      for (const key of ["x", "y", "w", "h", "fontSize", "lineHeight"]) {
        eq(element(next.state.emitted, id)[key], element(edit, id)[key]);
      }
    }
    ok(
      Number(element(next.state.generatedBaseline, value.id).h) > Number(bg.h),
      "source baseline should retain its default typography overflow before overlays",
    );
    eq(element(next.state.generatedBaseline, value.id).fontSize, 52);
    eq(next.diagnostics, []);
    eq(await Deno.readTextFile(f.source), original);
    await native(next.state.emitted, "rescued-data");
    await Deno.remove(`${f.dir}/deck.bento.html`);
    const rebuilt = await renderProject(f.source);
    eq(rebuilt.state.emitted, next.state.emitted);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("composed KPI refuses ambiguous parent typography geometry and foreign ancestry without publishing", async () => {
  const original = await Deno.readTextFile(new URL("deck.qmd", root));
  for (
    const [qmd, code] of [
      [
        original.replace(
          "{#card .bento-card}",
          '{#card .bento-card font-size="48"}',
        ),
        "COMPONENT_MEASURED_STYLE",
      ],
      [
        original.replace(
          "{#metric .bento-kpi}",
          '{#metric .bento-kpi w="450"}',
        ),
        "COMPONENT_CHILD_GEOMETRY",
      ],
      [
        original.replace("{#card .bento-card}", "{#card}"),
        "KPI_SOURCE_CONTEXT",
      ],
      [
        original.replace(
          'bento-layout-name="two-column"',
          'bento-layout-name="two-column" h="180"',
        ),
        "KPI_CONTENT_OVERFLOW",
      ],
    ]
  ) {
    const f = await fixture(qmd);
    try {
      await refuses(() => renderProject(f.source), code);
      eq(await Deno.readTextFile(f.source), qmd);
      try {
        await Deno.stat(`${f.dir}/deck.bento.html`);
        throw new Error("published refused KPI");
      } catch (error) {
        ok(error instanceof Deno.errors.NotFound, String(error));
      }
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
Deno.test("composed authored KPI text conflict preserves pending work", async () => {
  const qmd = (await Deno.readTextFile(new URL("deck.qmd", root))).replace(
    "## Results",
    "## Results {#results}",
  );
  const f = await fixture(qmd);
  try {
    const original = await Deno.readTextFile(f.source),
      first = await renderProject(f.source),
      edit = structuredClone(first.state.emitted);
    element(edit, "literal-label/paragraph:1").html = "My target";
    const saved = await saveProject(f.source, edit, first.state.revision);
    eq(saved.pending[0].origin, "authored");
    await Deno.writeTextFile(
      f.source,
      original.replace("\nTarget\n", "\nExternal target\n"),
    );
    const state = await Deno.readTextFile(`${f.dir}/.qbento/state.json`),
      html = await Deno.readTextFile(`${f.dir}/deck.bento.html`);
    await refuses(() => renderProject(f.source), "MERGE_CONFLICT");
    eq(await Deno.readTextFile(`${f.dir}/.qbento/state.json`), state);
    eq(await Deno.readTextFile(`${f.dir}/deck.bento.html`), html);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("source-owned KPI role font cannot be rescued by a pending font override", async () => {
  const original = (await Deno.readTextFile(new URL("deck.qmd", root)))
    .replace(
      'sprintf("%.2f", mean(read.csv("data.csv")$value))',
      'paste(read.csv("data.csv")$value, collapse=" ")',
    )
    .replace(
      '{#value bento-role="value"}',
      '{#value bento-role="value" font-size="52"}',
    );
  const f = await fixture(original);
  try {
    const first = await renderProject(f.source),
      edited = structuredClone(first.state.emitted),
      value = element(edited, "value/paragraph:1");
    value.fontSize = 12;
    value.lineHeight = 1.6;
    value.h = 210;
    const saved = await saveProject(f.source, edited, first.state.revision);
    ok(saved.pending.some((change) => change.path[0] === "fontSize"));
    const before = await Deno.readTextFile(`${f.dir}/.qbento/state.json`);
    await Deno.writeTextFile(
      `${f.dir}/data.csv`,
      "value\n" + "score\n".repeat(60),
    );
    await refuses(() => renderProject(f.source), "KPI_CONTENT_OVERFLOW");
    eq(await Deno.readTextFile(`${f.dir}/.qbento/state.json`), before);
    eq(await Deno.readTextFile(f.source), original);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("source-owned enclosing frame blocks capacity rescue before default boxes escape the slot", async () => {
  const original = (await Deno.readTextFile(new URL("deck.qmd", root)))
    .replace(
      'sprintf("%.2f", mean(read.csv("data.csv")$value))',
      'paste(read.csv("data.csv")$value, collapse=" ")',
    )
    .replace(
      'bento-layout-name="two-column"',
      'bento-layout-name="two-column" h="470"',
    );
  const f = await fixture(original);
  try {
    const first = await renderProject(f.source),
      edited = structuredClone(first.state.emitted),
      value = element(edited, "value/paragraph:1");
    value.fontSize = 12;
    value.lineHeight = 1.6;
    const saved = await saveProject(f.source, edited, first.state.revision);
    eq(saved.pending.length, 0);
    const state = await Deno.readTextFile(`${f.dir}/.qbento/state.json`),
      html = await Deno.readTextFile(`${f.dir}/deck.bento.html`);
    await Deno.writeTextFile(
      `${f.dir}/data.csv`,
      "value\n" + "score\n".repeat(60),
    );
    await refuses(() => renderProject(f.source), "KPI_CONTENT_OVERFLOW");
    eq(await Deno.readTextFile(`${f.dir}/.qbento/state.json`), state);
    eq(await Deno.readTextFile(`${f.dir}/deck.bento.html`), html);
    eq(await Deno.readTextFile(f.source), original);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("executed KPI ancestor attributes must match the original source rather than merely reusing its ID", async () => {
  const qmd = (await Deno.readTextFile(new URL("deck.qmd", root))).replace(
    "engine: knitr",
    "engine: knitr\nfilters:\n  - mutate.lua",
  );
  const f = await fixture(qmd);
  try {
    await Deno.writeTextFile(
      `${f.dir}/mutate.lua`,
      'function Div(el)\n  if el.identifier == "card" then el.attributes["fill"] = "#ffeeaa" end\n  return el\nend\n',
    );
    await refuses(() => renderProject(f.source), "KPI_SOURCE_CONTEXT");
    eq(await Deno.readTextFile(f.source), qmd);
    try {
      await Deno.stat(`${f.dir}/deck.bento.html`);
      throw new Error("published transformed ancestor");
    } catch (error) {
      ok(error instanceof Deno.errors.NotFound, String(error));
    }
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
