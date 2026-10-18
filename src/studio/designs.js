/** Human-facing export/import flow for portable Quarto-Bento design packages. */
export function attachReusableDesigns({
  api,
  getState,
  showError,
  saveBefore,
  registryEditor,
  openPreview,
}) {
  const $ = (id) => document.getElementById(id);
  const maxPackageBytes = 262144;
  let selectedPackage, activePlan, planSnapshot, busy = false;
  let selectionGeneration = 0, operationGeneration = 0;

  function note(value) {
    $("design-note").textContent = value;
  }

  function snapshot() {
    const state = getState();
    if (!state?.docId || !Number.isSafeInteger(state.revision)) {
      throw new Error(
        "El proyecto no tiene una revisión verificable. Recarga el proyecto antes de exportar o importar un diseño.",
      );
    }
    return { docId: state.docId, revision: state.revision };
  }

  function assertUnchanged(expected) {
    const current = snapshot();
    if (
      current.docId !== expected.docId || current.revision !== expected.revision
    ) {
      throw new Error(
        "El proyecto cambió durante esta operación. Vuelve a revisar el diseño con la revisión actual.",
      );
    }
  }

  async function saveAndSnapshot() {
    if (registryEditor?.isDirty?.()) {
      throw new Error(
        "Guarda o descarta el borrador de Diseños y temas antes de exportar o importar un diseño.",
      );
    }
    const before = snapshot();
    await saveBefore();
    const after = snapshot();
    if (before.docId !== after.docId) {
      throw new Error(
        "Cambió la identidad del proyecto al guardar. Recarga Studio antes de continuar.",
      );
    }
    if (registryEditor?.isDirty?.()) {
      throw new Error(
        "El borrador de Diseños y temas cambió durante el guardado. Guárdalo o descártalo antes de continuar.",
      );
    }
    return after;
  }

  function validPackage(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function packageLabel(value, fileName) {
    return typeof value?.name === "string" && value.name.trim()
      ? value.name.trim()
      : fileName || "Paquete de diseño";
  }

  function summary(entry) {
    const heading = document.createElement("h3"),
      details = document.createElement("p");
    heading.textContent = "Paquete listo para revisar";
    details.textContent = `Diseño: ${
      packageLabel(entry.value, entry.fileName)
    } · Origen: ${entry.origin}`;
    $("design-plan").replaceChildren(heading, details);
    if (entry.report !== undefined) {
      planSection($("design-plan"), "Informe de adaptación", entry.report);
    }
  }

  function planSection(container, titleText, value, className) {
    const section = document.createElement("details"),
      title = document.createElement("summary"),
      pre = document.createElement("pre");
    title.textContent = titleText;
    pre.textContent = JSON.stringify(value, null, 2);
    if (className) pre.className = className;
    section.append(title, pre);
    container.append(section);
  }

  function showPlan(plan, entry) {
    const container = $("design-plan");
    container.replaceChildren();
    const heading = document.createElement("h3"),
      description = document.createElement("p"),
      operation = document.createElement("p");
    heading.textContent = "Revisión del diseño";
    description.textContent = `Paquete: ${
      packageLabel(plan.package, entry.fileName)
    }. Aplicar reemplazará el registro completo de diseños de este proyecto.`;
    operation.textContent =
      "La operación cambia las definiciones del diseño. Conserva el contenido y los ajustes guardados; después podrás recalcular la presentación.";
    container.append(heading, description, operation);

    const changes = plan.changes;
    const themeSummary = document.createElement("p");
    themeSummary.textContent = `Tema activo: ${
      changes.before.activeTheme ?? "predeterminado"
    } → ${changes.after.activeTheme ?? "predeterminado"}. El paquete propone ${
      Object.keys(changes.after.themes ?? {}).length
    } temas y ${Object.keys(changes.after.layouts ?? {}).length} layouts.`;
    container.append(themeSummary);
    planSection(container, "Registro actual", changes.before, "before");
    planSection(container, "Registro propuesto", changes.after, "after");

    const removed = changes.removed ?? {};
    const definitions = [];
    for (const kind of ["layouts", "themes"]) {
      for (const name of removed[kind] ?? []) {
        const definition = changes.before?.[kind]?.[name];
        definitions.push({ kind, name, definition });
      }
    }
    const removedTitle = document.createElement("h4");
    removedTitle.textContent = definitions.length
      ? "Definiciones que se eliminarán"
      : "Definiciones que se eliminarán: ninguna";
    container.append(removedTitle);
    for (const item of definitions) {
      const section = document.createElement("section"),
        title = document.createElement("h5"),
        pre = document.createElement("pre");
      title.textContent = `${
        item.kind === "layouts" ? "Layout" : "Tema"
      }: ${item.name}`;
      pre.textContent = JSON.stringify(item.definition, null, 2);
      pre.className = "before";
      section.append(title, pre);
      container.append(section);
    }

    const consequence = document.createElement("p");
    consequence.textContent = changes.renderNeeded
      ? "Después de aplicar, pulsa Recalcular para usar este diseño en la presentación."
      : "El registro no requiere recalcular la presentación.";
    container.append(consequence);
    if (entry.report !== undefined) {
      planSection(container, "Informe de adaptación", entry.report);
    }
  }

  function clearPlan() {
    activePlan = undefined;
    planSnapshot = undefined;
    $("design-apply").disabled = true;
  }

  function updateControls() {
    $("design-export").disabled = busy;
    $("design-file").disabled = busy;
    $("design-preview").disabled = busy || !selectedPackage;
    $("design-apply").disabled = busy || !activePlan;
  }

  function setBusy(value) {
    busy = value;
    registryEditor?.setOperationLocked?.(value);
    updateControls();
  }

  function setPackage(value, options = {}) {
    if (!validPackage(value)) {
      throw new Error("El archivo debe contener un objeto JSON de paquete.");
    }
    selectionGeneration++;
    clearPlan();
    selectedPackage = {
      value,
      fileName: options.fileName ?? "",
      origin: options.origin ?? "Archivo local",
      report: options.report,
      generation: selectionGeneration,
    };
    summary(selectedPackage);
    updateControls();
    note("Paquete leído. Revisa la propuesta antes de aplicarlo.");
  }

  async function preview() {
    if (busy || !selectedPackage) return;
    const entry = selectedPackage,
      selection = selectionGeneration,
      operation = ++operationGeneration;
    clearPlan();
    setBusy(true);
    note("Guardando cambios pendientes y preparando la vista previa…");
    try {
      const bound = await saveAndSnapshot();
      if (
        operation !== operationGeneration || selection !== selectionGeneration
      ) {
        return;
      }
      const response = await api("design/preview", { package: entry.value });
      if (
        operation !== operationGeneration || selection !== selectionGeneration
      ) {
        return;
      }
      const plan = response?.plan ?? response;
      if (
        !plan || plan.changes?.operation !== "replace-registry" ||
        plan.docId !== bound.docId ||
        plan.expectedRevision !== bound.revision ||
        !(plan.expectedHash === null ||
          typeof plan.expectedHash === "string") ||
        typeof plan.sourceHash !== "string" ||
        typeof plan.packageHash !== "string" ||
        !Object.hasOwn(plan.changes, "before") ||
        !Object.hasOwn(plan.changes, "after") ||
        !Array.isArray(plan.changes.removed?.layouts) ||
        !Array.isArray(plan.changes.removed?.themes)
      ) {
        throw new Error(
          "La vista previa no coincide con el proyecto guardado. Recarga Studio y vuelve a intentarlo.",
        );
      }
      assertUnchanged(bound);
      if (registryEditor?.isDirty?.()) {
        throw new Error(
          "El borrador de Diseños y temas cambió mientras se preparaba la vista previa. Guárdalo o descártalo y vuelve a revisar.",
        );
      }
      activePlan = plan;
      planSnapshot = bound;
      showPlan(plan, entry);
      if (typeof response.previewError === "string") {
        const warning = document.createElement("p");
        warning.textContent =
          "No se pudo dibujar la muestra con el contenido de ejemplo. El plan sigue disponible; revisa el diseño con tu contenido al recalcular. " +
          response.previewError;
        $("design-plan").prepend(warning);
      }
      if (openPreview && typeof response.previewUrl === "string") {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Ver muestra del diseño";
        button.onclick = () => openPreview(response.previewUrl);
        $("design-plan").prepend(button);
      }
      note(
        "Revisa el registro completo y las definiciones que se eliminarán. Aplicar no modifica QMD ni ejecuta Recalcular.",
      );
    } catch (error) {
      note(error.message);
      showError(error);
    } finally {
      if (operation === operationGeneration) setBusy(false);
    }
  }

  async function exportPackage() {
    if (busy) return;
    const name = $("design-name").value.trim();
    const hasControl = [...name].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || code === 127);
    });
    if (!name || name.length > 120 || hasControl) {
      note("Escribe un nombre de diseño de 1 a 120 caracteres.");
      return;
    }
    const operation = ++operationGeneration;
    setBusy(true);
    note("Guardando cambios pendientes y preparando el archivo…");
    try {
      const bound = await saveAndSnapshot();
      const pkg = await api("design/export", { name });
      if (operation !== operationGeneration) return;
      assertUnchanged(bound);
      if (registryEditor?.isDirty?.()) {
        throw new Error(
          "El borrador de Diseños y temas cambió durante la exportación; no se descargó ningún paquete.",
        );
      }
      if (
        pkg?.format !== "qbento/design" || pkg.version !== 1 ||
        typeof pkg.name !== "string" || !pkg.registry ||
        typeof pkg.registry !== "object"
      ) {
        throw new Error("El servidor devolvió un paquete de diseño no válido.");
      }
      // Match the core package byte limit and the file input's bounded reader.
      const blob = new Blob([JSON.stringify(pkg) + "\n"], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `${
        pkg.name.replace(/[^\p{L}\p{N}._-]+/gu, "-")
      }.qbento-design.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      note(
        `Diseño «${pkg.name}» descargado. El proyecto no se ha recalculado.`,
      );
    } catch (error) {
      note(error.message);
      showError(error);
    } finally {
      if (operation === operationGeneration) setBusy(false);
    }
  }

  async function apply() {
    if (busy || !activePlan || !selectedPackage || !planSnapshot) return;
    const plan = activePlan,
      entry = selectedPackage,
      operation = ++operationGeneration;
    setBusy(true);
    note("Comprobando que el proyecto y el borrador siguen iguales…");
    try {
      const bound = await saveAndSnapshot();
      if (
        operation !== operationGeneration || entry !== selectedPackage ||
        plan !== activePlan
      ) return;
      if (
        bound.docId !== planSnapshot.docId ||
        bound.revision !== planSnapshot.revision
      ) {
        clearPlan();
        throw new Error(
          "El proyecto cambió desde la vista previa. Vuelve a revisar el paquete antes de aplicarlo.",
        );
      }
      const receipt = await api("design/apply", { plan });
      if (operation !== operationGeneration) return;
      if (
        receipt.docId !== bound.docId || receipt.revision !== bound.revision ||
        !receipt.registry
      ) {
        throw new Error(
          "El servidor no confirmó el registro aplicado para la revisión prevista. Recarga el registro antes de continuar.",
        );
      }
      clearPlan();
      selectedPackage = undefined;
      $("design-file").value = "";
      try {
        await registryEditor.reload();
        note(
          "Diseño aplicado y registro recargado. Pulsa Recalcular para actualizar la presentación.",
        );
      } catch (error) {
        note(
          `Diseño aplicado. No se reemplazó el borrador abierto: ${error.message}`,
        );
      }
      $("design-plan").replaceChildren();
    } catch (error) {
      note(error.message);
      showError(error);
    } finally {
      if (operation === operationGeneration) setBusy(false);
    }
  }

  $("design-file").addEventListener("change", async () => {
    const generation = ++selectionGeneration,
      file = $("design-file").files?.[0];
    selectedPackage = undefined;
    clearPlan();
    $("design-plan").replaceChildren();
    updateControls();
    if (!file) {
      note("Elige un archivo .json con un paquete de diseño.");
      return;
    }
    if (file.size > maxPackageBytes) {
      note("El paquete supera el límite de 256 KiB.");
      return;
    }
    note("Leyendo el paquete…");
    try {
      const text = await file.text();
      if (generation !== selectionGeneration) return;
      if (new TextEncoder().encode(text).byteLength > maxPackageBytes) {
        throw new Error("El paquete supera el límite de 256 KiB.");
      }
      const value = JSON.parse(text);
      setPackage(value, { fileName: file.name, origin: "Archivo local" });
    } catch (error) {
      if (generation !== selectionGeneration) return;
      note(`No se pudo leer el paquete: ${error.message}`);
      $("design-plan").replaceChildren();
    }
  });
  $("design-export").addEventListener("click", exportPackage);
  $("design-preview").addEventListener("click", preview);
  $("design-apply").addEventListener("click", apply);
  updateControls();

  return {
    offerPackage(value, report) {
      setPackage(value, {
        origin: "Adaptación preparada",
        report,
      });
    },
  };
}
