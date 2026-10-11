/** Explicit diagram relationships, with saved source/native identities. */
export function attachGraphRelations(
  { api, getState, saveBefore, setBusy, reloadEditor, showError },
) {
  const $ = (id) => document.getElementById(id);
  let snapshot, working = false;
  const graph = () =>
    snapshot?.graphs.find((graph) =>
      graph.slideId === $("relation-slide").value &&
      graph.componentId === $("relation-graph").value
    );
  const edge = () =>
    graph()?.edges.find((edge) => edge.id === $("relation-edge").value);
  function options(id, items, label = (item) => item.label) {
    $(id).replaceChildren();
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = label(item);
      $(id).append(option);
    }
  }
  function controls(disabled) {
    working = disabled;
    for (
      const control of $("relations-dialog").querySelectorAll("button, select")
    ) control.disabled = disabled;
    if (!disabled) {
      const editable = graph()?.kind === "diagram" && !!edge();
      for (const id of ["relation-edge", "relation-from", "relation-to"]) {
        $(id).disabled = !editable;
      }
      $("relation-save").disabled = !editable ||
        $("relation-from").value === $("relation-to").value;
    }
  }
  function showEdge() {
    const current = graph(), relation = edge();
    options(
      "relation-from",
      current?.nodes ?? [],
      (node) => `${node.label} · #${node.id}`,
    );
    options(
      "relation-to",
      current?.nodes ?? [],
      (node) => `${node.label} · #${node.id}`,
    );
    if (relation) {
      $("relation-from").value = relation.fromNodeId;
      $("relation-to").value = relation.toNodeId;
    }
    $("relation-sequence").textContent = current?.kind === "timeline"
      ? current.nodes.map((node) => `${node.label} (#${node.id})`).join(" → ")
      : "";
    $("relation-note").textContent = !current
      ? "Este proyecto no tiene diagramas ni secuencias QMD existentes."
      : current.kind === "timeline"
      ? "Secuencia de solo lectura: sus relaciones derivan del orden de los hitos en QMD. Reordena los bloques y recalcula para cambiarla."
      : relation?.detached
      ? "El conector está desvinculado. Selecciona ambos nodos para reconectarlo explícitamente. Guardar conserva el cambio pendiente; Revisar cambios permite aplicarlo a QMD."
      : "Guardar conserva la relación pendiente sin recalcular. Después usa Revisar cambios para comprobar el diagrama y aplicar el parche a QMD.";
    controls(false);
  }
  function showGraph() {
    const current = graph();
    options(
      "relation-edge",
      current?.kind === "diagram" ? current.edges : [],
      (edge) => `${edge.label || "Conexión"} · #${edge.id}`,
    );
    showEdge();
  }
  function showSlide() {
    options(
      "relation-graph",
      snapshot?.graphs.filter((graph) =>
        graph.slideId === $("relation-slide").value
      ).map((graph) => ({
        id: graph.componentId,
        label: `${
          graph.kind === "diagram" ? "Diagrama" : "Secuencia · solo lectura"
        } · #${graph.componentId}`,
      })) ?? [],
    );
    showGraph();
  }
  function checkedSnapshot() {
    const current = getState();
    if (
      !snapshot || snapshot.docId !== current?.docId ||
      snapshot.revision !== current?.revision
    ) {
      throw new Error(
        "El proyecto cambió desde que abriste este diálogo. Ciérralo y vuelve a abrir Relaciones; tus cambios siguen guardados.",
      );
    }
  }
  $("relations").onclick = async () => {
    if (working) return;
    controls(true);
    setBusy(true);
    $("busy").textContent = "Guardando cambios antes de revisar relaciones…";
    try {
      await saveBefore();
      snapshot = await api("graphs/relations");
      checkedSnapshot();
      const slides = [
        ...new Map(
          snapshot.graphs.map((
            graph,
          ) => [graph.slideId, {
            id: graph.slideId,
            label: `${graph.slideLabel} · #${graph.slideId}`,
          }]),
        ).values(),
      ];
      options("relation-slide", slides);
      showSlide();
      $("relations-dialog").showModal();
    } catch (error) {
      showError(error);
    } finally {
      controls(false);
      setBusy(false);
    }
  };
  $("relation-slide").onchange = showSlide;
  $("relation-graph").onchange = showGraph;
  $("relation-edge").onchange = showEdge;
  for (const id of ["relation-from", "relation-to"]) {
    $(id).onchange = () => controls(false);
  }
  $("relation-form").onsubmit = async (event) => {
    event.preventDefault();
    if (working || graph()?.kind !== "diagram" || !edge()) return;
    try {
      checkedSnapshot();
      const current = graph();
      controls(true);
      setBusy(true);
      $("busy").textContent = "Guardando relación pendiente en el proyecto…";
      await api("graphs/relations", {
        expectedDocId: snapshot.docId,
        expectedRevision: snapshot.revision,
        expectedSourceHash: snapshot.sourceHash,
        slideId: current.slideId,
        componentId: current.componentId,
        edgeId: edge().id,
        fromNodeId: $("relation-from").value,
        toNodeId: $("relation-to").value,
      });
      $("relations-dialog").close();
      reloadEditor();
    } catch (error) {
      $("relation-note").textContent = error.message;
      setBusy(false);
      showError(error);
    } finally {
      controls(false);
    }
  };
  $("relation-close").onclick = () => {
    if (!working) $("relations-dialog").close();
  };
  $("relations-dialog").addEventListener("cancel", (event) => {
    if (working) event.preventDefault();
  });
}
