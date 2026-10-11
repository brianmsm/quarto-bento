/** Explicit source diagram relationships; saving never writes QMD or executes it. */
import { projectPaths, readProject, saveProject } from "./project.ts";
import { nativeGraphSlide } from "./graph-scope.ts";
import { canonical, clone, set, targetKey } from "../state/json.ts";
import { assertGraphDocument, graphReceipt } from "../state/graphs.ts";
import {
  type JsonObject,
  type ProjectState,
  StateError,
} from "../state/types.ts";
import { hashSource, scanSource } from "../source/mod.ts";
import {
  graphEdgeId,
  graphNodeId,
  sourceGraphs,
  timelineLinkId,
} from "../source/graphs.ts";

export interface RelationGraph {
  slideId: string;
  slideLabel: string;
  componentId: string;
  kind: "diagram" | "timeline";
  nodes: { id: string; label: string }[];
  edges: {
    id: string;
    label: string;
    fromNodeId: string;
    toNodeId: string;
    detached: boolean;
  }[];
}
export interface GraphRelations {
  docId: string;
  revision: number;
  sourceHash: string;
  graphs: RelationGraph[];
}
export interface GraphRelationRequest {
  expectedDocId: string;
  expectedRevision: number;
  expectedSourceHash: string;
  slideId: string;
  componentId: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
function catalog(state: ProjectState, text: string): GraphRelations {
  const source = scanSource(text);
  for (const proof of Object.values(state.provenance)) {
    if (graphReceipt(proof) && proof.source?.hash !== source.hash) {
      fail(
        "STALE_SOURCE",
        "QMD cambió desde la última proyección. Recalcula o revisa sus diferencias; tus cambios pendientes siguen guardados.",
      );
    }
  }
  const graphs = sourceGraphs(source).map((graph): RelationGraph => {
    const slideId = nativeGraphSlide(source, state, graph),
      slide = state.emitted.slides.find((slide) => slide.id === slideId),
      baseline = state.generatedBaseline.slides.find((slide) =>
        slide.id === slideId
      );
    if (!slide || !baseline) {
      fail(
        "GRAPH_PENDING_DELETION",
        "Restaura la diapositiva del gráfico antes de cambiar sus relaciones.",
      );
    }
    const originalIds = graph.nodes.map((node) => node.block.id);
    const member = (
      nativeId: string,
      sourceId: string,
      role: string,
      labelId?: string,
    ) => {
      const provenance =
          state.provenance[targetKey({ slideId, elementId: nativeId })],
        proof = graphReceipt(provenance),
        native = slide.elements.find((element) => element.id === nativeId),
        generated = baseline.elements.find((element) =>
          element.id === nativeId
        );
      if (
        !proof || provenance.origin !== "authored" ||
        proof.componentId !== graph.wrapper.id ||
        proof.sourceId !== sourceId || proof.role !== role ||
        proof.kind !== graph.kind ||
        proof.labelId !== labelId ||
        canonical(proof.nodeIds) !== canonical(originalIds) ||
        provenance.source?.hash !== source.hash || !generated
      ) {
        fail(
          "UNMAPPED_GRAPH_SOURCE",
          "Este gráfico necesita una proyección fuente verificada antes de editar relaciones.",
        );
      }
      if (
        !native ||
        (labelId && !slide.elements.some((element) => element.id === labelId))
      ) {
        fail(
          "GRAPH_PENDING_DELETION",
          "Restaura los nodos, etiquetas y conectores pendientes de eliminación antes de editar relaciones.",
        );
      }
      if (
        native.type !== "shape" ||
        (role === "node" || role === "milestone"
          ? ["line", "path"].includes(String(native.shape))
          : native.shape !== "line") ||
        (labelId &&
          slide.elements.find((element) => element.id === labelId)?.type !==
            "text")
      ) {
        fail(
          "GRAPH_PENDING_STRUCTURE",
          "Restaura el tipo nativo de los nodos, textos y conectores antes de editar relaciones.",
        );
      }
      return { native, generated, proof };
    };
    const nodes = graph.nodes.map((node) => {
      member(
        graphNodeId(node.block.id),
        node.block.id,
        graph.kind === "diagram" ? "node" : "milestone",
        node.label!.id,
      );
      return { id: node.block.id, label: node.label!.content.trim() };
    });
    const links = graph.kind === "diagram"
      ? graph.edges.map((edge) => ({
        id: edge.block.id,
        nativeId: graphEdgeId(edge.block.id),
        sourceId: edge.block.id,
        from: edge.from,
        to: edge.to,
        labelId: edge.label?.id,
        label: edge.label?.content.trim() ?? "",
      }))
      : nodes.slice(0, -1).map((node, index) => ({
        id: timelineLinkId(graph.wrapper.id, node.id, nodes[index + 1].id),
        nativeId: timelineLinkId(
          graph.wrapper.id,
          node.id,
          nodes[index + 1].id,
        ),
        sourceId: graph.wrapper.id,
        from: node.id,
        to: nodes[index + 1].id,
        labelId: undefined,
        label: "",
      }));
    const edges = links.map((link) => {
      const { native, generated, proof } = member(
        link.nativeId,
        link.sourceId,
        graph.kind === "diagram" ? "edge" : "timeline-link",
        link.labelId,
      );
      const sourceNode = (endpoint: "from" | "to") => {
        if (
          proof[endpoint] !== link[endpoint] ||
          (generated[endpoint] as JsonObject | undefined)?.el !==
            graphNodeId(link[endpoint])
        ) {
          fail(
            "UNMAPPED_GRAPH_SOURCE",
            "La relación original no coincide con su proyección verificada.",
          );
        }
        const id = (native[endpoint] as JsonObject | undefined)?.el;
        if (id === undefined) return { id: link[endpoint], detached: true };
        const node = nodes.find((node) => graphNodeId(node.id) === id);
        if (!node) {
          fail(
            "GRAPH_ENDPOINT_SCOPE",
            "La relación apunta fuera de los nodos originales del mismo gráfico.",
          );
        }
        return { id: node.id, detached: false };
      };
      const from = sourceNode("from"), to = sourceNode("to");
      return {
        id: link.id,
        label: link.label,
        fromNodeId: from.id,
        toNodeId: to.id,
        detached: from.detached || to.detached,
      };
    });
    return {
      slideId,
      slideLabel: source.blocks.find((block) =>
        block.id === graph.wrapper.slideId && block.kind === "heading"
      )?.content.trim() ?? slideId,
      componentId: graph.wrapper.id,
      kind: graph.kind,
      nodes,
      edges,
    };
  });
  assertGraphDocument(state.emitted, state.provenance, {
    capture: true,
    baseline: state.generatedBaseline,
  });
  return {
    docId: state.docId,
    revision: state.revision,
    sourceHash: source.hash,
    graphs,
  };
}

/** Read only; selectors come from exact source roles and verified saved native members. */
export async function readGraphRelations(
  source: string,
): Promise<GraphRelations> {
  return catalog(
    await readProject(source),
    await Deno.readTextFile(projectPaths(source).source),
  );
}
/** One bounded atomic pair update, including explicit reconstruction after native detachment. */
export async function saveGraphRelation(
  source: string,
  request: GraphRelationRequest,
) {
  if (
    !request || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).sort().join(",") !==
      "componentId,edgeId,expectedDocId,expectedRevision,expectedSourceHash,fromNodeId,slideId,toNodeId" ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    ![
      request.expectedDocId,
      request.slideId,
      request.componentId,
      request.edgeId,
      request.fromNodeId,
      request.toNodeId,
    ].every((value) => typeof value === "string" && value.length > 0) ||
    typeof request.expectedSourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.expectedSourceHash)
  ) {
    fail(
      "INVALID_GRAPH_RELATION",
      "Selecciona una relación con identidad, revisión y fuente verificadas.",
    );
  }
  const state = await readProject(source);
  if (state.docId !== request.expectedDocId) {
    fail(
      "UNRELATED_DOCUMENT",
      "La relación pertenece a otro documento; recarga el proyecto.",
    );
  }
  if (state.revision !== request.expectedRevision) {
    fail(
      "STALE_REVISION",
      "Otro guardado cambió el proyecto; recarga las relaciones antes de guardar.",
    );
  }
  const text = await Deno.readTextFile(projectPaths(source).source);
  if (hashSource(text) !== request.expectedSourceHash) {
    fail(
      "STALE_SOURCE",
      "QMD cambió después de abrir las relaciones; recarga y revisa antes de guardar.",
    );
  }
  const snapshot = catalog(state, text),
    graph = snapshot.graphs.find((graph) =>
      graph.slideId === request.slideId &&
      graph.componentId === request.componentId
    );
  if (!graph) {
    fail(
      "GRAPH_ENDPOINT_SCOPE",
      "Selecciona un diagrama QMD existente en su diapositiva original.",
    );
  }
  if (graph.kind !== "diagram") {
    fail(
      "UNSUPPORTED_TIMELINE_RELATION",
      "La secuencia deriva del orden de hitos en QMD; sus relaciones son de solo lectura.",
    );
  }
  if (
    !graph.edges.some((edge) => edge.id === request.edgeId) ||
    !graph.nodes.some((node) => node.id === request.fromNodeId) ||
    !graph.nodes.some((node) => node.id === request.toNodeId) ||
    request.fromNodeId === request.toNodeId
  ) {
    fail(
      "GRAPH_ENDPOINT_SCOPE",
      "Selecciona una arista y dos nodos distintos del mismo diagrama.",
    );
  }
  if (
    state.pending.some((change) =>
      change.kind === "field" && change.target.slideId === graph.slideId &&
      change.target.elementId === graphEdgeId(request.edgeId) &&
      ["from", "to"].includes(change.path[0]) &&
      (change.path.length === 1 || change.path[1] === "el") &&
      change.status === "conflict"
    )
  ) {
    fail(
      "GRAPH_RELATION_CONFLICT",
      "Esta relación tiene un conflicto con QMD. Resuélvelo desde Comparar con QMD antes de elegir nuevos nodos; las demás ediciones siguen guardadas.",
    );
  }
  const doc = clone(state.emitted),
    edge = doc.slides.find((slide) => slide.id === graph.slideId)!.elements
      .find((element) => element.id === graphEdgeId(request.edgeId))!,
    baseline = state.generatedBaseline.slides.find((slide) =>
      slide.id === graph.slideId
    )!.elements.find((element) => element.id === edge.id)!;
  for (const endpoint of ["from", "to"] as const) {
    const current = edge[endpoint];
    const present = current && typeof current === "object" &&
      !Array.isArray(current);
    const anchor = clone(present ? current : baseline[endpoint] as JsonObject);
    if (!present) {
      const overlay = state.overrides.find((overlay) =>
        overlay.target.slideId === graph.slideId &&
        overlay.target.elementId === edge.id
      );
      for (const field of overlay?.fields ?? []) {
        if (
          field.path.length === 2 && field.path[0] === endpoint &&
          field.path[1] === "side"
        ) set(anchor, ["side"], field.value);
      }
    }
    edge[endpoint] = {
      ...anchor,
      el: graphNodeId(
        endpoint === "from" ? request.fromNodeId : request.toNodeId,
      ),
    };
  }
  return await saveProject(
    source,
    doc,
    request.expectedRevision,
    request.expectedSourceHash,
  );
}
