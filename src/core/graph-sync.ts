/** Source-specific relationship synchronization and prospective measured graph gates. */
import { canonical, entity, get, set, targetKey } from "../state/json.ts";
import { graphReceipt, graphRelationshipPath } from "../state/graphs.ts";
import {
  type Change,
  type JsonObject,
  type ProjectState,
  StateError,
} from "../state/types.ts";
import {
  type GraphEndpointRequest,
  graphFlowSignature,
  graphNodeId,
  sourceGraph,
  sourceGraphs,
} from "../source/graphs.ts";
import { scanSource } from "../source/mod.ts";
import { type Frame } from "../render/design.ts";
import {
  assertGraphTypography,
  originalGraphNode,
  projectGraph,
} from "../render/graphs.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";

function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
/** Neither native group IDs nor generic connector objects establish semantic membership. */
export function graphSyncRequest(
  text: string,
  state: ProjectState,
  change: Change,
): GraphEndpointRequest | undefined {
  const source = state.provenance[targetKey(change.target)];
  if (!graphRelationshipPath(source, change.path)) return undefined;
  const proof = graphReceipt(source)!;
  if (proof.role === "timeline-link") {
    fail(
      "UNSUPPORTED_TIMELINE_RELATION",
      "Timeline relationships derive from lexical QMD order. Restore native endpoints or reorder the original milestone blocks.",
    );
  }
  if (
    proof.role !== "edge" || proof.kind !== "diagram" ||
    change.origin !== "authored" ||
    change.target.elementId !== proof.sourceId + "/qb-edge" ||
    !change.target.slideId
  ) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "Relationship edits require the original source diagram edge receipt.",
    );
  }
  const endpoint = change.path[0] as "from" | "to";
  let nativeId: unknown = change.after.value;
  if (
    change.path.length === 1 && nativeId && typeof nativeId === "object" &&
    !Array.isArray(nativeId)
  ) nativeId = (nativeId as JsonObject).el;
  if (!change.after.present || typeof nativeId !== "string") {
    fail(
      "GRAPH_ENDPOINT_REQUIRED",
      "A source edge endpoint needs an explicit node; removing/detaching endpoints cannot rewrite a faithful source edge.",
    );
  }
  const saved = get(entity(state.emitted, change.target), [endpoint, "el"]);
  if (!saved.present || saved.value !== nativeId) {
    fail(
      "GRAPH_RELATION_SNAPSHOT",
      "The pending relationship no longer matches the saved native connector. Reopen Relations or compare with QMD before approving a source patch; all edits remain saved.",
    );
  }
  const doc = scanSource(text), graph = sourceGraph(doc, proof.componentId);
  if (
    graph.wrapper.slideId !== change.target.slideId ||
    canonical(graph.nodes.map((node) => node.block.id).sort()) !==
      canonical([...proof.nodeIds].sort())
  ) {
    fail(
      "SOURCE_CONFLICT",
      "The original graph membership or slide scope changed; render and review the graph before synchronizing relationships.",
    );
  }
  const edge = graph.edges.find((edge) => edge.block.id === proof.sourceId);
  const expected = proof[endpoint];
  if (!edge || typeof expected !== "string" || edge[endpoint] !== expected) {
    fail(
      "SOURCE_CONFLICT",
      "QMD independently changed this source edge endpoint; compare and resolve before synchronization.",
    );
  }
  const node = graph.nodes.find((node) =>
    graphNodeId(node.block.id) === nativeId
  );
  const nativeProof = node &&
    graphReceipt(
      state
        .provenance[
          targetKey({ slideId: change.target.slideId, elementId: nativeId })
        ],
    );
  if (
    !node || nativeProof?.role !== "node" ||
    nativeProof.componentId !== proof.componentId ||
    nativeProof.sourceId !== node.block.id ||
    !state.emitted.slides.find((slide) => slide.id === change.target.slideId)
      ?.elements.some((element) => element.id === nativeId)
  ) {
    fail(
      "GRAPH_ENDPOINT_SCOPE",
      "Choose an existing direct native source node shape from the same diagram.",
    );
  }
  const baseline = get(entity(state.generatedBaseline, change.target), [
    endpoint,
    "el",
  ]);
  if (!baseline.present || baseline.value !== graphNodeId(expected)) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "The saved source edge receipt no longer agrees with its generated endpoint baseline.",
    );
  }
  return {
    componentId: proof.componentId,
    edgeId: proof.sourceId,
    endpoint,
    expected,
    nodeId: node.block.id,
  };
}
function checkedBase(proof: JsonObject): Frame {
  const value = proof.base;
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    !["x", "y", "w", "h"].every((key) =>
      typeof value[key] === "number" && Number.isFinite(value[key])
    )
  ) {
    fail(
      "UNMAPPED_GRAPH_SOURCE",
      "A graph requires its fresh executed automatic-layout base.",
    );
  }
  return value as unknown as Frame;
}
/** Combined proposed QMD plus retained native design, before a review can approve any writes. */
export async function preflightGraphSync(
  state: ProjectState,
  current: string,
  result: string,
): Promise<void> {
  const currentDoc = scanSource(current), prospective = scanSource(result);
  const theme = state.generatedBaseline.theme as RenderDoc["theme"];
  for (const graph of sourceGraphs(prospective)) {
    const receipts = Object.values(state.provenance).map(graphReceipt).filter((
      proof,
    ) => proof?.componentId === graph.wrapper.id);
    const proof = receipts[0];
    if (!proof) {
      fail(
        "UNMAPPED_GRAPH_SOURCE",
        "Prospective graphs require an existing fresh source graph receipt; author and render new components first.",
      );
    }
    const original = sourceGraph(currentDoc, graph.wrapper.id);
    const explicitFrame = original.declaration.properties.y !== undefined &&
      original.declaration.properties.h !== undefined &&
      graph.declaration.properties.y !== undefined &&
      graph.declaration.properties.h !== undefined;
    if (
      !explicitFrame &&
      (proof.prefix !== graphFlowSignature(currentDoc, original) ||
        proof.prefix !== graphFlowSignature(prospective, graph))
    ) {
      fail(
        "GRAPH_FLOW_PREFLIGHT",
        "A source change alters the unverified automatic flow before this graph. Declare source y and h for an independent frame, or restore/review the preceding structure before applying this combined sync.",
      );
    }
    const projected = await projectGraph(
      prospective,
      await originalGraphNode(graph),
      checkedBase(proof),
      { theme },
    );
    // Validate actual retained geometry/typography too. Semantic pending fields
    // are applied by the chosen prospective source, never frozen as overrides.
    for (const element of projected.elements) {
      const overlay = state.overrides.find((overlay) =>
        overlay.target.slideId === graph.wrapper.slideId &&
        overlay.target.elementId === element.id
      );
      for (const field of overlay?.fields ?? []) {
        const target = element as unknown as JsonObject;
        set(target, field.path, field.value);
      }
    }
    const document = {
      ...state.emitted,
      slides: [{ id: graph.wrapper.slideId!, elements: projected.elements }],
    };
    const provenance = Object.fromEntries(
      Object.entries(projected.origins).map(([elementId, origin]) => [
        targetKey({ slideId: graph.wrapper.slideId, elementId }),
        {
          origin: origin.origin,
          source: {
            ...(origin.graph ? { graph: origin.graph as JsonObject } : {}),
          },
        },
      ]),
    );
    await assertGraphTypography(document as unknown as RenderDoc, provenance);
  }
}
