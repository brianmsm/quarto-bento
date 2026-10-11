import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { preflightGraphSync } from "../src/core/graph-sync.ts";
import {
  graphNodeId,
  sourceGraphs,
  timelineLinkId,
} from "../src/source/graphs.ts";
import { scanSource } from "../src/source/mod.ts";
import {
  assertGraphTypography,
  originalGraphNode,
  projectGraph,
} from "../src/render/graphs.ts";
import type { BentoDoc as RenderDoc } from "../src/render/types.ts";
import { targetKey } from "../src/state/mod.ts";
import { fork, timeline } from "./helpers/graphs.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error("expected " + code);
}
const base = { x: 80, y: 166, w: 1120, h: 470 };
Deno.test("real Quarto native labels and source endpoints synchronize together while docId, design and recomputed data survive", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-loop-" });
  try {
    const source = dir + "/deck.qmd";
    const computed = "\n## Datos {#data}\n\n" +
      String.fromCharCode(96).repeat(3) +
      "{r}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nplot(read.csv('data.csv')$value)\n" +
      String.fromCharCode(96).repeat(3) + "\n";
    const original = fork.replace(
      "#edge-a .bento-edge",
      '#edge-a .bento-edge fill="#336699" stroke-width="3"',
    ) + "\n" + timeline + computed;
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
    const first = await renderProject(source),
      doc = structuredClone(first.state.emitted);
    const flow = doc.slides.find((slide) => slide.id === "flow")!;
    const node = flow.elements.find((element) =>
      element.id === "input/qb-node"
    )!;
    const label = flow.elements.find((element) =>
      element.id === "input/paragraph:1"
    )!;
    const edge = flow.elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!;
    node.x = Number(node.x) + 12;
    node.fill = "#c7e9df";
    node.groupId = "native-visual-group";
    label.x = Number(label.x) + 12;
    label.html = "Muestra";
    edge.from = { el: "right/qb-node", side: "left" };
    edge.fill = "#446688";
    edge.strokeWidth = 4;
    const saved = await saveProject(source, doc, first.state.revision);
    assert(await Deno.readTextFile(source) === original, "Save changed source");
    assert(saved.pending.some((change) => change.path.join("/") === "from/el"));
    assert(
      !saved.overrides.some((override) =>
        override.fields.some((field) => field.path.join("/") === "from/el")
      ),
    );
    const plan = await previewSync(source);
    assert(plan.graphs?.patches.length === 1);
    assert(plan.changes.some((change) => change.kind === "graph-endpoint"));
    assert(plan.result.includes('from="right" to="left"'));
    assert(plan.result.includes('fill="#446688" stroke-width="4"'));
    assert(plan.result.includes("\nMuestra\n"));
    await applySync(source, plan);
    const synced = await Deno.readTextFile(source);
    await Deno.writeTextFile(dir + "/data.csv", "value\n4\n8\n15\n");
    const rendered = await renderProject(source);
    assert(rendered.state.docId === first.state.docId);
    assert(rendered.state.pending.length === 0);
    const finalFlow = rendered.state.emitted.slides.find((slide) =>
      slide.id === "flow"
    )!;
    assert(
      finalFlow.elements.find((element) => element.id === node.id)!.x ===
        node.x,
    );
    assert(
      finalFlow.elements.find((element) => element.id === node.id)!.fill ===
        node.fill,
    );
    assert(
      finalFlow.elements.find((element) => element.id === node.id)!.groupId ===
        node.groupId,
    );
    assert(
      finalFlow.elements.find((element) => element.id === edge.id)!.fill ===
          edge.fill &&
        finalFlow.elements.find((element) => element.id === edge.id)!
            .strokeWidth === edge.strokeWidth,
    );
    assert(
      finalFlow.elements.find((element) => element.id === label.id)!.html ===
        "Muestra",
    );
    assert(
      (finalFlow.elements.find((element) => element.id === edge.id)!.from as {
        el: string;
        side: string;
      }).el === "right/qb-node",
    );
    assert(
      (finalFlow.elements.find((element) => element.id === edge.id)!.from as {
        el: string;
        side: string;
      }).side === "left",
    );
    const figure = (state: typeof rendered.state) =>
      state.emitted.slides.find((slide) => slide.id === "data")!.elements.find((
        element,
      ) => element.type === "image")!;
    assert(
      figure(rendered.state).src !== figure(first.state).src,
      "computed figure did not update",
    );
    assert(await Deno.readTextFile(source) === synced);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("timeline lexical reorder changes adjacency while native movement and z-order retain only visual meaning", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-timeline-order-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(source, timeline);
    const first = await renderProject(source),
      doc = structuredClone(first.state.emitted),
      slide = doc.slides[0];
    const node = slide.elements.find((element) =>
      element.id === "start/qb-node"
    )!;
    const label = slide.elements.find((element) =>
      element.id === "start/paragraph:1"
    )!;
    node.x = Number(node.x) + 10;
    node.fill = "#eef3ff";
    label.x = Number(label.x) + 10;
    slide.elements.reverse();
    const saved = await saveProject(source, doc, first.state.revision);
    assert(saved.pending.length === 0);
    const rerender = await renderProject(source);
    assert(await Deno.readTextFile(source) === timeline);
    assert(
      rerender.state.emitted.slides[0].elements.map((element) => element.id)
        .join(",") === slide.elements.map((element) => element.id).join(","),
    );
    const study = "::: {#study .bento-milestone}\nEstudio\n:::\n",
      report = "::: {#report .bento-milestone}\nInforme\n:::\n";
    const reordered = timeline.replace(
      study + "\n" + report,
      report + "\n" + study,
    );
    assert(reordered !== timeline);
    await Deno.writeTextFile(source, reordered);
    const changed = await renderProject(source),
      elements = changed.state.emitted.slides[0].elements;
    assert(changed.state.docId === first.state.docId);
    assert(
      elements.find((element) => element.id === node.id)!.fill === node.fill,
    );
    assert(elements.find((element) => element.id === node.id)!.x === node.x);
    const connectors = elements.filter((element) => element.shape === "line");
    assert(
      connectors.some((element) =>
        element.id === timelineLinkId("story", "start", "report")
      ),
    );
    assert(
      connectors.some((element) =>
        element.id === timelineLinkId("story", "report", "study")
      ),
    );
    assert(
      !connectors.some((element) =>
        element.id === timelineLinkId("story", "start", "study")
      ),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("endpoint source conflicts, stale review, source-result cycles and derived timeline links refuse without source writes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-conflicts-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(source, fork + "\n" + timeline);
    const first = await renderProject(source),
      doc = structuredClone(first.state.emitted);
    doc.slides[0].elements.find((element) => element.id === "edge-a/qb-edge")!
      .from = { el: "right/qb-node" };
    const saved = await saveProject(source, doc, first.state.revision),
      ids = saved.pending.map((change) => change.id);
    const plan = await previewSync(source, ids);
    await Deno.writeTextFile(
      source,
      (fork + "\n" + timeline).replace(
        'from="input" to="left"',
        'from="right" to="left"',
      ),
    );
    await refuses(() => applySync(source, plan), "STALE_SOURCE");
    await refuses(() => previewSync(source, ids), "SOURCE_CONFLICT");
    await Deno.writeTextFile(source, fork + "\n" + timeline);
    const restore = structuredClone((await readProject(source)).emitted);
    restore.slides[0].elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!.from = { el: "input/qb-node" };
    const clean = await saveProject(source, restore, saved.revision);
    const bad = structuredClone(clean.emitted);
    bad.slides[0].elements.find((element) => element.id === "edge-a/qb-edge")!
      .from = { el: "right/qb-node" };
    bad.slides[0].elements.find((element) => element.id === "edge-b/qb-edge")!
      .from = { el: "left/qb-node" };
    const cycle = await saveProject(source, bad, clean.revision);
    await refuses(
      () => previewSync(source, cycle.pending.map((change) => change.id)),
      "GRAPH_TOPOLOGY_UNSUPPORTED",
    );
    assert(await Deno.readTextFile(source) === fork + "\n" + timeline);
    const timelineDoc = structuredClone(cycle.emitted);
    const link = timelineDoc.slides[1].elements.find((element) =>
      element.shape === "line"
    )!;
    link.to = { el: graphNodeId("start") };
    // Change one link to a different same-component node, without creating a self edge.
    if ((link.from as { el: string }).el === graphNodeId("start")) {
      link.to = { el: graphNodeId("report") };
    }
    const timelineSaved = await saveProject(
      source,
      timelineDoc,
      cycle.revision,
    );
    const timelineId = timelineSaved.pending.find((change) =>
      change.target.slideId === "history" && change.path[0] === "to"
    )!.id;
    await refuses(() =>
      previewSync(source, [timelineId]), "UNSUPPORTED_TIMELINE_RELATION");
    assert(await Deno.readTextFile(source) === fork + "\n" + timeline);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("dynamic graph labels reject before execution and unsupported measured/layout content refuses before publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-negative-" });
  try {
    const source = dir + "/deck.qmd";
    const dynamic = fork.replace(
      "Entrada",
      String.fromCharCode(96) + "r 1+1" + String.fromCharCode(96),
    );
    const sentinel = "\n## Ejecución {#execute}\n\n" +
      String.fromCharCode(96).repeat(3) +
      "{r}\nwriteLines('executed','sentinel.txt')\n" +
      String.fromCharCode(96).repeat(3) + "\n";
    await Deno.writeTextFile(source, dynamic + sentinel);
    await refuses(() => renderProject(source), "COMPUTED_GRAPH_LABEL");
    for (const name of ["sentinel.txt", "deck.bento.html"]) {
      let missing = false;
      try {
        await Deno.stat(dir + "/" + name);
      } catch (error) {
        missing = error instanceof Deno.errors.NotFound;
      }
      assert(missing, name + " was published/executed");
    }
    for (
      const original of [
        fork.replace(
          "#input .bento-node",
          '#input .bento-node font-size="300"',
        ),
        fork.replace(
          "#input .bento-node",
          '#input .bento-node font-size="300" line-height=".01"',
        ),
        fork.replace("#graph .bento-diagram", '#graph .bento-diagram h="60"'),
      ]
    ) {
      await Deno.writeTextFile(source, original);
      await refuses(() => renderProject(source), "GRAPH_CONTENT_OVERFLOW");
      assert(await Deno.readTextFile(source) === original);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("clear disjoint collinear source edges remain supported and prospective metrics use retained offline font resources", async () => {
  const text = "## T {#s}\n\n:::: {#g .bento-diagram}\n\n" + [
    ["a", 80, "iiiiiiiiiiiiiiiiiiii"],
    ["b", 330, "B"],
    ["c", 600, "C"],
    ["d", 850, "D"],
  ].map(([id, x, label]) =>
    "::: {#" + id + ' .bento-node x="' + x + '" y="270" w="140" h="160"}\n' +
    label + "\n:::\n"
  ).join("\n") +
    '\n::: {#ab .bento-edge from="a" to="b"}\n:::\n\n::: {#cd .bento-edge from="c" to="d"}\n:::\n\n::::\n';
  const original = scanSource(text), graph = sourceGraphs(original)[0];
  const projected = await projectGraph(
    original,
    await originalGraphNode(graph),
    base,
  );
  assert(
    projected.elements.filter((element) => element.shape === "line").length ===
      2,
  );
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-font-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(source, text);
    const rendered = await renderProject(source),
      doc = structuredClone(rendered.state.emitted);
    const collapsed = structuredClone(rendered.state.emitted);
    const anchoredLabel = collapsed.slides[0].elements.find((element) =>
      element.id === "a/paragraph:1"
    )!;
    anchoredLabel.html = "A";
    anchoredLabel.fontSize = 52;
    anchoredLabel.lineHeight = .01;
    delete anchoredLabel.valign;
    await refuses(
      () =>
        assertGraphTypography(
          collapsed as unknown as RenderDoc,
          rendered.state.provenance,
        ),
      "GRAPH_CONTENT_OVERFLOW",
    );
    doc.fonts = [{
      family: "GraphBuiltinAlias",
      asset: "builtin:fraunces-900",
      weight: "900",
    }];
    const label = doc.slides[0].elements.find((element) =>
      element.id === "a/paragraph:1"
    )!;
    label.w = 120;
    label.h = 220;
    label.fontSize = 52;
    label.fontWeight = 900;
    label.fontFamily = "GraphBuiltinAlias";
    const saved = await saveProject(source, doc, rendered.state.revision);
    await refuses(
      () => preflightGraphSync(saved, text, text),
      "GRAPH_CONTENT_OVERFLOW",
    );
    assert(await Deno.readTextFile(source) === text);
    assert(
      saved.overrides.some((override) =>
        override.target.elementId === "a/paragraph:1"
      ),
    );
    assert(
      saved.provenance[targetKey({ slideId: "s", elementId: "a/qb-node" })]
        .source?.graph,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the six-member bounds fit measured labels and unrelated crossings or paths through nodes refuse", async () => {
  const nodes = ["a", "b", "c", "d", "e", "f"];
  const make = (kind: "diagram" | "timeline", paths: [string, string][] = []) =>
    "## Límites {#limits}\n\n:::: {#bounded .bento-" + kind + "}\n\n" +
    nodes.map((id) =>
      "::: {#" + id + " .bento-" +
      (kind === "diagram" ? "node" : "milestone") + "}\n" +
      id.toUpperCase() + "\n:::\n"
    ).join("\n") + "\n" + paths.map(([from, to], i) =>
      "::: {#edge" + i + ' .bento-edge from="' + from + '" to="' + to +
      '"}\n:::\n'
    ).join("\n") + "\n::::\n";
  for (
    const text of [
      make("diagram", [["a", "c"], ["b", "d"], ["c", "e"], ["d", "f"]]),
      make("timeline"),
    ]
  ) {
    const original = scanSource(text), graph = sourceGraphs(original)[0];
    const projected = await projectGraph(
      original,
      await originalGraphNode(graph),
      base,
    );
    assert(
      projected.elements.filter((element) => element.type === "text").length ===
        6,
    );
    assert(
      projected.elements.every((element) =>
        Number(element.w) > 0 && Number(element.h) > 0
      ),
    );
  }
  const crossing = make("diagram", [
    ["a", "c"],
    ["a", "d"],
    ["b", "c"],
    ["b", "d"],
    ["c", "e"],
    ["d", "f"],
  ]);
  const original = scanSource(crossing), graph = sourceGraphs(original)[0];
  const node = await originalGraphNode(graph);
  await refuses(
    () => projectGraph(original, node, base),
    "GRAPH_TOPOLOGY_UNSUPPORTED",
  );
  const blockedText =
    "## Límites {#limits}\n\n:::: {#blocked .bento-diagram}\n\n" +
    [["a", 80], ["b", 600], ["c", 330], ["d", 850]].map(([id, x]) =>
      "::: {#" + id + ' .bento-node x="' + x +
      '" y="270" w="140" h="160"}\n' + id + "\n:::\n"
    ).join("\n") +
    '\n::: {#ab .bento-edge from="a" to="b"}\n:::\n\n::: {#cd .bento-edge from="c" to="d"}\n:::\n\n::::\n';
  const blockedSource = scanSource(blockedText),
    blocked = sourceGraphs(blockedSource)[0],
    blockedNode = await originalGraphNode(blocked);
  await refuses(
    () => projectGraph(blockedSource, blockedNode, base),
    "GRAPH_TOPOLOGY_UNSUPPORTED",
  );
});
