/** Source graph projection into the pinned native rect/text and anchored line model. */
import { canonical } from "../state/json.ts";
import {
  type GraphChild,
  graphEdgeId,
  graphFlowSignature,
  graphNodeId,
  type SourceGraph,
  sourceGraph,
  sourceGraphs,
  timelineLinkId,
} from "../source/graphs.ts";
import { type SourceDocument } from "../source/mod.ts";
import {
  type DesignDefaults,
  DesignError,
  designTheme,
  type Frame,
  type PandocAttr,
} from "./design.ts";
import { renderInline } from "./inline.ts";
import { measureNativeText, type NativeTextMeasurement } from "./measure.ts";
import type { Element, Json, Node, Origin, Projection } from "./types.ts";
import { graphReceipt } from "../state/graphs.ts";
import type { ProvenanceMap } from "../state/types.ts";

type Fields = NonNullable<Projection["design"]>[string];
export interface GraphProjection {
  elements: Element[];
  origins: Record<string, Origin>;
  fields: Fields;
  frame: Frame;
}
interface Point {
  x: number;
  y: number;
}
const geometry = ["x", "y", "w", "h"];
const textFields = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "align",
  "valign",
];
const shapeFields = ["fill", "stroke", "strokeWidth", "radius"];
function typographyFits(
  label: Element,
  measured: NativeTextMeasurement,
): boolean {
  const verticalOverhang = Math.max(
    measured.overhangTop,
    measured.overhangBottom,
  );
  return measured.height <= Number(label.h) + .01 &&
    measured.width <= Number(label.w) + 1 &&
    !(measured.lineCount > 1 && verticalOverhang > .1) &&
    !((label.valign ?? "top") === "top" && measured.overhangTop > .1) &&
    !((label.valign ?? "top") === "bottom" && measured.overhangBottom > .1);
}
function fail(code: string, message: string): never {
  throw new DesignError(code, message);
}
function exactAttr(actual: PandocAttr, expected: PandocAttr) {
  const normalize = (
    attr: PandocAttr,
  ) => [
    attr[0],
    [...attr[1]].sort(),
    [...attr[2]].sort((a, b) => a[0].localeCompare(b[0])),
  ];
  if (canonical(normalize(actual)) !== canonical(normalize(expected))) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Executed component attributes disagree with the exact original graph declaration.",
    );
  }
}
/** Original fragment reader only: no execution, package environment or Pandoc writer. */
export async function originalGraphNode(graph: SourceGraph): Promise<Node> {
  const child = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = child.output(), writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(graph.wrapper.raw));
  await writer.close();
  const result = await output;
  if (!result.success) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Pandoc could not verify the original graph fragment.",
    );
  }
  const ast = JSON.parse(new TextDecoder().decode(result.stdout));
  if (
    !Array.isArray(ast.blocks) || ast.blocks.length !== 1 ||
    ast.blocks[0].t !== "Div"
  ) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Original graph does not parse to its one declared div.",
    );
  }
  return ast.blocks[0];
}
function labels(node: Node, graph: SourceGraph): Map<string, string> {
  if (node.t !== "Div") {
    fail("UNMAPPED_GRAPH_SOURCE", "Graph projection needs a div.");
  }
  const [attr, children] = node.c as [PandocAttr, Node[]];
  exactAttr(attr, graph.attr);
  const sourceChildren = [...graph.nodes, ...graph.edges].sort((a, b) =>
    a.block.span.start - b.block.span.start
  );
  if (children.length !== sourceChildren.length) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Executed graph children differ from exact original membership.",
    );
  }
  const result = new Map<string, string>();
  children.forEach((child, i) => {
    if (child.t !== "Div") {
      fail(
        "UNMAPPED_GRAPH_SOURCE",
        "Graph membership must remain direct div children.",
      );
    }
    const [childAttr, body] = child.c as [PandocAttr, Node[]],
      original = sourceChildren[i];
    exactAttr(childAttr, original.attr);
    if (
      body.length !== (original.label ? 1 : 0) ||
      body.some((block) => block.t !== "Para")
    ) {
      fail(
        "GRAPH_LABEL_STRUCTURE",
        "Graph labels need their original one authored paragraph.",
      );
    }
    if (original.label) {
      result.set(original.block.id, renderInline(body[0].c as Node[]));
    }
  });
  return result;
}
function frameFor(graph: SourceGraph, base: Frame): Frame {
  const frame = { ...base };
  for (const field of geometry as (keyof Frame)[]) {
    if (graph.declaration.properties[field] !== undefined) {
      frame[field] = Number(graph.declaration.properties[field]);
    }
  }
  if (
    frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0 ||
    frame.x + frame.w > 1280 || frame.y + frame.h > 720
  ) {
    fail(
      "GRAPH_FRAME_OVERFLOW",
      "The graph frame must fit the 1280x720 canvas; use explicit source dimensions or a separate slide.",
    );
  }
  return frame;
}
function border(box: Frame, toward: Point): Point {
  // The same unrotated rectangle border ray used at pinned Bento geom.ts.
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const scale = Math.min(
    dx ? box.w / 2 / Math.abs(dx) : Infinity,
    dy ? box.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
const center = (box: Frame): Point => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});
function segmentHits(a: Point, b: Point, box: Frame): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const values = [[-dx, a.x - box.x], [dx, box.x + box.w - a.x], [
    -dy,
    a.y - box.y,
  ], [dy, box.y + box.h - a.y]];
  for (const [p, q] of values) {
    if (!p) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return false;
  }
  return true;
}
function overlap(a: Frame, b: Frame, margin = 0): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}
function within(box: Frame, frame: Frame) {
  return box.x >= frame.x - .01 && box.y >= frame.y - .01 &&
    box.x + box.w <= frame.x + frame.w + .01 &&
    box.y + box.h <= frame.y + frame.h + .01;
}
function metadata(
  source: SourceDocument,
  graph: SourceGraph,
  child: GraphChild | undefined,
  role: string,
  base: Frame,
  from?: string,
  to?: string,
): Json {
  return {
    version: 1,
    kind: graph.kind,
    componentId: graph.wrapper.id,
    role,
    sourceId: child?.block.id ?? graph.wrapper.id,
    nodeIds: graph.nodes.map((node) => node.block.id),
    base: { ...base },
    prefix: graphFlowSignature(source, graph),
    ...(child?.label ? { labelId: child.label.id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}
/** Native labels share the existing paragraph codec and IDs; shapes have reserved suffixes. */
export async function projectGraph(
  source: SourceDocument,
  node: Node,
  base: Frame,
  defaults: DesignDefaults = {},
): Promise<GraphProjection> {
  const attr = (node.c as [PandocAttr, Node[]])[0],
    graph = sourceGraph(source, attr[0]);
  const actualLabels = labels(node, graph),
    originalLabels = labels(await originalGraphNode(graph), graph);
  if (canonical([...actualLabels]) !== canonical([...originalLabels])) {
    fail(
      "UNMAPPED_GRAPH_LABEL",
      "Executed labels disagree with exact original authored paragraphs.",
    );
  }
  const frame = frameFor(graph, base), theme = designTheme(defaults);
  if (graph.declaration.properties.rotation !== undefined) {
    fail(
      "GRAPH_ROTATION_UNSUPPORTED",
      "Apply graph frame attributes without rotation; native rotations remain individual visual design.",
    );
  }
  const result: GraphProjection = {
    elements: [],
    origins: {},
    fields: {},
    frame,
  };
  const nodeBoxes = new Map<string, Frame>(), nodeLabels: Element[] = [];
  const padding = 18, gap = graph.kind === "timeline" ? 40 : 120;
  const columns = graph.layers.length;
  const slotWidth = (frame.w - (columns - 1) * gap) / columns;
  const defaultWidth = Math.min(
    graph.kind === "timeline" ? 280 : 300,
    slotWidth,
  );
  const maximumRows = Math.max(...graph.layers.map((layer) => layer.length));
  const defaultHeight = Math.min(
    160,
    (frame.h - (maximumRows - 1) * 48) / maximumRows,
  );
  if (defaultWidth <= 2 * padding + 36 || defaultHeight <= 2 * padding + 26) {
    fail(
      "GRAPH_CONTENT_OVERFLOW",
      "The final node slots are too small; no automatic text shrink is applied.",
    );
  }
  function own(
    element: Element,
    field: string,
    child?: GraphChild,
    binding = true,
  ) {
    const fields = result.fields[element.id] ??= {
      ownedPaths: [],
      bindings: {},
    };
    if (!fields.ownedPaths.includes(field)) fields.ownedPaths.push(field);
    if (child && binding) {
      fields.bindings[field] = {
        sourceId: child.block.id,
        attribute: child.declaration.bindings[field],
      };
    }
  }
  function style(
    element: Element,
    child: GraphChild,
    allowed: string[],
    direct = true,
  ) {
    for (const field of allowed) {
      const ownValue = child.declaration.properties[field],
        inherited = graph.declaration.properties[field];
      if (ownValue !== undefined) {
        element[field] = ownValue;
        own(element, field, child, direct);
      } else if (inherited !== undefined) {
        element[field] = inherited;
        own(element, field);
      }
    }
  }
  for (const [column, layer] of graph.layers.entries()) {
    for (const [row, id] of layer.entries()) {
      const child = graph.nodes.find((child) => child.block.id === id)!;
      if (child.declaration.properties.rotation !== undefined) {
        fail(
          "GRAPH_ROTATION_UNSUPPORTED",
          "Source node rotation needs a coupled shape/label adapter.",
        );
      }
      const box: Frame = {
        x: frame.x + column * (slotWidth + gap) +
          (slotWidth - defaultWidth) / 2,
        y: frame.y +
          (frame.h - layer.length * defaultHeight - (layer.length - 1) * 48) /
            2 +
          row * (defaultHeight + 48),
        w: defaultWidth,
        h: defaultHeight,
      };
      for (const field of geometry as (keyof Frame)[]) {
        if (child.declaration.properties[field] !== undefined) {
          box[field] = Number(child.declaration.properties[field]);
        }
      }
      if (
        !within(box, frame) || box.w <= padding * 2 + 36 ||
        box.h <= padding * 2 + 26 ||
        [...nodeBoxes.values()].some((other) => overlap(box, other, 12))
      ) {
        fail(
          "GRAPH_CONTENT_OVERFLOW",
          "Explicit node boxes must be readable, disjoint and contained by the graph frame.",
        );
      }
      nodeBoxes.set(id, box);
      const shape: Element = {
        id: graphNodeId(id),
        type: "shape",
        shape: "rect",
        ...box,
        rotation: 0,
        opacity: 1,
        fill: "#f1f7f8",
        stroke: theme.accent,
        strokeWidth: 2,
        radius: 14,
        groupId: id + "/qb-group",
      };
      style(shape, child, shapeFields);
      style(shape, child, ["opacity"], false);
      for (const field of geometry) {
        if (child.declaration.properties[field] !== undefined) {
          own(shape, field, child);
        } else if (
          geometry.some((field) =>
            graph.declaration.properties[field] !== undefined
          )
        ) own(shape, field);
      }
      const label: Element = {
        id: child.label!.id,
        type: "text",
        html: actualLabels.get(id)!,
        x: box.x + padding,
        y: box.y + padding,
        w: box.w - padding * 2,
        h: box.h - padding * 2,
        rotation: 0,
        opacity: 1,
        fontSize: graph.kind === "timeline" ? 22 : 24,
        fontFamily: theme.fontFamily,
        fontWeight: 600,
        lineHeight: 1.25,
        color: theme.color,
        align: "center",
        valign: "middle",
        groupId: shape.groupId,
      };
      style(label, child, textFields);
      style(label, child, ["opacity"], false);
      if (
        geometry.some((field) =>
          field in child.declaration.properties ||
          field in graph.declaration.properties
        )
      ) {
        for (const field of geometry) own(label, field);
      }
      result.elements.push(shape, label);
      result.origins[shape.id] = {
        origin: "authored",
        sourceId: child.block.id,
        graph: metadata(
          source,
          graph,
          child,
          graph.kind === "timeline" ? "milestone" : "node",
          base,
        ),
      };
      result.origins[label.id] = {
        origin: "authored",
        sourceId: child.label!.id,
      };
      nodeLabels.push(label);
    }
  }
  const links = graph.kind === "diagram"
    ? graph.edges.map((child) => ({ child, from: child.from, to: child.to }))
    : graph.nodes.slice(1).map((child, i) => ({
      child: undefined,
      from: graph.nodes[i].block.id,
      to: child.block.id,
    }));
  const segments: { a: Point; b: Point; from: string; to: string }[] = [],
    edgeLabels: Element[] = [];
  for (const link of links) {
    const fromBox = nodeBoxes.get(link.from)!, toBox = nodeBoxes.get(link.to)!;
    const a = border(fromBox, center(toBox)),
      b = border(toBox, center(fromBox));
    for (const [id, box] of nodeBoxes) {
      if (
        id !== link.from && id !== link.to &&
        segmentHits(a, b, {
          x: box.x - 8,
          y: box.y - 8,
          w: box.w + 16,
          h: box.h + 16,
        })
      ) {
        fail(
          "GRAPH_TOPOLOGY_UNSUPPORTED",
          "A straight source edge would traverse an unrelated node; use a topology with clear direct routing.",
        );
      }
    }
    for (const previous of segments) {
      const shared = [link.from, link.to].some((id) =>
        [previous.from, previous.to].includes(id)
      );
      if (shared) continue;
      if (
        Math.max(a.x, b.x) < Math.min(previous.a.x, previous.b.x) ||
        Math.max(previous.a.x, previous.b.x) < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) < Math.min(previous.a.y, previous.b.y) ||
        Math.max(previous.a.y, previous.b.y) < Math.min(a.y, b.y)
      ) continue;
      const orientation = (p: Point, q: Point, r: Point) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      if (
        orientation(a, b, previous.a) * orientation(a, b, previous.b) <= 0 &&
        orientation(previous.a, previous.b, a) *
              orientation(previous.a, previous.b, b) <= 0
      ) {
        fail(
          "GRAPH_TOPOLOGY_UNSUPPORTED",
          "Crossing unrelated direct edges need a separate faithful routing adapter.",
        );
      }
    }
    segments.push({ a, b, from: link.from, to: link.to });
    const length = Math.hypot(b.x - a.x, b.y - a.y),
      cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2;
    const connector: Element = {
      id: link.child
        ? graphEdgeId(link.child.block.id)
        : timelineLinkId(graph.wrapper.id, link.from, link.to),
      type: "shape",
      shape: "line",
      x: cx - length / 2,
      y: cy - 2,
      w: Math.max(1, length),
      h: 4,
      rotation: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
      opacity: 1,
      fill: theme.accent,
      strokeWidth: 3,
      lineEnd: "arrow",
      from: { el: graphNodeId(link.from), side: "auto" },
      to: { el: graphNodeId(link.to), side: "auto" },
    };
    const lineAllowed = ["fill", "strokeWidth", "opacity"];
    if (link.child) {
      if (
        Object.keys(link.child.declaration.properties).some((field) =>
          ![...lineAllowed, ...textFields].includes(field)
        )
      ) {
        fail(
          "GRAPH_EDGE_STYLE_UNSUPPORTED",
          "Edge attributes support line fill/stroke-width/opacity and label typography; native geometry and anchors are visual design.",
        );
      }
      style(connector, link.child, ["fill", "strokeWidth"]);
      style(connector, link.child, ["opacity"], !link.child.label);
    }
    own(connector, "from/el");
    own(connector, "to/el");
    own(connector, "shape");
    result.elements.unshift(connector);
    result.origins[connector.id] = {
      origin: "authored",
      sourceId: link.child?.block.id ?? graph.wrapper.id,
      graph: metadata(
        source,
        graph,
        link.child,
        link.child ? "edge" : "timeline-link",
        base,
        link.from,
        link.to,
      ),
    };
    if (link.child?.label) {
      const width = Math.min(160, Math.max(72, length - 28));
      const label: Element = {
        id: link.child.label.id,
        type: "text",
        html: actualLabels.get(link.child.block.id)!,
        x: cx - width / 2,
        y: cy - 75,
        w: width,
        h: 64,
        rotation: 0,
        opacity: 1,
        fontSize: 18,
        fontFamily: theme.fontFamily,
        fontWeight: 400,
        lineHeight: 1.25,
        color: theme.color,
        align: "center",
        valign: "middle",
      };
      style(label, link.child, textFields);
      style(label, link.child, ["opacity"], false);
      result.elements.push(label);
      result.origins[label.id] = {
        origin: "authored",
        sourceId: link.child.label.id,
      };
      edgeLabels.push(label);
    }
  }
  const allLabels = [...nodeLabels, ...edgeLabels],
    measurements = await measureNativeText(allLabels);
  allLabels.forEach((label, i) => {
    if (!typographyFits(label, measurements[i])) {
      fail(
        "GRAPH_CONTENT_OVERFLOW",
        "Actual native glyph metrics exceed the final label box for " +
          label.id +
          "; shorten the label or declare a larger source frame/font.",
      );
    }
  });
  edgeLabels.forEach((label, index) => {
    const height = measurements[nodeLabels.length + index].height;
    const previousY = Number(label.y);
    label.y = previousY + 64 - height;
    label.h = height;
    const box = label as Element & Frame;
    if (
      !within(box, frame) || [...nodeBoxes.values()].some((node) =>
        overlap(box, node, 4)
      ) ||
      edgeLabels.slice(0, index).some((other) =>
        overlap(box, other as Element & Frame, 4)
      )
    ) {
      fail(
        "GRAPH_EDGE_LABEL_OVERFLOW",
        "A measured edge label overlaps content or exits the graph frame; remove it or use shorter text.",
      );
    }
  });
  return result;
}

/** A semantic sync result must pass graph topology, literal-label and typography gates before source writes. */
export async function preflightGraphSource(
  source: SourceDocument,
  bases: ReadonlyMap<string, Frame> = new Map(),
  defaults: DesignDefaults = {},
): Promise<void> {
  for (const graph of sourceGraphs(source)) {
    await projectGraph(
      source,
      await originalGraphNode(graph),
      bases.get(graph.wrapper.id) ?? { x: 80, y: 166, w: 1120, h: 470 },
      defaults,
    );
  }
}
/** Revalidate final retained native typography, including saved offline font faces. */
export async function assertGraphTypography(
  document: import("./types.ts").BentoDoc,
  provenance: ProvenanceMap,
): Promise<void> {
  const labels: Element[] = [];
  for (const [key, source] of Object.entries(provenance)) {
    const graph = graphReceipt(source);
    if (!graph || typeof graph.labelId !== "string") continue;
    const [slideId] = JSON.parse(key) as [string];
    const label = document.slides.find((slide) => slide.id === slideId)
      ?.elements.find((element) => element.id === graph.labelId);
    if (label?.type === "text" && !labels.some((known) => known === label)) {
      labels.push(label);
    }
  }
  const measurements = await measureNativeText(labels, document);
  labels.forEach((label, i) => {
    if (!typographyFits(label, measurements[i])) {
      fail(
        "GRAPH_CONTENT_OVERFLOW",
        "Retained native typography clips source graph label " + label.id +
          "; enlarge its box or adjust the saved typography before publishing.",
      );
    }
  });
}
/** Closed provenance verification: this does not exempt arbitrary divs/shapes. */
export function validateGraphOrigin(
  source: SourceDocument,
  origin: Origin,
  element: Element,
  slideId: string,
): void {
  const proof = origin.graph;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    fail("UNMAPPED_GRAPH_PROVENANCE", "Missing graph provenance.");
  }
  const graph = sourceGraph(source, String(proof.componentId));
  if (
    proof.version !== 1 || proof.kind !== graph.kind ||
    proof.sourceId !== origin.sourceId ||
    graph.wrapper.slideId !== slideId ||
    proof.prefix !== graphFlowSignature(source, graph) ||
    origin.origin !== "authored" || Object.keys(proof).some((key) =>
      ![
        "version",
        "kind",
        "componentId",
        "role",
        "sourceId",
        "nodeIds",
        "base",
        "prefix",
        "labelId",
        "from",
        "to",
      ].includes(key)
    ) ||
    canonical(proof.nodeIds) !==
      canonical(graph.nodes.map((child) => child.block.id))
  ) {
    fail(
      "UNMAPPED_GRAPH_PROVENANCE",
      "Graph receipt disagrees with exact source membership, role or slide scope.",
    );
  }
  const base = proof.base as unknown as Frame;
  if (
    !base ||
    !geometry.every((field) =>
      Number.isFinite((base as unknown as Record<string, unknown>)[field])
    )
  ) {
    fail(
      "UNMAPPED_GRAPH_PROVENANCE",
      "Graph layout base is missing or malformed.",
    );
  }
  if (proof.role === "node" || proof.role === "milestone") {
    const child = graph.nodes.find((child) =>
      child.block.id === proof.sourceId
    );
    if (
      !child ||
      proof.role !== (graph.kind === "diagram" ? "node" : "milestone") ||
      proof.labelId !== child.label?.id || proof.from !== undefined ||
      proof.to !== undefined ||
      element.id !== graphNodeId(child.block.id) || element.type !== "shape" ||
      element.shape !== "rect"
    ) {
      fail(
        "UNMAPPED_GRAPH_PROVENANCE",
        "Native node shape lacks its exact original direct node proof.",
      );
    }
    return;
  }
  const edge = graph.edges.find((edge) => edge.block.id === proof.sourceId);
  const index = graph.nodes.findIndex((child) => child.block.id === proof.from);
  const from = graph.kind === "diagram"
    ? edge?.from
    : graph.nodes[index]?.block.id;
  const to = graph.kind === "diagram"
    ? edge?.to
    : graph.nodes[index + 1]?.block.id;
  const id = graph.kind === "diagram" && edge
    ? graphEdgeId(edge.block.id)
    : timelineLinkId(graph.wrapper.id, String(from), String(to));
  const expectedRole = graph.kind === "diagram" ? "edge" : "timeline-link";
  if (
    proof.role !== expectedRole || !from || !to || proof.from !== from ||
    proof.to !== to || element.id !== id ||
    proof.labelId !== edge?.label?.id ||
    (graph.kind === "timeline" && proof.sourceId !== graph.wrapper.id) ||
    element.type !== "shape" || element.shape !== "line" ||
    canonical(element.from) !==
      canonical({ el: graphNodeId(from), side: "auto" }) ||
    canonical(element.to) !== canonical({ el: graphNodeId(to), side: "auto" })
  ) {
    fail(
      "UNMAPPED_GRAPH_PROVENANCE",
      "Native connector lacks its exact original endpoint or derived timeline adjacency proof.",
    );
  }
}
