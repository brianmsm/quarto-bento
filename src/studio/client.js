import { createBentoBridge } from "/bridge.js";
const $ = (id) => document.getElementById(id);
let state, bridge, syncPlan, reconcilePlan, busy = false, previewGeneration = 0;
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-qbento-token": globalThis.qbentoToken,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error);
  return result;
}
function status(text) {
  $("status").textContent = text;
}
function showError(error) {
  status(error.message);
}
function setBusy(value) {
  busy = value;
  $("busy").hidden = !value;
  $("editor").inert = value;
  for (
    const id of ["save", "slides", "review", "reconcile", "render", "presenter"]
  ) {
    $(id).disabled = value;
  }
  if (value) {
    $("editor").contentDocument?.activeElement?.blur();
    $("render").focus();
  }
}
function connect() {
  try {
    const editor = $("editor").contentWindow;
    if (!editor.bento) {
      setTimeout(connect, 150);
      return;
    }
    // The iframe and its save revision must describe the same immutable snapshot.
    // A later /api/state fetch can already belong to another editor's save.
    const snapshot = editor.__qbentoSnapshot;
    if (!snapshot || !Number.isSafeInteger(snapshot.revision)) {
      throw new Error(
        "El editor no tiene una revisión verificable. Recarga el proyecto.",
      );
    }
    state = {
      docId: snapshot.docId,
      revision: snapshot.revision,
      pending: snapshot.pending,
    };
    const oldBridge = bridge;
    bridge = createBentoBridge(editor.bento, {
      docId: state.docId,
      persist: async ({ doc }) => {
        const receipt = await api("save", { doc, revision: state.revision });
        state.revision = receipt.revision;
        return receipt;
      },
      onEvent: (event) => {
        if (event.type === "document" && !busy) status("Cambios sin guardar");
        if (event.type === "saved" && !busy) {
          status(
            event.dirty
              ? "Hay cambios nuevos sin guardar"
              : "Proyecto guardado",
          );
        }
        if (event.type === "error" || event.type === "save-error") {
          showError(event.error);
        }
      },
    });
    oldBridge?.dispose();
    setBusy(false);
    status(
      state.pending
        ? `${state.pending} cambios pendientes de sincronización`
        : "Proyecto abierto",
    );
  } catch (error) {
    setBusy(false);
    showError(error);
  }
}
$("editor").addEventListener("load", connect);
$("save").onclick = async () => {
  try {
    if (!busy) await bridge.save();
  } catch (error) {
    showError(error);
  }
};
function showPatches(plan) {
  $("patches").replaceChildren();
  for (
    const patch of [
      ...plan.patch.patches,
      ...(plan.notes?.patches ?? []).map((patch) => ({
        ...patch,
        blockId: `${patch.blockId} · notas de orador`,
      })),
      ...plan.changes.filter((change) => change.kind === "visual-attribute")
        .map((change) => ({
          blockId: `${change.blockId} · atributo visual`,
          expected: change.before,
          replacement: change.after,
        })),
    ]
  ) {
    const section = document.createElement("section"),
      title = document.createElement("h3"),
      before = document.createElement("pre"),
      after = document.createElement("pre");
    title.textContent = patch.blockId;
    before.textContent = patch.expected;
    before.className = "before";
    after.textContent = patch.replacement;
    after.className = "after";
    section.append(title, before, after);
    $("patches").append(section);
  }
  if (plan.structure) {
    for (const step of plan.structure.steps) {
      for (const edit of step.edits) {
        const section = document.createElement("section"),
          title = document.createElement("h3"),
          before = document.createElement("pre"),
          after = document.createElement("pre");
        title.textContent = step.operation.type === "delete-slide"
          ? `Eliminar ${step.operation.id} del QMD`
          : `Estructura · ${step.operation.type}`;
        before.textContent = edit.expected;
        before.className = "before";
        after.textContent = edit.replacement || "Se elimina este fragmento";
        after.className = "after";
        section.append(title, before, after);
        $("patches").append(section);
      }
    }
    const section = document.createElement("section"),
      title = document.createElement("h3"),
      result = document.createElement("pre");
    title.textContent = "QMD propuesto con cambios de diapositivas";
    result.textContent = plan.result;
    section.append(title, result);
    $("patches").append(section);
  }
}
async function prepareSyncPreview() {
  const generation = ++previewGeneration;
  syncPlan = undefined;
  $("apply").disabled = true;
  $("patches").replaceChildren();
  const boxes = [...$("delete-confirmations").querySelectorAll("input")];
  if (boxes.some((box) => !box.checked)) {
    $("sync-note").textContent =
      "Confirma las eliminaciones para preparar la propuesta, o restáuralas desde Diapositivas.";
    return;
  }
  $("sync-note").textContent = "Preparando los cambios propuestos…";
  try {
    const plan = await api("sync/preview", {
      confirmedDeleteIds: boxes.map((box) => box.dataset.change),
    });
    if (generation !== previewGeneration) return;
    if (plan.stateRevision !== state.revision) {
      throw new Error(
        "El proyecto cambió mientras se preparaba la revisión. Recarga antes de sincronizar.",
      );
    }
    syncPlan = plan;
    showPatches(syncPlan);
    const hasChanges = syncPlan.patch.patches.length ||
      syncPlan.attributes?.patches.length || syncPlan.notes?.patches.length ||
      syncPlan.structure;
    $("sync-note").textContent = hasChanges
      ? "Revisa los cambios propuestos. Aplicar modifica los fragmentos y la estructura indicados del QMD."
      : "No hay cambios compatibles pendientes de sincronización.";
    $("apply").disabled = !hasChanges;
  } catch (error) {
    if (generation === previewGeneration) {
      $("sync-note").textContent = error.message;
    }
  }
}
$("review").onclick = async () => {
  if (busy) return;
  try {
    await bridge.save();
    const saved = await api("state");
    if (saved.revision !== state.revision) {
      throw new Error(
        "Otra pestaña ha cambiado el proyecto. Conserva tus cambios y recarga antes de sincronizar.",
      );
    }
    syncPlan = undefined;
    $("apply").disabled = true;
    $("patches").replaceChildren();
    $("delete-confirmations").replaceChildren();
    for (
      const change of saved.pending.filter((item) =>
        item.kind === "delete-slide"
      )
    ) {
      const label = document.createElement("label"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.change = change.id;
      checkbox.onchange = prepareSyncPreview;
      label.append(
        checkbox,
        document.createTextNode(
          ` Confirmo eliminar la diapositiva ${change.target.slideId} y su contenido del QMD`,
        ),
      );
      $("delete-confirmations").append(label);
    }
    showChanges($("changes"), saved.pending.map((change) => ({ change })));
    $("review-dialog").showModal();
    await prepareSyncPreview();
  } catch (error) {
    showError(error);
  }
};
$("apply").onclick = async () => {
  if (!syncPlan) return;
  if (
    [...$("delete-confirmations").querySelectorAll("input")].some((box) =>
      !box.checked
    )
  ) return;
  $("apply").disabled = true;
  try {
    const receipt = await api("sync/apply", syncPlan);
    state.revision = receipt.revision;
    syncPlan = undefined;
    $("sync-note").textContent =
      "Cambios aplicados al QMD. Recalcula para actualizar la presentación.";
    status("QMD sincronizado; listo para recalcular");
  } catch (error) {
    $("sync-note").textContent = error.message;
  }
};
$("close").onclick = () => $("review-dialog").close();
$("review-dialog").addEventListener("close", () => {
  previewGeneration++;
  syncPlan = undefined;
});
function reloadEditor() {
  $("editor").contentWindow.__qbentoManagedReload = true;
  $("editor").src = "/deck?revision=" + Date.now();
}
async function runSlideAction(action, slideId) {
  if (busy) return;
  setBusy(true);
  $("busy").textContent = "Guardando cambios de diapositivas…";
  try {
    await bridge.save();
    const receipt = await api("slides/action", {
      action,
      slideId,
      revision: state.revision,
    });
    state.revision = receipt.revision;
    $("slides-dialog").close();
    reloadEditor();
  } catch (error) {
    $("slides-note").textContent = error.message;
    setBusy(false);
  }
}
function slideLabel(slide) {
  const title = slide.name || slide.title ||
    slide.elements.find((element) => element.type === "text")?.html || "";
  return `${slide.id}${
    title ? " · " + String(title).replace(/<[^>]*>/g, " ") : ""
  }`;
}
$("slides").onclick = async () => {
  if (busy) return;
  setBusy(true);
  $("busy").textContent = "Guardando antes de revisar las diapositivas…";
  try {
    await bridge.save();
    const saved = await api("state");
    if (saved.revision !== state.revision) {
      throw new Error(
        "Otra pestaña cambió el proyecto. Recarga antes de cambiar diapositivas.",
      );
    }
    $("slides-note").textContent = "";
    $("slide-list").replaceChildren();
    const row = (slide, description, actions) => {
      const section = document.createElement("section"),
        title = document.createElement("h3"),
        detail = document.createElement("p");
      title.textContent = slideLabel(slide);
      detail.textContent = description;
      section.append(title, detail);
      for (const [action, text, disabled] of actions) {
        const button = document.createElement("button");
        button.textContent = text;
        button.disabled = !!disabled;
        button.onclick = () => runSlideAction(action, slide.id);
        section.append(button);
      }
      $("slide-list").append(section);
    };
    for (const slide of saved.emitted.slides) {
      const sourced = saved.generatedBaseline.slides.some((item) =>
        item.id === slide.id
      );
      row(
        slide,
        (slide.hidden ? "Oculta" : "Visible") +
          (!sourced ? " · Nueva: sincroniza antes de eliminarla de QMD." : ""),
        [
          [
            slide.hidden ? "show" : "hide",
            slide.hidden ? "Mostrar diapositiva" : "Ocultar diapositiva",
          ],
          [
            "delete",
            "Marcar para eliminar",
            !sourced || saved.emitted.slides.length === 1,
          ],
        ],
      );
    }
    for (
      const change of saved.pending.filter((item) =>
        item.kind === "delete-slide"
      )
    ) {
      if (change.before.present && change.before.value?.elements) {
        row(
          change.before.value,
          "Eliminación pendiente · QMD conservado hasta sincronizar.",
          [
            ["restore", "Restaurar diapositiva"],
          ],
        );
      }
    }
    $("slides-dialog").showModal();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
};
$("slides-close").onclick = () => $("slides-dialog").close();
function describeValue(value) {
  if (!value?.present) return "No existe";
  return typeof value.value === "string"
    ? value.value
    : JSON.stringify(value.value, null, 2);
}
function showChanges(container, items, selectable = false) {
  container.replaceChildren();
  const origins = {
    authored: "Contenido escrito",
    computed: "Resultado calculado",
    "bento-only": "Objeto añadido en Bento",
    detached: "Desvinculado del cálculo",
  };
  const actions = {
    "keep-source": "Usar QMD y descartar esta edición de Bento",
    "keep-bento": "Conservar Bento para sincronizar después",
    detach: "Desvincular este valor del cálculo",
  };
  for (const { change, actions: choices } of items) {
    const section = document.createElement("section"),
      title = document.createElement("h3"),
      origin = document.createElement("p");
    title.textContent = [
      change.target.slideId || "Presentación",
      change.target.elementId,
      change.path.join(".") || change.kind,
    ].filter(Boolean).join(" · ");
    origin.textContent = `${origins[change.origin] || change.origin} · ${
      change.status === "conflict" ? "Conflicto" : "Pendiente"
    }`;
    section.append(title, origin);
    for (
      const [label, value] of [["Base compartida", change.before], [
        "QMD actual",
        change.source ?? change.before,
      ], ["Edición Bento", change.after]]
    ) {
      const heading = document.createElement("strong"),
        content = document.createElement("pre");
      heading.textContent = label;
      content.textContent = describeValue(value);
      section.append(heading, content);
    }
    if (change.reason) {
      const note = document.createElement("p");
      note.textContent = change.reason;
      section.append(note);
    }
    if (selectable) {
      const label = document.createElement("label"),
        select = document.createElement("select");
      label.textContent = "Decisión: ";
      select.dataset.change = change.id;
      for (const action of ["", ...choices]) {
        const option = document.createElement("option");
        option.value = action;
        option.textContent = actions[action] || "Mantener pendiente";
        select.append(option);
      }
      select.onchange = () => {
        $("resolve").disabled = ![...container.querySelectorAll("select")].some(
          (s) => s.value,
        );
      };
      label.append(select);
      section.append(label);
    }
    container.append(section);
  }
}
$("reconcile").onclick = async () => {
  if (busy) return;
  setBusy(true);
  $("busy").textContent = "Ejecutando QMD para comparar sus resultados…";
  try {
    await bridge.save();
    reconcilePlan = await api("reconcile/preview", {});
    if (reconcilePlan.stateRevision !== state.revision) {
      reconcilePlan = undefined;
      throw new Error(
        "Otra pestaña cambió el proyecto. Recarga antes de elegir valores.",
      );
    }
    showChanges($("reconcile-changes"), reconcilePlan.changes, true);
    $("reconcile-note").textContent = reconcilePlan.changes.length
      ? "No se ha aplicado ninguna decisión."
      : "No hay divergencias pendientes.";
    $("resolve").disabled = true;
    $("reconcile-dialog").showModal();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
};
$("resolve-close").onclick = () => $("reconcile-dialog").close();
$("resolve").onclick = async () => {
  if (!reconcilePlan || busy) return;
  const choices = [...$("reconcile-changes").querySelectorAll("select")].filter(
    (s) => s.value,
  ).map((s) => ({ changeId: s.dataset.change, action: s.value }));
  setBusy(true);
  $("resolve").disabled = true;
  $("resolve-close").disabled = true;
  $("reconcile-note").textContent =
    "Verificando de nuevo los resultados antes de guardar…";
  try {
    const result = await api("reconcile/apply", {
      plan: reconcilePlan,
      choices,
    });
    state.revision = result.revision;
    reconcilePlan = undefined;
    $("reconcile-dialog").close();
    $("editor").contentWindow.__qbentoManagedReload = true;
    $("editor").src = "/deck?revision=" + Date.now();
  } catch (error) {
    $("reconcile-note").textContent = error.message;
    setBusy(false);
  } finally {
    $("resolve-close").disabled = false;
  }
};
$("render").onclick = async () => {
  if (busy) return;
  setBusy(true);
  $("busy").textContent = "Recalculando. Tus cambios están guardados.";
  try {
    await bridge.save();
    status("Recalculando…");
    const receipt = await api("render", {});
    state.revision = receipt.revision;
    if (bridge.dirty) {
      throw new Error(
        "Aparecieron cambios durante el recálculo. Se conservan en el editor; guárdalos antes de recargar.",
      );
    }
    // Only this confirmed saved-and-recomputed navigation bypasses upstream's stale dirty flag.
    $("editor").contentWindow.__qbentoManagedReload = true;
    $("editor").src = "/deck?revision=" + Date.now();
    // connect disposes the old bridge only after the replacement editor exists.
  } catch (error) {
    setBusy(false);
    showError(error);
  }
};
globalThis.addEventListener("beforeunload", (event) => {
  if (bridge?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

$("presenter").onclick = async () => {
  if (busy) return;
  try {
    setBusy(true);
    $("busy").textContent =
      "Preparando presentación con tus cambios guardados.";
    await bridge.save();
    if (bridge.dirty) {
      throw new Error(
        "Hay cambios nuevos sin guardar. Vuelve a preparar la presentación.",
      );
    }
    const result = await api("presenter", { revision: state.revision });
    $("presenter-frame").src = result.url;
    $("presenter-dialog").showModal();
    status("Presentación preparada con tus cambios guardados");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
};
$("presenter-close").onclick = () => $("presenter-dialog").close();
$("presenter-dialog").onclose = () => {
  $("presenter-frame").src = "about:blank";
};
