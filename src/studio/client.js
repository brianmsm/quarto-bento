import { createBentoBridge } from "/bridge.js";
const $ = (id) => document.getElementById(id);
let state, bridge;
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-qbento-token": window.qbentoToken,
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
async function connect() {
  try {
    state = await api("state");
    const editor = $("editor").contentWindow;
    if (!editor.bento) {
      setTimeout(connect, 150);
      return;
    }
    bridge?.dispose();
    bridge = createBentoBridge(editor.bento, {
      docId: state.docId,
      persist: async ({ doc }) => {
        const receipt = await api("save", { doc, revision: state.revision });
        state.revision = receipt.revision;
        return receipt;
      },
      onEvent: (event) => {
        if (event.type === "document") status("Cambios sin guardar");
        if (event.type === "saved") {
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
    for (const id of ["save", "review", "render"]) $(id).disabled = false;
    status(
      state.pending.length
        ? `${state.pending.length} cambios pendientes de sincronización`
        : "Proyecto abierto",
    );
  } catch (error) {
    showError(error);
  }
}
$("editor").addEventListener("load", connect);
$("save").onclick = () => bridge.save().catch(showError);
$("review").onclick = async () => {
  try {
    await bridge.save();
    const saved = await api("state");
    $("changes").textContent = JSON.stringify(saved.pending, null, 2);
    $("review-dialog").showModal();
  } catch (e) {
    showError(e);
  }
};
$("close").onclick = () => $("review-dialog").close();
$("render").onclick = async () => {
  try {
    await bridge.save();
    status("Recalculando…");
    await api("render", {});
    bridge.dispose();
    $("editor").src = "/deck?revision=" + Date.now();
  } catch (e) {
    showError(e);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (bridge?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
