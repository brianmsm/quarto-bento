import {
  chartNumber,
  chartOption,
  executedChartTable,
  projectChart,
} from "../src/render/chart.ts";
import { chartSource, validateAuthoredChart } from "../src/source/chart.ts";
import { parsePipeTable } from "../src/source/table.ts";
import { scanSource } from "../src/source/mod.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { parseDesignAttributes } from "../src/render/design.ts";
import { assertProjectDocument } from "../src/render/validate.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import {
  canonical,
  captureEdits,
  compose,
  createState,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import type { Element, Node } from "../src/render/types.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (
      String(error).includes(code) || (error as { code?: string }).code === code
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const pipe =
  "| | N | M |\n| --- | ---: | ---: |\n| Alpha | -2.5 | 1.25 |\n| Beta | 0 | 3 |\n";
const source =
  `## Data {#data}\n\n::: {#chart .bento-chart bento-chart-kind="bar"}\n${pipe}:::\n`;
function native() {
  return projectChart(parsePipeTable(pipe), "bar", "chart/chart");
}
function option(element: Element) {
  return element.option as Record<string, unknown>;
}
function tableNode(): Node {
  const table = parsePipeTable(pipe), attr = () => ["", [], []];
  const row = (
    cells: typeof table.rows[number],
  ) => [
    attr(),
    cells.map((
      c,
    ) => [
      attr(),
      { t: "AlignDefault" },
      1,
      1,
      c.text ? [{ t: "Plain", c: [{ t: "Str", c: c.text }] }] : [],
    ]),
  ];
  return {
    t: "Table",
    c: [
      attr(),
      [null, []],
      table.columns.map(
        () => [{ t: "AlignDefault" }, { t: "ColWidthDefault" }],
      ),
      [attr(), [row(table.rows[0])]],
      [[attr(), 0, [], table.rows.slice(1).map(row)]],
      [attr(), []],
    ],
  };
}
Deno.test("native chart preserves categorical series and negative two-decimal values as pure JSON", () => {
  const element = native();
  eq(element.type, "chart");
  eq(element.preset, "bar");
  eq(option(element).series, [{ type: "bar", name: "N", data: [-2.5, 0] }, {
    type: "bar",
    name: "M",
    data: [1.25, 3],
  }]);
  eq(option(element).xAxis, {
    type: "category",
    data: ["Alpha", "Beta"],
    axisLabel: { fontSize: 14 },
  });
  eq(option(element).yAxis, {
    type: "value",
    min: -3,
    max: 3,
    axisLabel: { fontSize: 14 },
  });
  eq(chartNumber("-1000000"), -1000000);
  eq(chartNumber("0.01"), .01);
  eq(chartNumber("2.50"), 2.5);
  eq(chartOption(parsePipeTable(pipe), "line").series, [{
    type: "line",
    name: "N",
    data: [-2.5, 0],
    smooth: false,
  }, { type: "line", name: "M", data: [1.25, 3], smooth: false }]);
});
Deno.test("native chart refuses missing coercion numeric rounding loss omitted headers and hidden labels", async () => {
  for (
    const value of [
      "",
      "NA",
      "NaN",
      "Inf",
      "1%",
      "1,5",
      "1e2",
      "01",
      "-0",
      "0.001",
      "1.234",
      "1000001",
      "12oops",
    ]
  ) await refuses(() => chartNumber(value), "UNSUPPORTED_CHART");
  for (
    const text of [
      pipe.replace("| | N", "| Group | N"),
      pipe.replace("Beta", "Alpha"),
      pipe.replace("| M |", "| N |"),
      pipe.replace("Alpha", "This label cannot fit in one category"),
      pipe.replace("| N |", "| |"),
    ]
  ) {
    await refuses(
      () => chartOption(parsePipeTable(text), "bar"),
      "UNSUPPORTED_CHART",
    );
  }
  await refuses(
    () =>
      chartOption(
        parsePipeTable("| | N |\n| --- | --- |\n| A | 1 |\n"),
        "line",
      ),
    "UNSUPPORTED_CHART",
  );
});
Deno.test("original chart role kind and numeric table proof cannot be borrowed from metadata or transformed AST", async () => {
  const doc = scanSource(source), binding = chartSource(doc, "chart");
  eq(binding.kind, "bar");
  eq(binding.computed, false);
  eq(
    validateAuthoredChart(doc, binding.block.id, native()).id,
    binding.block.id,
  );
  for (
    const text of [
      source.replace(".bento-chart", ".ordinary"),
      source.replace("bar", "line"),
      source.replace("1.25", "1.26"),
    ]
  ) {
    await refuses(
      () => validateAuthoredChart({ ...doc, text }, binding.block.id, native()),
      "UNMAPPED_CHART_SOURCE",
    );
  }
  await refuses(
    () =>
      chartSource(
        scanSource(source.replace(".bento-chart", ".bento-chart .bento-card")),
        "chart",
      ),
    "AMBIGUOUS_COMPONENT",
  );
  const ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["data", [], []], [{ t: "Str", c: "Data" }]],
    }, {
      t: "Div",
      c: [["chart", ["bento-chart"], [["bento-chart-kind", "bar"]]], [
        tableNode(),
      ]],
    }],
  };
  const projected = validateProjectionOrigins(
    doc,
    await projectAst(ast, "doc", [], doc),
  );
  eq(projected.origins.data["chart/chart"], {
    origin: "authored",
    sourceId: "chart/unsupported:1",
  });
  await refuses(
    () => projectAst(ast, "doc", [], scanSource(source.replace("bar", "line"))),
    "UNMAPPED_CHART_SOURCE",
  );
});
Deno.test("chart extraction rejects extra output rich content images and multiple producer tables", async () => {
  eq(executedChartTable([tableNode()]).computed, false);
  eq(
    executedChartTable([{
      t: "Div",
      c: [["", ["cell"], []], [{
        t: "Div",
        c: [["", ["cell-output-display"], []], [tableNode()]],
      }]],
    }]).computed,
    true,
  );
  for (
    const nodes of [
      [tableNode(), tableNode()],
      [{ t: "Para", c: [] }],
      [{ t: "Image", c: [] }],
      [tableNode(), { t: "CodeBlock", c: [] }],
      [{ t: "Div", c: [["", ["quarto-float"], []], [tableNode()]] }],
    ]
  ) await refuses(() => executedChartTable(nodes), "UNSUPPORTED_CHART");
  await refuses(
    () => parseDesignAttributes(["chart", ["bento-chart"], []]),
    "CHART_KIND_REQUIRED",
  );
  await refuses(
    () => parseDesignAttributes(["chart", [], [["bento-chart-kind", "bar"]]]),
    "INVALID_CHART_KIND",
  );
});
Deno.test("native chart palette and font persist without retaining computed series or axis limits", async () => {
  const target = { slideId: "slide", elementId: "chart/chart" };
  const document = {
    docId: "doc",
    slides: [{ id: "slide", elements: [native()] }],
  };
  const provenance = { [targetKey(target)]: { origin: "computed" as const } };
  const edited = structuredClone(document);
  const visual = option(edited.slides[0].elements[0]);
  visual.color = ["#123456", "#be2161"];
  (visual.textStyle as Record<string, unknown>).fontFamily = "Fira Sans";
  const saved = captureEdits(createState(document, provenance), edited);
  eq(saved.pending, []);
  eq(saved.overrides[0].fields.length, 2);
  const fresh = structuredClone(document);
  const computed = option(fresh.slides[0].elements[0]);
  computed.series = [{ type: "bar", name: "New", data: [20, 40] }];
  computed.yAxis = { type: "value", min: 0, max: 40 };
  const merged = compose(saved, fresh);
  const result = option(merged.document.slides[0].elements[0]);
  eq(result.color, visual.color);
  eq((result.textStyle as Record<string, unknown>).fontFamily, "Fira Sans");
  eq(result.series, computed.series);
  eq(result.yAxis, computed.yAxis);
  const changedData = structuredClone(merged.document);
  option(changedData.slides[0].elements[0]).series = [{
    type: "bar",
    name: "New",
    data: [999, 40],
  }];
  const conflict = captureEdits(merged.state, changedData);
  eq(conflict.pending[0].origin, "computed");
  await refuses(() => compose(conflict, fresh), "MERGE_CONFLICT");
  const owned = createState(document, provenance, {
    [targetKey(target)]: ["option/color"],
  });
  eq(captureEdits(owned, edited).pending.length, 1);
});

Deno.test("chart option preset and native table linkage are semantic and cannot freeze recomputed data", async () => {
  const document = {
    docId: "doc",
    slides: [{ id: "slide", elements: [native()] }],
  };
  const provenance = {
    [targetKey({ slideId: "slide", elementId: "chart/chart" })]: {
      origin: "computed" as const,
    },
  };
  for (
    const change of [(e: Element) => {
      e.preset = "line";
    }, (e: Element) => {
      e.source = { tableId: "other" };
    }, (e: Element) => {
      option(e).legend = { bottom: 40 };
    }, (e: Element) => {
      option(e).series = [{ type: "bar", name: "N", data: [999, 0] }];
    }]
  ) {
    const state = createState(document, provenance),
      edited = structuredClone(document);
    change(edited.slides[0].elements[0]);
    const saved = captureEdits(state, edited);
    eq(saved.pending.length > 0, true);
    for (const change of saved.pending) {
      eq(change.origin, "computed");
      eq(change.status, "conflict");
      eq(["option", "preset", "source"].includes(change.path[0]), true);
    }
    eq(saved.overrides.length, 0);
    await refuses(() => compose(saved, document), "MERGE_CONFLICT");
  }
  const state = createState(document, provenance),
    edited = structuredClone(document);
  edited.slides[0].elements[0].x = 225;
  const saved = captureEdits(state, edited), fresh = structuredClone(document);
  option(fresh.slides[0].elements[0]).series = [{
    type: "bar",
    name: "N",
    data: [9, 4],
  }];
  const merged = compose(saved, fresh);
  eq(merged.state.pending.length, 0);
  eq(merged.document.slides[0].elements[0].x, 225);
  eq(
    merged.document.slides[0].elements[0].option,
    fresh.slides[0].elements[0].option,
  );
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "real authored chart retains pending semantics and refuses reverse table rewriting",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-authored-chart-" });
    try {
      const path = dir + "/deck.qmd", text = source.replaceAll("\n", "\r\n");
      await Deno.writeTextFile(path, text);
      const first = await renderProject(path);
      assertProjectDocument(first.state.emitted);
      const edited = structuredClone(first.state.emitted),
        element = edited.slides[0].elements.find((e) => e.type === "chart")!;
      eq(element.option, native().option);
      element.x = 230;
      option(element).series = [{ type: "bar", name: "N", data: [99, 0] }, {
        type: "bar",
        name: "M",
        data: [1.25, 3],
      }];
      const saved = await saveProject(path, edited, first.state.revision);
      eq(saved.pending[0].origin, "authored");
      await refuses(() => previewSync(path), "UNSUPPORTED_SYNC");
      eq(await Deno.readTextFile(path), text);
      eq(
        (await new StateStore(dir + "/.qbento").load())?.pending,
        saved.pending,
      );
      const retained = await renderProject(path);
      eq(retained.state.pending.length, 1);
      await Deno.writeTextFile(path, text.replace("1.25", "1.26"));
      await refuses(() => renderProject(path), "MERGE_CONFLICT");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real computed chart refreshes series and labels preserving geometry then refuses native option edits",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-computed-chart-" });
    try {
      const path = dir + "/deck.qmd", csv = dir + "/data.csv";
      const text =
        '## Data {#data}\n\n::: {#chart .bento-chart bento-chart-kind="line"}\n```{r}\n#| label: chart-maker\n#| echo: false\nknitr::kable(read.csv("data.csv"), format="pipe", col.names=c("", "N"))\n```\n:::\n';
      await Deno.writeTextFile(path, text);
      await Deno.writeTextFile(csv, "Group,N\nAlpha,-2.5\nBeta,0.25\n");
      const first = await renderProject(path);
      assertProjectDocument(first.state.emitted);
      const edited = structuredClone(first.state.emitted),
        element = edited.slides[0].elements.find((e) => e.type === "chart")!;
      eq(
        first.state
          .provenance[targetKey({ slideId: "data", elementId: element.id })]
          .origin,
        "computed",
      );
      element.x = 180;
      element.w = 1080;
      element.h = 480;
      option(element).color = ["#be2161", "#243a42"];
      (option(element).textStyle as Record<string, unknown>).fontFamily =
        "serif";
      const saved = await saveProject(path, edited, first.state.revision);
      eq(saved.pending.length, 0);
      await Deno.writeTextFile(csv, "Group,N\nGamma,-3.5\nBeta,1.25\n");
      const fresh = await renderProject(path),
        next = fresh.state.emitted.slides[0].elements.find((e) =>
          e.id === element.id
        )!;
      eq(next.x, 180);
      eq(next.w, 1080);
      eq(next.h, 480);
      eq(option(next).color, ["#be2161", "#243a42"]);
      eq(
        (option(next).textStyle as Record<string, unknown>).fontFamily,
        "serif",
      );
      eq((option(next).xAxis as { data: string[] }).data, ["Gamma", "Beta"]);
      eq(option(next).series, [{
        type: "line",
        name: "N",
        data: [-3.5, 1.25],
        smooth: false,
      }]);
      const changed = structuredClone(fresh.state.emitted),
        chart = changed.slides[0].elements.find((e) => e.id === element.id)!;
      option(chart).legend = { bottom: 20 };
      const conflict = await saveProject(path, changed, fresh.state.revision);
      eq(conflict.pending[0].origin, "computed");
      await refuses(() => previewSync(path), "SYNC_CONFLICT");
      await refuses(() => renderProject(path), "MERGE_CONFLICT");
      eq(await Deno.readTextFile(path), text);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real chart refuses absent numbers and unsupported meaningful category header",
  ignore: !canRun,
  fn: async () => {
    for (
      const content of [
        source.replace("| | N", "| Group | N"),
        source.replace("-2.5", "NA"),
      ]
    ) {
      const dir = await Deno.makeTempDir({ prefix: "qbento-chart-refusal-" });
      try {
        const path = dir + "/deck.qmd";
        await Deno.writeTextFile(path, content);
        await refuses(() => renderProject(path), "UNSUPPORTED_CHART");
        eq(await Deno.readTextFile(path), content);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    }
  },
});
