import { createBentoBridge } from "/bridge.js";
const $ = (id) => document.getElementById(id);
let state, bridge, syncPlan, busy = false;
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
  for (const id of ["save", "review", "render"]) $(id).disabled = value;
  if (value) {
    $("editor").contentDocument?.activeElement?.blur();
    $("render").focus();
  }
}
async function connect() {
  try {
    const editor = $("editor").contentWindow;
    if (!editor.bento) {
      setTimeout(connect, 150);
      return;
    }
    state = await api("state");
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
      state.pending.length
        ? `${state.pending.length} cambios pendientes de sincronización`
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
  for (const patch of plan.patch.patches) {
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
}
$("review").onclick = async () => {
  if (busy) return;
  try {
    await bridge.save();
    const saved = await api("state");
    syncPlan = undefined;
    $("apply").disabled = true;
    $("patches").replaceChildren();
    $("changes").textContent = JSON.stringify(saved.pending, null, 2);
    $("review-dialog").showModal();
    try {
      syncPlan = await api("sync/preview", {});
      showPatches(syncPlan);
      $("sync-note").textContent = syncPlan.patch.patches.length
        ? "Revisa el texto anterior y el propuesto. Aplicar modifica solo estos fragmentos del QMD."
        : "No hay cambios de texto compatibles pendientes de sincronización.";
      $("apply").disabled = !syncPlan.patch.patches.length;
    } catch (error) {
      $("sync-note").textContent = error.message;
    }
  } catch (error) {
    showError(error);
  }
};
$("apply").onclick = async () => {
  if (!syncPlan) return;
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
$("render").onclick = async () => {
  if (busy) return;
  setBusy(true);
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
