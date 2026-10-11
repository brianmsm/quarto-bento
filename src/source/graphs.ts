/** Bounded original-source graph contracts; relationships never derive from positions. */
import {
  hashSource,
  scanSource,
  sliceBytes,
  type SourceBlock,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import {
  type DesignDeclaration,
  type PandocAttr,
  parseDesignAttributes,
} from "../render/design.ts";
import { canonical } from "../state/json.ts";
import { isNativeIdentity } from "./identity-id.ts";

export type GraphKind = "diagram" | "timeline";
export interface GraphChild {
  block: SourceBlock;
  attr: PandocAttr;
  declaration: DesignDeclaration;
  label?: SourceBlock;
}
export interface SourceGraph {
  kind: GraphKind;
  wrapper: SourceBlock;
  attr: PandocAttr;
  declaration: DesignDeclaration;
  nodes: GraphChild[];
  edges: (GraphChild & { from: string; to: string })[];
  /** Lexical milestone order or deterministic topological columns. */
  layers: string[][];
}
interface AttributeToken {
  raw: string;
  start: number;
  key?: string;
  value?: string;
  valueStart?: number;
  valueEnd?: number;
}
function fail(code: string, message: string): never {
  throw new SourceError(code, message);
}
function opener(block: SourceBlock) {
  const line = block.raw.split(/\r?\n/)[0];
  const match = /^ {0,3}:{3,}\s*\{([^{}]*)\}[ \t]*$/.exec(line);
  if (!match) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Use a literal identified fenced-div opener.",
    );
  }
  const content = match[1], contentStart = line.indexOf("{") + 1;
  const tokens: AttributeToken[] = [];
  const pattern = /(?:[^\s"']|"[^"]*"|'[^']*')+/g;
  for (const match of content.matchAll(pattern)) {
    const raw = match[0], start = match.index!;
    if (/^[#.][A-Za-z][\w:.-]*$/.test(raw)) {
      tokens.push({ raw, start });
      continue;
    }
    const pair =
      /^([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'\\]+))$/
        .exec(raw);
    if (!pair) {
      fail(
        "UNMAPPED_GRAPH_SOURCE",
        "Graph attributes require literal key=value syntax without escapes.",
      );
    }
    const key = pair[1], value = pair[2] ?? pair[3] ?? pair[4];
    const valueStart = start + key.length + 1 + (pair[4] === undefined ? 1 : 0);
    tokens.push({
      raw,
      start,
      key,
      value,
      valueStart,
      valueEnd: valueStart + value.length,
    });
  }
  const attr: PandocAttr = ["", [], []];
  for (const token of tokens) {
    if (token.key) attr[2].push([token.key, token.value!]);
    else if (token.raw[0] === "#") {
      if (attr[0]) {
        fail(
          "UNMAPPED_GRAPH_SOURCE",
          "Graph declarations need one explicit identity.",
        );
      }
      attr[0] = token.raw.slice(1);
    } else attr[1].push(token.raw.slice(1));
  }
  return { line, contentStart, tokens, attr };
}
export function sourceGraphAttributes(block: SourceBlock): PandocAttr {
  return opener(block).attr;
}
function role(block: SourceBlock): string | undefined {
  // Read class tokens only; a value containing '.bento-diagram' is not intent.
  const line = block.raw.split(/\r?\n/)[0];
  const content = /\{([^{}]*)\}[ \t]*$/.exec(line)?.[1];
  return (content?.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [])
    .find((token) =>
      /^\.bento-(diagram|timeline|node|edge|milestone)$/.test(token)
    )?.slice(7);
}
function graphFrom(
  original: SourceDocument,
  wrapper: SourceBlock,
): SourceGraph {
  const attr = sourceGraphAttributes(wrapper),
    declaration = parseDesignAttributes(attr);
  if (
    !wrapper.explicitId || !wrapper.stable || attr[0] !== wrapper.id ||
    wrapper.parentId || !wrapper.slideId ||
    !["diagram", "timeline"].includes(declaration.component ?? "")
  ) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Graphs need an original top-level identified .bento-diagram or .bento-timeline under a slide.",
    );
  }
  const kind = declaration.component as GraphKind;
  if (original.diagnostics.length) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Resolve original source structure and duplicate identities before projecting graphs.",
    );
  }
  const nodes: GraphChild[] = [], edges: SourceGraph["edges"] = [];
  const children = original.blocks.filter((block) =>
    block.parentId === wrapper.id
  );
  for (const block of children) {
    if (block.kind !== "div" || !block.explicitId || !block.stable) {
      fail(
        "GRAPH_CHILD_STRUCTURE",
        "Every direct graph child must be an identified node, edge or milestone div.",
      );
    }
    const childAttr = sourceGraphAttributes(block),
      childDeclaration = parseDesignAttributes(childAttr);
    const expected = kind === "timeline" ? ["milestone"] : ["node", "edge"];
    if (
      !expected.includes(childDeclaration.component ?? "") ||
      childAttr[0] !== block.id
    ) {
      fail(
        "GRAPH_CHILD_STRUCTURE",
        "Direct child roles must match their original graph component.",
      );
    }
    const labels = original.blocks.filter((candidate) =>
      candidate.parentId === block.id
    );
    const edge = childDeclaration.component === "edge";
    if (
      (!edge && labels.length !== 1) || (edge && labels.length > 1) ||
      labels.some((label) =>
        label.kind !== "paragraph" || !label.editable ||
        label.origin !== "authored" || label.id !== block.id + "/paragraph:1"
      )
    ) {
      fail(
        labels.some((label) =>
            label.origin === "computed" || label.kind === "chunk"
          )
          ? "COMPUTED_GRAPH_LABEL"
          : "GRAPH_LABEL_STRUCTURE",
        "Nodes and milestones require one literal authored paragraph; edges allow zero or one. Executable/dynamic labels are outside this adapter.",
      );
    }
    const child: GraphChild = {
      block,
      attr: childAttr,
      declaration: childDeclaration,
      ...(labels[0] ? { label: labels[0] } : {}),
    };
    if (edge) {
      const from = childAttr[2].find(([key]) => key === "from")?.[1];
      const to = childAttr[2].find(([key]) => key === "to")?.[1];
      if (!from || !to) {
        fail(
          "GRAPH_ENDPOINT_REQUIRED",
          "Each diagram edge needs literal from and to source node IDs.",
        );
      }
      edges.push({ ...child, from, to });
    } else nodes.push(child);
  }
  if (
    nodes.length < 2 || nodes.length > 6 || edges.length > 8 ||
    (kind === "diagram" && !edges.length)
  ) {
    fail(
      "GRAPH_ARITY",
      "This adapter supports 2..6 nodes/milestones and diagram edges 1..8.",
    );
  }
  const nodeIds = nodes.map((child) => child.block.id),
    pairs = new Set<string>();
  for (const edge of edges) {
    if (
      !nodeIds.includes(edge.from) || !nodeIds.includes(edge.to) ||
      edge.from === edge.to
    ) {
      fail(
        "GRAPH_ENDPOINT_SCOPE",
        "Diagram endpoints must identify distinct direct nodes in the same original component.",
      );
    }
    const pair = canonical([edge.from, edge.to]);
    if (pairs.has(pair)) {
      fail(
        "GRAPH_DUPLICATE_EDGE",
        "Parallel edges need a separate faithful routing adapter.",
      );
    }
    pairs.add(pair);
  }
  const layers: string[][] = [];
  if (kind === "timeline") {
    // Lexical source order is semantic; native stacking and positions are visual.
    layers.push(...nodeIds.map((id) => [id]));
  } else {
    const remaining = new Set(nodeIds), depth = new Map<string, number>();
    while (remaining.size) {
      const ready = nodeIds.filter((id) =>
        remaining.has(id) &&
        edges.filter((edge) => edge.to === id).every((edge) =>
          depth.has(edge.from)
        )
      );
      if (!ready.length) {
        fail(
          "GRAPH_TOPOLOGY_UNSUPPORTED",
          "Cycles require another adapter; this slice supports small directed acyclic graphs.",
        );
      }
      for (const id of ready) {
        const incoming = edges.filter((edge) => edge.to === id);
        const level = incoming.length
          ? Math.max(...incoming.map((edge) => depth.get(edge.from)!)) + 1
          : 0;
        (layers[level] ??= []).push(id);
        depth.set(id, level);
        remaining.delete(id);
      }
    }
    if (layers.length > 3 || layers.some((layer) => layer.length > 2)) {
      fail(
        "GRAPH_TOPOLOGY_UNSUPPORTED",
        "Use at most three topological columns and two nodes per column; enlarge a different adapter instead of shrinking this graph.",
      );
    }
  }
  return { kind, wrapper, attr, declaration, nodes, edges, layers };
}
export function sourceGraphs(document: SourceDocument): SourceGraph[] {
  if (hashSource(document.text) !== document.hash) {
    fail("stale-document", "Graph source snapshot changed.");
  }
  const original = scanSource(document.text);
  const wrappers = original.blocks.filter((block) =>
    block.kind === "div" && ["diagram", "timeline"].includes(role(block) ?? "")
  );
  const graphs = wrappers.map((wrapper) => graphFrom(original, wrapper));
  const claimed = new Set(
    graphs.flatMap((graph) => [
      graph.wrapper.id,
      ...graph.nodes.map((node) => node.block.id),
      ...graph.edges.map((edge) => edge.block.id),
    ]),
  );
  if (
    original.blocks.some((block) =>
      block.kind === "div" && role(block) && !claimed.has(block.id)
    )
  ) {
    fail(
      "GRAPH_CHILD_SCOPE",
      "Graph node/edge/milestone roles belong only to their matching direct original graph component.",
    );
  }
  return graphs;
}
export function sourceGraph(
  document: SourceDocument,
  componentId: string,
): SourceGraph {
  const matches = sourceGraphs(document).filter((graph) =>
    graph.wrapper.id === componentId
  );
  if (matches.length !== 1) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Graph identity does not identify one original component.",
    );
  }
  return matches[0];
}
/** Flow-sensitive source signature excludes paragraph text and optional slide traces. */
export function graphFlowSignature(
  document: SourceDocument,
  graph: SourceGraph,
): string {
  const profile = (block: SourceBlock): unknown => {
    if (block.kind === "paragraph") {
      if (
        block.origin === "computed" || /!\[|!\s*<|\$\$|\\\[/.test(block.content)
      ) {
        return ["media-or-dynamic-paragraph", hashSource(block.content)];
      }
      return ["paragraph", 110];
    }
    if (block.kind === "math") {
      return [
        "math",
        Math.min(
          330,
          Math.max(110, (block.content.trim().split(/\r?\n/).length + 1) * 44),
        ) + 20,
      ];
    }
    if (block.kind === "code") {
      return [
        "code",
        Math.min(
          470,
          Math.max(
            90,
            (block.content.replace(/\r?\n$/, "").split(/\r?\n/).length + 1) *
              30,
          ),
        ) + 20,
      ];
    }
    if (block.kind === "heading" && block.level === 2) return ["slide"];
    if (block.kind === "div") {
      const attr = sourceGraphAttributes(block);
      const children = document.blocks.filter((child) =>
        child.parentId === block.id
      );
      const child = children[0];
      // Reviewed paragraph identity acquisition adds no visual layout. Keep its
      // exact native flow equivalent without trusting arbitrary container syntax.
      if (
        !block.parentId && block.explicitId === block.id &&
        !attr[1].length && attr[2].length === 1 &&
        attr[2][0][0] === "bento-element-id" &&
        isNativeIdentity(attr[2][0][1]) && children.length === 1 &&
        child.kind === "paragraph" && child.origin === "authored" &&
        !/!\[|!\s*<|\$\$|\\\[/.test(child.content) &&
        !sliceBytes(document.text, {
          start: block.contentSpan.start,
          end: child.span.start,
        }).trim() &&
        !sliceBytes(document.text, {
          start: child.span.end,
          end: block.contentSpan.end,
        }).trim()
      ) return profile(child);
      if (attr[1].includes("notes")) return ["notes"];
      if (
        attr[1].includes("bento-diagram") || attr[1].includes("bento-timeline")
      ) {
        return [
          "graph",
          attr[2].filter(([key]) => ["x", "y", "w", "h"].includes(key)),
        ];
      }
      if (!attr[1].some((name) => name.startsWith("bento-"))) {
        return [
          "div",
          attr,
          children.map(profile),
        ];
      }
    }
    return [block.kind, hashSource(block.raw)];
  };
  return hashSource(
    canonical(
      document.blocks.filter((block) =>
        block.slideId === graph.wrapper.slideId && !block.parentId &&
        block.span.start < graph.wrapper.span.start
      ).map(profile),
    ),
  );
}
export const graphNodeId = (id: string) => id + "/qb-node";
export const graphEdgeId = (id: string) => id + "/qb-edge";
export const timelineLinkId = (componentId: string, from: string, to: string) =>
  componentId + "/qb-link-" + hashSource(canonical([from, to])).slice(0, 24);

export interface GraphEndpointRequest {
  componentId: string;
  edgeId: string;
  endpoint: "from" | "to";
  expected: string;
  nodeId: string;
}
export interface GraphEndpointPreview {
  version: 1;
  kind: "graph-endpoints";
  sourceHash: string;
  requests: GraphEndpointRequest[];
  patches: SourcePatch[];
  result: string;
  resultHash: string;
}
/** Only exact endpoint value spans are changed, never a Pandoc writer's document. */
export function previewGraphEndpoints(
  document: SourceDocument,
  requests: GraphEndpointRequest[],
): GraphEndpointPreview {
  const patches: SourcePatch[] = [], seen = new Set<string>();
  for (const request of requests) {
    const key = canonical([request.edgeId, request.endpoint]);
    if (seen.has(key)) {
      fail("GRAPH_DUPLICATE_PATCH", "Choose each edge endpoint once.");
    }
    seen.add(key);
    const graph = sourceGraph(document, request.componentId);
    const edge = graph.edges.find((edge) => edge.block.id === request.edgeId);
    if (
      graph.kind !== "diagram" || !edge ||
      !["from", "to"].includes(request.endpoint) ||
      !graph.nodes.some((node) => node.block.id === request.nodeId)
    ) {
      fail(
        "GRAPH_ENDPOINT_SCOPE",
        "Endpoint patches need an original edge and a direct node of the same diagram.",
      );
    }
    if (edge[request.endpoint] !== request.expected) {
      fail(
        "SOURCE_CONFLICT",
        "QMD independently changed this graph endpoint; compare and resolve before syncing.",
      );
    }
    const header = opener(edge.block);
    const matches = header.tokens.filter((token) =>
      token.key === request.endpoint
    );
    if (matches.length !== 1) {
      fail(
        "UNMAPPED_GRAPH_SOURCE",
        "Endpoint has no unique exact original value span.",
      );
    }
    const token = matches[0],
      bytes = (value: string) => new TextEncoder().encode(value).length;
    patches.push({
      blockId: request.edgeId,
      span: {
        start: edge.block.span.start +
          bytes(header.line.slice(0, header.contentStart + token.valueStart!)),
        end: edge.block.span.start +
          bytes(header.line.slice(0, header.contentStart + token.valueEnd!)),
      },
      expected: request.expected,
      replacement: request.nodeId,
    });
  }
  let result = document.text;
  for (
    const patch of [...patches].sort((a, b) => b.span.start - a.span.start)
  ) {
    if (sliceBytes(result, patch.span) !== patch.expected) {
      fail(
        "stale-fragment",
        patch.blockId,
      );
    }
    const encoded = new TextEncoder().encode(result);
    result = new TextDecoder("utf-8", { fatal: true }).decode(
      encoded.slice(0, patch.span.start),
    ) +
      patch.replacement +
      new TextDecoder("utf-8", { fatal: true }).decode(
        encoded.slice(patch.span.end),
      );
  }
  // Topology/membership validation happens before a review can approve source writes.
  sourceGraphs(scanSource(result));
  return {
    version: 1,
    kind: "graph-endpoints",
    sourceHash: document.hash,
    requests: structuredClone(requests),
    patches,
    result,
    resultHash: hashSource(result),
  };
}
export function applyGraphEndpoints(
  text: string,
  plan: GraphEndpointPreview,
): string {
  if (hashSource(text) !== plan.sourceHash) {
    fail("STALE_SOURCE", "QMD changed since the graph endpoint review.");
  }
  const verified = previewGraphEndpoints(scanSource(text), plan.requests);
  if (canonical(verified) !== canonical(plan)) {
    fail(
      "INVALID_PLAN",
      "Graph endpoint plan was altered or no longer reproduces its exact source result.",
    );
  }
  return verified.result;
}
