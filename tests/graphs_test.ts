import { fork, timeline } from "./helpers/graphs.ts";
import { scanSource } from "../src/source/mod.ts";
import {
  applyGraphEndpoints,
  graphEdgeId,
  graphFlowSignature,
  graphNodeId,
  previewGraphEndpoints,
  sourceGraphs,
  timelineLinkId,
} from "../src/source/graphs.ts";
import { assertSupportedExecutionSource } from "../src/render/project.ts";
import { assertGraphDocument } from "../src/state/graphs.ts";
import {
  captureEdits,
  compose,
  createState,
  targetKey,
} from "../src/state/mod.ts";
import type { BentoDoc, ProvenanceMap } from "../src/state/mod.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify({ actual, expected }),
  );
}
function refuses(fn: () => unknown, code: string) {
  try {
    fn();
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
Deno.test("original DAG and timeline source relationships are explicit, stable and bounded", () => {
  const doc = scanSource(fork + "\n" + timeline), graphs = sourceGraphs(doc);
  equal(graphs[0].layers, [["input"], ["left", "right"]]);
  equal(graphs[1].layers, [["start"], ["study"], ["report"]]);
  equal(graphs[0].nodes.map((node) => node.label?.id), [
    "input/paragraph:1",
    "left/paragraph:1",
    "right/paragraph:1",
  ]);
  equal([graphNodeId("input"), graphEdgeId("edge-a")], [
    "input/qb-node",
    "edge-a/qb-edge",
  ]);
  assert(
    timelineLinkId("story", "start", "study") !==
      timelineLinkId("story", "start", "report"),
  );
});
Deno.test("graph endpoint previews patch exact quoted UTF8 and CRLF spans and reject manipulated/stale plans", () => {
  const original = fork.replace("Entrada", "Éxito").replace(
    'from="input" to="left"',
    "from='input' to='left'",
  ).replaceAll("\n", "\r\n");
  const request = {
    componentId: "graph",
    edgeId: "edge-a",
    endpoint: "from" as const,
    expected: "input",
    nodeId: "right",
  };
  const plan = previewGraphEndpoints(scanSource(original), [request]);
  equal(
    plan.result,
    original.replace("from='input' to='left'", "from='right' to='left'"),
  );
  equal(plan.patches.map((patch) => patch.expected), ["input"]);
  equal(applyGraphEndpoints(original, plan), plan.result);
  refuses(() => applyGraphEndpoints(original + "\n", plan), "STALE_SOURCE");
  refuses(
    () => applyGraphEndpoints(original, { ...plan, result: original }),
    "INVALID_PLAN",
  );
  refuses(
    () =>
      previewGraphEndpoints(scanSource(original), [{
        ...request,
        expected: "left",
      }]),
    "SOURCE_CONFLICT",
  );
  refuses(
    () =>
      previewGraphEndpoints(scanSource(original), [{
        ...request,
        nodeId: "outside",
      }]),
    "GRAPH_ENDPOINT_SCOPE",
  );
});
Deno.test("source graph preflight refuses dynamic labels, wrong scope, duplicate IDs and inadmissible topology", () => {
  refuses(
    () =>
      assertSupportedExecutionSource(
        scanSource(
          fork.replace(
            "Entrada",
            "Resultado " + String.fromCharCode(96) + "r 1+1" +
              String.fromCharCode(96),
          ),
        ),
      ),
    "COMPUTED_GRAPH_LABEL",
  );
  refuses(
    () => sourceGraphs(scanSource(fork.replace('to="left"', 'to="foreign"'))),
    "GRAPH_ENDPOINT_SCOPE",
  );
  refuses(
    () =>
      sourceGraphs(
        scanSource(fork.replace("#right .bento-node", "#left .bento-node")),
      ),
    "UNMAPPED_GRAPH_SOURCE",
  );
  refuses(
    () =>
      sourceGraphs(scanSource(fork.replace(".bento-node", ".bento-milestone"))),
    "GRAPH_CHILD_STRUCTURE",
  );
  refuses(
    () =>
      sourceGraphs(
        scanSource(
          fork.replace('from="input" to="left"', 'from="right" to="input"'),
        ),
      ),
    "GRAPH_TOPOLOGY_UNSUPPORTED",
  );
  refuses(
    () =>
      sourceGraphs(
        scanSource(
          fork.replace('from="input" to="left"', 'from="input" to="right"'),
        ),
      ),
    "GRAPH_DUPLICATE_EDGE",
  );
  refuses(
    () =>
      previewGraphEndpoints(scanSource(fork), [{
        componentId: "graph",
        edgeId: "edge-a",
        endpoint: "to",
        expected: "left",
        nodeId: "right",
      }]),
    "GRAPH_DUPLICATE_EDGE",
  );
  const injected = fork + "\n::: {#orphan .bento-node}\nFuera\n:::\n";
  refuses(() => sourceGraphs(scanSource(injected)), "GRAPH_CHILD_SCOPE");
  const plain = scanSource(
    fork.replace(":::: {#graph", "Text.\n\n:::: {#graph"),
  );
  const media = scanSource(
    fork.replace(":::: {#graph", "![plot](plot.svg)\n\n:::: {#graph"),
  );
  assert(
    graphFlowSignature(plain, sourceGraphs(plain)[0]) !==
      graphFlowSignature(media, sourceGraphs(media)[0]),
  );
});
function graphState(kind = "diagram") {
  const nodeIds = ["a", "b", "c"], componentId = "graph";
  const graph = {
    version: 1,
    kind,
    componentId,
    nodeIds,
    base: { x: 80, y: 166, w: 1120, h: 470 },
  };
  const nodes = nodeIds.flatMap((id) => [
    { id: id + "/qb-node", type: "shape", shape: "rect", x: 1, fill: "#fff" },
    { id: id + "/paragraph:1", type: "text", html: id },
  ]);
  const edge = {
    id: "e/qb-edge",
    type: "shape",
    shape: "line",
    from: { el: "a/qb-node", side: "auto" },
    to: { el: "b/qb-node", side: "auto" },
  };
  const doc = {
    docId: "test",
    slides: [{ id: "slide", elements: [...nodes, edge] }],
  } as unknown as BentoDoc;
  const provenance: ProvenanceMap = {};
  for (const id of nodeIds) {
    provenance[targetKey({ slideId: "slide", elementId: id + "/qb-node" })] = {
      origin: "authored",
      source: {
        graph: {
          ...graph,
          sourceId: id,
          role: kind === "timeline" ? "milestone" : "node",
          labelId: id + "/paragraph:1",
        },
      },
    };
  }
  provenance[targetKey({ slideId: "slide", elementId: edge.id })] = {
    origin: "authored",
    source: {
      graph: {
        ...graph,
        sourceId: "e",
        role: kind === "timeline" ? "timeline-link" : "edge",
        from: "a",
        to: "b",
      },
    },
  };
  return createState(doc, provenance, {
    [targetKey({ slideId: "slide", elementId: edge.id })]: [
      "from/el",
      "to/el",
      "shape",
    ],
  });
}
Deno.test("source endpoints are pending, side anchors and arbitrary decorative connectors stay visual", () => {
  const original = graphState(), edited = structuredClone(original.emitted);
  const edge = edited.slides[0].elements.at(-1)!;
  edge.to = { el: "c/qb-node", side: "top" };
  const captured = captureEdits(original, edited);
  equal(captured.pending.map((change) => change.path), [["to", "el"]]);
  assert(
    captured.overrides.some((override) =>
      override.fields.some((field) =>
        JSON.stringify(field.path) === '["to","side"]'
      )
    ),
  );
  const detached = structuredClone(original.emitted);
  delete detached.slides[0].elements.at(-1)!.from;
  const removed = captureEdits(original, detached);
  equal(removed.pending.map((change) => change.path), [["from"]]);
  assert(
    !removed.overrides.some((override) =>
      override.fields.some((field) => field.path[0] === "from")
    ),
  );
  const decorative = structuredClone(original.emitted);
  decorative.slides[0].elements.push({
    id: "decoration",
    type: "shape",
    shape: "line",
    from: { el: "a/qb-node" },
    to: { el: "c/qb-node" },
  });
  const saved = captureEdits(original, decorative);
  equal(saved.pending.length, 0);
  equal(saved.bentoOnly[0].element.id, "decoration");
});
Deno.test("capture preserves graph deletion/type changes while strict composition blocks unfaithful publication", () => {
  for (const action of ["delete", "shape", "label-type", "node-type"]) {
    const original = graphState(), edited = structuredClone(original.emitted);
    if (action === "delete") {
      edited.slides[0].elements = edited.slides[0].elements.filter((element) =>
        element.id !== "a/qb-node"
      );
    }
    if (action === "shape") edited.slides[0].elements.at(-1)!.shape = "rect";
    if (action === "label-type") {
      edited.slides[0].elements.find((element) =>
        element.id === "a/paragraph:1"
      )!.type = "shape";
    }
    if (action === "node-type") {
      edited.slides[0].elements.find((element) => element.id === "a/qb-node")!
        .type = "text";
    }
    const captured = captureEdits(original, edited);
    assert(captured.pending.length > 0);
    refuses(
      () => compose(captured, original.generatedBaseline),
      action === "delete"
        ? "GRAPH_PENDING_DELETION"
        : "GRAPH_PENDING_STRUCTURE",
    );
  }
  const original = graphState("timeline"),
    edited = structuredClone(original.emitted);
  edited.slides[0].elements.at(-1)!.to = { el: "c/qb-node" };
  const captured = captureEdits(original, edited);
  equal(captured.pending[0].path, ["to", "el"]);
  refuses(
    () => compose(captured, original.generatedBaseline),
    "UNSUPPORTED_TIMELINE_RELATION",
  );
});
Deno.test("source graph endpoints reject foreign labels and dangling references at capture/compose", () => {
  const state = graphState();
  for (const id of ["a/paragraph:1", "foreign/qb-node"]) {
    const edited = structuredClone(state.emitted);
    edited.slides[0].elements.at(-1)!.to = { el: id };
    refuses(() => captureEdits(state, edited), "GRAPH_ENDPOINT_SCOPE");
  }
  const edited = structuredClone(state.emitted);
  edited.slides[0].elements = edited.slides[0].elements.filter((element) =>
    element.id !== "c/qb-node"
  );
  edited.slides[0].elements.at(-1)!.to = { el: "c/qb-node" };
  refuses(
    () =>
      assertGraphDocument(edited, state.provenance, {
        capture: true,
        baseline: state.emitted,
      }),
    "GRAPH_DANGLING_ENDPOINT",
  );
});
