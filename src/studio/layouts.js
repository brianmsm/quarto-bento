/** Explicit object-to-column assignments; preview and save use the same core operation. */
export function attachLayoutEditor(
  { api, getState, setBusy, showError, saveBefore, reloadEditor },
) {
  const $ = (id) => document.getElementById(id);
  let snapshot, prepared, working = false;
  function options(select, items) {
    select.replaceChildren();
    for (const [value, label] of items) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
  }
  function controls(value) {
    working = value;
    for (
      const control of $("layouts-dialog").querySelectorAll("button,select")
    ) control.disabled = value;
    $("layout-apply").disabled = value || !prepared;
  }
  function invalidate() {
    prepared = undefined;
    $("layout-preview").hidden = true;
    $("layout-note").textContent =
      "Asigna al menos un objeto a cada columna y revisa las posiciones antes de aplicar.";
    controls(false);
  }
  function objects() {
    const slide = snapshot.slides.find((s) => s.id === $("layout-slide").value);
    const layout = snapshot.layouts[$("layout-name").value];
    $("layout-objects").replaceChildren();
    for (const element of slide?.elements ?? []) {
      const row = document.createElement("p"),
        label = document.createElement("label"),
        select = document.createElement("select");
      label.textContent =
        `${element.label} · ${element.type} · #${element.id} `;
      select.dataset.elementId = element.id;
      select.setAttribute("aria-label", `Columna para ${element.id}`);
      options(select, [
        ["", "Conservar posición"],
        ...Array.from(
          { length: layout.columns },
          (_, index) => [String(index), `Columna ${index + 1}`],
        ),
      ]);
      select.onchange = invalidate;
      label.append(select);
      row.append(label);
      $("layout-objects").append(row);
    }
    invalidate();
  }
  function request() {
    const current = getState();
    if (
      snapshot.docId !== current?.docId ||
      snapshot.revision !== current?.revision
    ) {
      throw new Error(
        "El proyecto cambió. Cierra y vuelve a abrir Aplicar diseño.",
      );
    }
    const columns = Array.from({
      length: snapshot.layouts[$("layout-name").value].columns,
    }, () => []);
    for (const select of $("layout-objects").querySelectorAll("select")) {
      if (select.value !== "") {
        columns[Number(select.value)].push(select.dataset.elementId);
      }
    }
    return {
      expectedDocId: snapshot.docId,
      expectedRevision: snapshot.revision,
      expectedSourceHash: snapshot.sourceHash,
      expectedRegistryHash: snapshot.registryHash,
      slideId: $("layout-slide").value,
      layout: $("layout-name").value,
      columns,
    };
  }
  async function open() {
    if (working || $("layouts-dialog").open) return;
    controls(true);
    setBusy(true);
    $("busy").textContent = "Guardando cambios antes de aplicar un diseño…";
    try {
      await saveBefore();
      snapshot = await api("layouts");
      if (
        snapshot.docId !== getState()?.docId ||
        snapshot.revision !== getState()?.revision
      ) throw new Error("El proyecto cambió; vuelve a abrir Aplicar diseño.");
      options(
        $("layout-slide"),
        snapshot.slides.map((s) => [s.id, `${s.label} · #${s.id}`]),
      );
      options(
        $("layout-name"),
        Object.entries(snapshot.layouts).map((
          [id, layout],
        ) => [
          id,
          `${
            id === "two-column" ? "Dos columnas" : id
          } · ${layout.columns} columnas`,
        ]),
      );
      objects();
      $("layouts-dialog").showModal();
    } catch (error) {
      showError(error);
    } finally {
      controls(false);
      setBusy(false);
    }
  }
  $("layouts").onclick = open;
  $("layout-slide").onchange = objects;
  $("layout-name").onchange = objects;
  $("layout-close").onclick = () => $("layouts-dialog").close();
  $("layouts-dialog").addEventListener("cancel", (event) => {
    if (working) event.preventDefault();
  });
  $("layout-preview-button").onclick = async () => {
    if (working) return;
    try {
      const candidate = request();
      controls(true);
      const preview = await api("layouts/preview", candidate);
      prepared = candidate;
      $("layout-preview").textContent = preview.placements.map((p) =>
        `#${p.id}: x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, ancho=${
          p.w.toFixed(1)
        }, alto=${p.h.toFixed(1)}`
      ).join("\n");
      $("layout-preview").hidden = false;
      $("layout-note").textContent =
        `Se moverán ${preview.placements.length} objetos. Pendientes después de aplicar: ${preview.pending}. El contenido y los identificadores se conservan.`;
    } catch (error) {
      prepared = undefined;
      $("layout-note").textContent = error.message;
    } finally {
      controls(false);
    }
  };
  $("layouts-form").onsubmit = async (event) => {
    event.preventDefault();
    if (working || !prepared) return;
    try {
      request();
      controls(true);
      setBusy(true);
      $("busy").textContent =
        "Aplicando el diseño a los objetos seleccionados…";
      await api("layouts/apply", prepared);
      $("layouts-dialog").close();
      prepared = undefined;
      controls(false);
      reloadEditor();
    } catch (error) {
      $("layout-note").textContent = error.message;
      controls(false);
      setBusy(false);
    }
  };
  return { open };
}
