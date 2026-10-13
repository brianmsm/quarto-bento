import { hashSource } from "../src/source/mod.ts";
import {
  applyLayout,
  type LayoutRequest,
  previewLayout,
  readLayouts,
} from "../src/core/layouts.ts";
import {
  readProject,
  readProjectDiagnostics,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import {
  readProjectRegistry,
  saveProjectRegistry,
} from "../src/core/design-registry.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { nativeLayoutFrame } from "../src/render/native-layout.ts";
import { projectChart } from "../src/render/chart.ts";
import type { PlainTable } from "../src/render/table.ts";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
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
function request(
  s: Awaited<ReturnType<typeof readLayouts>>,
  slideId: string,
  columns: string[][],
  layout = "two-column",
): LayoutRequest {
  return {
    expectedDocId: s.docId,
    expectedRevision: s.revision,
    expectedSourceHash: s.sourceHash,
    expectedRegistryHash: s.registryHash,
    slideId,
    layout,
    columns,
  };
}
const sourceText =
  '---\nqbento-annotations: none\n---\n\n## Results {#results}\n\n::: {#body x=84}\nFirst finding.\n:::\n\n<!-- qb:second -->\nSecond finding.\n\n```python\nprint("β")\n```\n\n## Other {#other}\n\n<!-- qb:foreign -->\nOther slide.\n';
async function fixture(text = sourceText) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-layouts-" }),
    source = dir + "/deck.qmd";
  await Deno.writeTextFile(source, text);
  return { dir, source, text, state: (await renderProject(source)).state };
}
Deno.test("explicit layout preserves source, IDs, provenance, pending content and title; source-owned geometry stays reviewable through sync/rebuild", async () => {
  const f = await fixture(),
    cold = await Deno.makeTempDir({ prefix: "qbento-layouts-rebuild-" });
  try {
    const doc = structuredClone(f.state.emitted),
      slide = doc.slides[0],
      body = slide.elements.find((e) => e.html === "First finding.")!,
      code = slide.elements.find((e) => e.type === "code")!;
    body.html = "Reviewed β finding.";
    code.x = 103;
    const before = await saveProject(f.source, doc, f.state.revision),
      s = await readLayouts(f.source),
      r = request(s, "results", [[body.id], ["second", code.id]]);
    const stateBytes = await Deno.readTextFile(f.dir + "/.qbento/state.json"),
      output = await Deno.readTextFile(f.dir + "/deck.bento.html");
    const preview = await previewLayout(f.source, r);
    ok(preview.placements.length === 3);
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), stateBytes);
    await applyLayout(f.source, r);
    const after = await readProject(f.source);
    eq(after.provenance, before.provenance);
    eq(
      after.emitted.slides[0].elements.map((e) => e.id),
      slide.elements.map((e) => e.id),
    );
    eq(after.emitted.slides[0].elements[0], slide.elements[0]);
    eq(after.emitted.slides[1], doc.slides[1]);
    eq(
      after.pending.find((p) => p.path[0] === "html"),
      before.pending.find((p) => p.path[0] === "html"),
    );
    ok(
      after.pending.some((p) =>
        p.target.elementId === body.id && p.path[0] === "x"
      ),
    );
    ok(
      !after.overrides.find((o) => o.target.elementId === body.id)?.fields.some(
        (f) => f.path[0] === "x",
      ),
    );
    eq(await Deno.readTextFile(f.source), f.text);
    eq(await Deno.readTextFile(f.dir + "/deck.bento.html"), output);
    const plan = await previewSync(f.source);
    ok(plan.result.includes("x=80"));
    ok(plan.result.includes("Reviewed β finding."));
    await applySync(f.source, plan);
    const refreshed = (await renderProject(f.source)).state;
    eq(refreshed.pending, []);
    eq(refreshed.emitted, after.emitted);
    await Deno.copyFile(f.source, cold + "/deck.qmd");
    await Deno.mkdir(cold + "/.qbento");
    for (const file of ["state.json", "project.json"]) {
      await Deno.copyFile(
        f.dir + "/.qbento/" + file,
        cold + "/.qbento/" + file,
      );
    }
    const rebuilt = (await renderProject(cold + "/deck.qmd")).state;
    eq(rebuilt.emitted, refreshed.emitted);
    eq(rebuilt.docId, f.state.docId);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
    await Deno.remove(cold, { recursive: true });
  }
});
Deno.test("layout plans refuse duplicate/foreign/title IDs and stale document, state, source, registry or uncaptured HTML atomically", async () => {
  const f = await fixture();
  try {
    const s = await readLayouts(f.source),
      body = s.slides[0].elements[0].id,
      r = request(s, "results", [[body], ["second"]]);
    const state = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    for (
      const [bad, code] of [
        [{ ...r, columns: [[body], [body]] }, "LAYOUT_ELEMENT_SCOPE"],
        [{ ...r, columns: [[body], ["foreign"]] }, "LAYOUT_ELEMENT_SCOPE"],
        [{
          ...r,
          columns: [[body], [f.state.emitted.slides[0].elements[0].id]],
        }, "LAYOUT_ELEMENT_SCOPE"],
        [{ ...r, columns: [[body]] }, "LAYOUT_COLUMN_COUNT"],
        [{ ...r, expectedRevision: 999 }, "STALE_REVISION"],
        [{ ...r, expectedDocId: "foreign" }, "DOC_ID_CHANGED"],
        [{ ...r, doc: f.state.emitted }, "INVALID_LAYOUT_REQUEST"],
      ] as const
    ) {
      await refuses(
        () => applyLayout(f.source, bad as unknown as LayoutRequest),
        code,
      );
      eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), state);
    }
    await Deno.writeTextFile(f.source, f.text + "\nexternal\n");
    await refuses(() => applyLayout(f.source, r), "STALE_SOURCE");
    await Deno.writeTextFile(f.source, f.text);
    const reg = await readProjectRegistry(f.source);
    await saveProjectRegistry(f.source, {
      expectedDocId: reg.docId,
      expectedRevision: reg.revision,
      expectedHash: reg.hash,
      registry: {
        schemaVersion: 1,
        layouts: { balanced: { columns: 2, padding: 16, gap: 40 } },
      },
    });
    await refuses(() => applyLayout(f.source, r), "DESIGN_REGISTRY_CHANGED");
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), state);
    const fresh = request(await readLayouts(f.source), "results", [[body], [
      "second",
    ]], "balanced");
    await Deno.writeTextFile(
      f.dir + "/deck.bento.html",
      "external native edits",
    );
    await refuses(() => applyLayout(f.source, fresh), "UNCAPTURED_HTML_EDITS");
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), state);
    eq(
      await Deno.readTextFile(f.dir + "/deck.bento.html"),
      "external native edits",
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("named registry definitions apply snapshots and preserve later customization until explicit reapply", async () => {
  const f = await fixture();
  try {
    const reg = await readProjectRegistry(f.source);
    // Registry edits use the live revision and never alter the deck themselves.
    await saveProjectRegistry(f.source, {
      expectedDocId: reg.docId,
      expectedRevision: reg.revision,
      expectedHash: reg.hash,
      registry: {
        schemaVersion: 1,
        layouts: { balanced: { columns: 2, gap: 40, padding: 16 } },
      },
    });
    let s = await readLayouts(f.source);
    const body = s.slides[0].elements[0].id;
    await applyLayout(
      f.source,
      request(s, "results", [[body], ["second"]], "balanced"),
    );
    let state = await readProject(f.source);
    const doc = structuredClone(state.emitted);
    doc.slides[0].elements.find((e) => e.id === "second")!.y = 300;
    state = await saveProject(f.source, doc, state.revision);
    const current = await readProjectRegistry(f.source);
    await saveProjectRegistry(f.source, {
      expectedDocId: current.docId,
      expectedRevision: current.revision,
      expectedHash: current.hash,
      registry: {
        schemaVersion: 1,
        layouts: { balanced: { columns: 2, gap: 80, padding: 20 } },
      },
    });
    eq((await readProject(f.source)).emitted, doc);
    s = await readLayouts(f.source);
    const p = await previewLayout(
      f.source,
      request(s, "results", [[body], ["second"]], "balanced"),
    );
    ok(p.placements.find((e) => e.id === "second")!.y !== 300);
    await applyLayout(
      f.source,
      request(s, "results", [[body], ["second"]], "balanced"),
    );
    ok(
      (await readProject(f.source)).emitted.slides[0].elements.find((e) =>
        e.id === "second"
      )!.y !== 300,
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("simple table and chart adapters validate actual cells, rows, axes and legend without scaling inner metrics", async () => {
  const text =
    '## Table {#tables}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<!-- qb:body -->\nFindings.\n\n## Chart {#charts}\n\n::: {#bars .bento-chart bento-chart-kind="bar"}\n| | N |\n|---|---:|\n| A | 2 |\n| B | 3 |\n:::\n\n<!-- qb:chartbody -->\nSummary.\n';
  const f = await fixture(text);
  try {
    let s = await readLayouts(f.source);
    const table = f.state.emitted.slides[0].elements.find((e) =>
      e.type === "table"
    )!;
    const original = structuredClone(table);
    await applyLayout(f.source, request(s, "tables", [[table.id], ["body"]]));
    s = await readLayouts(f.source);
    await applyLayout(
      f.source,
      request(s, "charts", [["bars/chart"], ["chartbody"]]),
    );
    const state = await readProject(f.source),
      placed = state.emitted.slides[0].elements.find((e) => e.id === table.id)!;
    eq(placed.columns, original.columns);
    eq(placed.rows, original.rows);
    eq(placed.style, original.style);
    eq(placed.w, 544);
    eq(placed.h, 112);
    eq(
      state.emitted.slides[1].elements.find((e) => e.id === "bars/chart")!
        .option,
      f.state.emitted.slides[1].elements.find((e) => e.id === "bars/chart")!
        .option,
    );
    const tall = {
      ...placed,
      rows: Array.from({ length: 15 }, () => (placed.rows as unknown[])[0]),
    };
    await refuses(
      () =>
        nativeLayoutFrame(tall as typeof placed, {
          x: 80,
          y: 166,
          w: 544,
          h: 470,
        }),
      "UNSUPPORTED_TABLE_LAYOUT",
    );
    await refuses(
      () =>
        nativeLayoutFrame({
          ...placed,
          style: { ...(placed.style as object), fontSize: 30 },
        }, { x: 80, y: 166, w: 544, h: 470 }),
      "UNSUPPORTED_LAYOUT_CONTENT",
    );
    const chart = state.emitted.slides[1].elements.find((e) =>
      e.id === "bars/chart"
    )!;
    await refuses(
      () => nativeLayoutFrame(chart, { x: 80, y: 166, w: 544, h: 150 }),
      "UNSUPPORTED_CHART",
    );
    const plan = await previewSync(f.source);
    if (plan.result !== await Deno.readTextFile(f.source)) {
      await applySync(f.source, plan);
    }
    const rebuilt = (await renderProject(f.source)).state;
    eq(rebuilt.emitted, state.emitted);
    ok(
      state
        .provenance[targetKey({ slideId: "charts", elementId: "bars/chart" })],
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
  const table: PlainTable = {
    header: true,
    columns: [{ width: 1, align: "left" }, { width: 1, align: "right" }],
    rows: [[{ text: "", align: "left" }, { text: "N", align: "right" }], [{
      text: "A",
      align: "left",
    }, { text: "2", align: "right" }]],
  };
  const chart = projectChart(table, "bar", "c");
  eq(nativeLayoutFrame(chart, { x: 80, y: 166, w: 544, h: 470 }), {
    x: 80,
    y: 166,
    w: 544,
    h: 470,
  });
});

Deno.test("external offset or heading edits cannot turn the saved slide title into a selectable layout member", async () => {
  const f = await fixture(
    "# Section\n\n## Results\n\nFirst paragraph.\n\nSecond paragraph.\n",
  );
  try {
    const s = await readLayouts(f.source);
    const title = f.state.emitted.slides[1].elements[0].id;
    ok(!s.slides[1].elements.some((e) => e.id === title));
    for (
      const text of [
        "\n" + f.text,
        f.text.replace("## Results", "## Results {#new-title}"),
        f.text.replace("## Results", "# Results"),
      ]
    ) {
      await Deno.writeTextFile(f.source, text);
      await refuses(() => readLayouts(f.source), "STALE_SOURCE");
      const r = request(s, s.slides[1].id, [[title], [
        s.slides[1].elements[0].id,
      ]]);
      await refuses(
        () =>
          previewLayout(f.source, {
            ...r,
            expectedSourceHash: hashSource(text),
          }),
        "STALE_SOURCE",
      );
    }
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("source-owned coupled parent layout fields remain pending and refuse inverse source guessing", async () => {
  const f = await fixture(
    '## Group {#group}\n\n:::: {#grid .bento-layout bento-layout-name="two-column" x=100}\n\n::: {#left .bento-card}\nFirst.\n:::\n\n::: {#right .bento-card}\nSecond.\n:::\n\n::::\n',
  );
  try {
    const s = await readLayouts(f.source),
      r = request(s, "group", s.slides[0].elements.map((e) => [e.id]));
    ok(r.columns.length === 2);
    const ownership = canonical(f.state.ownership);
    await applyLayout(f.source, r);
    const saved = await readProject(f.source);
    eq(canonical(saved.ownership), ownership);
    ok(saved.pending.some((p) => p.path[0] === "x"));
    eq(saved.provenance, f.state.provenance);
    await refuses(() => previewSync(f.source), "UNMAPPED_DESIGN");
    eq(await Deno.readTextFile(f.source), f.text);
    eq((await readProject(f.source)).emitted, saved.emitted);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("executed CSV chart retains applied frame and provenance across recompute and HTML-free rebuild, with final-frame overflow warning", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-layout-csv-" }),
    cold = await Deno.makeTempDir({ prefix: "qbento-layout-csv-cold-" }),
    source = dir + "/deck.qmd";
  const qmd =
    '## Results {#results}\n\n::: {#chart .bento-chart bento-chart-kind="bar"}\n```{r}\n#| label: maker\n#| echo: false\nn <- if(file.exists("count.txt")) as.integer(readLines("count.txt")) else 0L\nwriteLines(as.character(n+1L),"count.txt")\nknitr::kable(read.csv("data.csv"),format="pipe",col.names=c("","N"))\n```\n:::\n\n<!-- qb:body -->\nA result.\n';
  try {
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(dir + "/data.csv", "label,n\nA,2\nB,3\n");
    const initial = (await renderProject(source)).state;
    await applyLayout(
      source,
      request(await readLayouts(source), "results", [["chart/chart"], [
        "body",
      ]]),
    );
    const saved = await readProject(source);
    eq((await Deno.readTextFile(dir + "/count.txt")).trim(), "1");
    await Deno.writeTextFile(
      dir + "/data.csv",
      "label,n\nLongCategory,5\nB,7\n",
    );
    const result = await renderProject(source),
      chart = result.state.emitted.slides[0].elements.find((e) =>
        e.type === "chart"
      )!,
      prior = saved.emitted.slides[0].elements.find((e) => e.type === "chart")!;
    eq([chart.id, chart.x, chart.y, chart.w, chart.h], [
      prior.id,
      prior.x,
      prior.y,
      prior.w,
      prior.h,
    ]);
    ok(canonical(chart.option) !== canonical(prior.option));
    eq(result.state.pending, []);
    eq(result.state.docId, initial.docId);
    eq(result.state.provenance, saved.provenance);
    ok(
      result.diagnostics.some((d) =>
        d.code === "NATIVE_CONTENT_OVERFLOW" && d.elementId === chart.id
      ),
    );
    eq((await Deno.readTextFile(dir + "/count.txt")).trim(), "2");
    await Deno.copyFile(source, cold + "/deck.qmd");
    await Deno.copyFile(dir + "/data.csv", cold + "/data.csv");
    await Deno.mkdir(cold + "/.qbento");
    for (const file of ["state.json", "project.json"]) {
      await Deno.copyFile(dir + "/.qbento/" + file, cold + "/.qbento/" + file);
    }
    const rebuilt = await renderProject(cold + "/deck.qmd");
    eq(rebuilt.state.emitted, result.state.emitted);
    ok(rebuilt.diagnostics.some((d) => d.code === "NATIVE_CONTENT_OVERFLOW"));
    eq((await Deno.readTextFile(cold + "/count.txt")).trim(), "1");
    eq(await Deno.readTextFile(source), qmd);
    const enlarged = structuredClone(result.state.emitted);
    enlarged.slides[0].elements.find((e) => e.id === chart.id)!.w = 1120;
    await saveProject(source, enlarged, result.state.revision);
    ok(
      !(await readProjectDiagnostics(source)).some((d) =>
        d.code === "NATIVE_CONTENT_OVERFLOW"
      ),
    );
    eq((await Deno.readTextFile(dir + "/count.txt")).trim(), "2");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cold, { recursive: true });
  }
});
