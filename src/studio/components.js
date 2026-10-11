/** Explicit roles and durable recovery, using the saved project revision. */
export function attachComponentEditor(
  { api, getState, saveBefore, setBusy, reloadEditor, showError },
) {
  const $ = (id) => document.getElementById(id);
  let snapshot, submitting = false;
  const labels = {
    title: "Título",
    body: "Cuerpo",
    label: "Etiqueta",
    value: "Valor escrito",
    detail: "Detalle (opcional)",
  };
  function showFields() {
    $("component-fields").replaceChildren();
    const roles = $("component-kind").value === "card"
      ? ["title", "body"]
      : ["label", "value", "detail"];
    for (const role of roles) {
      const label = document.createElement("label");
      label.textContent = labels[role];
      const input = document.createElement(
        role === "body" || role === "detail" ? "textarea" : "input",
      );
      input.name = role;
      input.dataset.role = role;
      input.maxLength = 6000;
      input.required = role !== "detail";
      label.append(input);
      $("component-fields").append(label);
    }
  }
  function checkedSnapshot() {
    const current = getState();
    if (
      !snapshot || snapshot.docId !== current?.docId ||
      snapshot.revision !== current?.revision
    ) {
      throw new Error(
        "El proyecto cambió desde que abriste este diálogo. Ciérralo y vuelve a abrir Añadir componente.",
      );
    }
    return current;
  }
  function actionControls(disabled) {
    submitting = disabled;
    for (
      const input of $("component-dialog").querySelectorAll(
        "button, input, textarea, select",
      )
    ) input.disabled = disabled;
  }
  async function run(action) {
    if (submitting) return;
    try {
      const current = checkedSnapshot();
      actionControls(true);
      setBusy(true);
      $("busy").textContent = "Guardando componente en el proyecto…";
      await api("components/action", {
        ...action,
        revision: current.revision,
        expectedDocId: current.docId,
      });
      $("component-dialog").close();
      reloadEditor();
    } catch (error) {
      $("component-note").textContent = error.message;
      setBusy(false);
      showError(error);
    } finally {
      actionControls(false);
    }
  }
  function showPending() {
    $("component-pending").replaceChildren();
    for (const intent of snapshot.componentCreations ?? []) {
      const section = document.createElement("section"),
        title = document.createElement("h4");
      const first = intent.members[0].snapshot.html.replace(/<[^>]*>/g, "");
      title.textContent = `${
        intent.kind === "card" ? "Tarjeta" : "Indicador"
      }: ${first}`;
      section.append(title);
      const slide = snapshot.emitted.slides.find((slide) =>
        slide.id === intent.slideId
      );
      const ids = [
        intent.backgroundId,
        ...intent.members.map((member) => member.nativeId),
      ];
      const missing = ids.filter((id) =>
        !slide?.elements.some((element) => element.id === id)
      );
      const background = slide?.elements.find((element) =>
        element.id === intent.backgroundId
      );
      const invalid = !!background &&
          (background.type !== "shape" || background.shape !== "rect") ||
        slide?.elements.some((element) =>
          intent.members.some((member) => member.nativeId === element.id) &&
          element.type !== "text"
        );
      const extra = slide?.elements.some((element) =>
        element.groupId === intent.id && !ids.includes(element.id)
      );
      const note = document.createElement("p");
      note.textContent = !slide
        ? "Su diapositiva está pendiente de eliminación. Restáurala en Diapositivas o revisa su eliminación para resolver este componente."
        : missing.length
        ? "Componente incompleto. Restaurar recupera los miembros ausentes con su último contenido y diseño guardados; conserva los que siguen presentes."
        : invalid || extra
        ? "El tipo de algún miembro cambió o hay objetos adicionales en el grupo. Puedes resolverlos en Bento o descartar esta creación pendiente."
        : "Creación pendiente. Revisar cambios mostrará su inserción completa en QMD.";
      section.append(note);
      if (slide && missing.length) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.textContent = "Restaurar componente incompleto";
        restore.onclick = () => run({ action: "restore", id: intent.id });
        section.append(restore);
      }
      const discard = document.createElement("button");
      discard.type = "button";
      discard.textContent = "Descartar componente pendiente";
      discard.onclick = () => run({ action: "discard", id: intent.id });
      section.append(discard);
      $("component-pending").append(section);
    }
    $("component-pending-title").hidden = !snapshot.componentCreations?.length;
  }
  $("components").onclick = async () => {
    if (submitting) return;
    setBusy(true);
    $("busy").textContent = "Guardando cambios antes de añadir un componente…";
    try {
      await saveBefore();
      snapshot = await api("state");
      checkedSnapshot();
      $("component-slide").replaceChildren();
      for (
        const slide of snapshot.emitted.slides.filter((slide) =>
          snapshot.generatedBaseline.slides.some((baseline) =>
            baseline.id === slide.id
          )
        )
      ) {
        const option = document.createElement("option");
        option.value = slide.id;
        option.textContent = slide.name || slide.id;
        $("component-slide").append(option);
      }
      $("component-kind").value = "card";
      showFields();
      showPending();
      $("component-note").textContent = "";
      $("component-dialog").showModal();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  $("component-kind").onchange = showFields;
  $("component-form").onsubmit = async (event) => {
    event.preventDefault();
    const fields = {};
    for (
      const input of $("component-fields").querySelectorAll("input, textarea")
    ) {
      if (input.name !== "detail" || input.value.trim()) {
        fields[input.name] = input.value;
      }
    }
    await run({
      action: "create",
      kind: $("component-kind").value,
      slideId: $("component-slide").value,
      fields,
    });
  };
  $("component-close").onclick = () => {
    if (!submitting) $("component-dialog").close();
  };
  $("component-dialog").addEventListener("cancel", (event) => {
    if (submitting) event.preventDefault();
  });
}
