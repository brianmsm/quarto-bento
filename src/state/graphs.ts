/** Checked relationships for source graphs only; ordinary decorations remain visual. */
import {
  type BentoDoc,
  type Change,
  type JsonObject,
  type Provenance,
  type ProvenanceMap,
  StateError,
} from "./types.ts";

export interface GraphReceipt extends JsonObject {
  version: 1;
  kind: "diagram" | "timeline";
  componentId: string;
  sourceId: string;
  role: "node" | "milestone" | "edge" | "timeline-link";
  nodeIds: string[];
}
export function graphReceipt(
  provenance?: Provenance,
): GraphReceipt | undefined {
  const graph = provenance?.source?.graph;
  if (graph === undefined) return undefined;
  if (
    !graph || typeof graph !== "object" || Array.isArray(graph) ||
    graph.version !== 1 ||
    !["diagram", "timeline"].includes(String(graph.kind)) ||
    typeof graph.componentId !== "string" ||
    typeof graph.sourceId !== "string" ||
    !["node", "milestone", "edge", "timeline-link"].includes(
      String(graph.role),
    ) ||
    !Array.isArray(graph.nodeIds) ||
    graph.nodeIds.some((id) => typeof id !== "string") ||
    new Set(graph.nodeIds).size !== graph.nodeIds.length
  ) {
    throw new StateError(
      "INVALID_GRAPH_PROVENANCE",
      "A source graph requires a checked bounded membership receipt.",
    );
  }
  return graph as GraphReceipt;
}
export function graphRelationshipPath(
  provenance: Provenance | undefined,
  path: string[],
): boolean {
  const graph = graphReceipt(provenance);
  return !!graph && ["edge", "timeline-link"].includes(graph.role) &&
    ["from", "to"].includes(path[0]) && (path.length === 1 || path[1] === "el");
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
/** Capture preserves missing known source parts as pending; publication cannot emit dangling native graphs. */
export function assertGraphDocument(
  document: BentoDoc,
  provenance: ProvenanceMap,
  options: {
    baseline?: BentoDoc;
    capture?: boolean;
    strict?: boolean;
    pending?: Change[];
  } = {},
): void {
  const partial = options.capture || options.strict === false;
  for (const slide of document.slides) {
    const proofs = Object.entries(provenance).flatMap(([key, source]) => {
      const graph = graphReceipt(source);
      if (!graph) return [];
      const [slideId, elementId] = JSON.parse(key) as [
        string | null,
        string | null,
      ];
      return slideId === slide.id && elementId && graph
        ? [{ elementId, graph }]
        : [];
    });
    for (const { elementId, graph } of proofs) {
      const element = slide.elements.find((element) =>
        element.id === elementId
      );
      if (!element) {
        if (!partial) {
          fail(
            "GRAPH_PENDING_DELETION",
            "A source graph part is removed only in Bento; restore it or synchronize an explicitly supported source operation before rendering.",
          );
        }
        continue;
      }
      if (
        graph.labelId &&
        !slide.elements.some((element) => element.id === graph.labelId)
      ) {
        if (!partial) {
          fail(
            "GRAPH_PENDING_DELETION",
            "A source graph label is pending deletion; preserve/review the source component before publishing.",
          );
        }
      }
      if (
        !partial && graph.labelId &&
        slide.elements.find((label) => label.id === graph.labelId)?.type !==
          "text"
      ) {
        fail(
          "GRAPH_PENDING_STRUCTURE",
          "The native source graph label changed renderer; restore its text object before publishing.",
        );
      }
      if (graph.role === "node" || graph.role === "milestone") {
        if (
          !partial &&
          (element.type !== "shape" ||
            ["line", "path"].includes(String(element.shape)))
        ) {
          fail(
            "GRAPH_PENDING_STRUCTURE",
            "The native source node changed to an incompatible renderer; restore the node shape before publishing.",
          );
        }
        continue;
      }
      if (!partial && (element.type !== "shape" || element.shape !== "line")) {
        fail(
          "GRAPH_PENDING_STRUCTURE",
          "The native source connector changed its renderer; restore its line shape before publishing the relationship.",
        );
      }
      for (const endpoint of ["from", "to"] as const) {
        const value = element[endpoint];
        const reference =
          value && typeof value === "object" && !Array.isArray(value)
            ? value.el
            : undefined;
        if (reference === undefined && partial) continue; // Native detachment remains pending, never style.
        if (typeof reference !== "string" || !reference) {
          fail(
            "GRAPH_ENDPOINT_REQUIRED",
            "Source graph connectors need both explicit native node endpoints; restore or review the detached endpoint.",
          );
        }
        const expected = String(graph[endpoint]) + "/qb-node";
        if (
          graph.role === "timeline-link" && !partial && reference !== expected
        ) {
          fail(
            "UNSUPPORTED_TIMELINE_RELATION",
            "Timeline links derive from lexical QMD order. Native endpoint edits remain pending; restore them or reorder original milestone blocks.",
          );
        }
        const targetProof = proofs.find((proof) =>
          proof.elementId === reference
        )?.graph;
        const target = slide.elements.find((element) =>
          element.id === reference
        );
        if (
          !targetProof || !["node", "milestone"].includes(targetProof.role) ||
          targetProof.kind !== graph.kind ||
          targetProof.componentId !== graph.componentId ||
          !graph.nodeIds.includes(targetProof.sourceId) ||
          reference !== targetProof.sourceId + "/qb-node"
        ) {
          fail(
            "GRAPH_ENDPOINT_SCOPE",
            "A source connector can reference only a direct source node shape in its own original graph and slide.",
          );
        }
        if (!target) {
          const baseline = options.baseline?.slides.find((baseline) =>
            baseline.id === slide.id
          );
          const previous = baseline?.elements.find((previous) =>
            previous.id === elementId
          )?.[endpoint];
          const unchanged = previous && typeof previous === "object" &&
            !Array.isArray(previous) && previous.el === reference;
          if (!partial || !unchanged) {
            fail(
              "GRAPH_DANGLING_ENDPOINT",
              "The referenced native node is absent; restore the pending node before publishing this graph.",
            );
          }
        }
      }
      const from = element.from as JsonObject | undefined,
        to = element.to as JsonObject | undefined;
      if (from?.el && from.el === to?.el) {
        fail(
          "GRAPH_ENDPOINT_SCOPE",
          "Self edges are outside the bounded source diagram contract.",
        );
      }
    }
  }
  // A removed whole source slide is already a separately controlled pending action.
}
