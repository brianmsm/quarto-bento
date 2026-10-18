/** Studio form editor: explicit registry Save, independent of native deck edits. */
export function attachRegistryEditor({ api, getState, showError }) {
  const $ = (id) => document.getElementById(id);
  let snapshot, saving = false, loading = false, dirty = false, serial = 0;
  let operationLocked = false;
  const note = (text) => {
    $("registry-note").textContent = text;
  };
  function changed() {
    dirty = true;
    note(
      "Cambios de diseño sin guardar. Cerrar conserva este borrador en la pestaña.",
    );
  }
  function field(label, value, options = {}) {
    const node = document.createElement("label"),
      input = document.createElement("input");
    input.id = "registry-field-" + (++serial);
    node.htmlFor = input.id;
    node.append(document.createTextNode(label));
    input.value = String(value);
    input.required = true;
    Object.assign(input, options);
    input.oninput = changed;
    node.append(input);
    return { node, input };
  }
  function advancedField(label, value, help) {
    const node = document.createElement("label"),
      input = document.createElement("textarea"),
      hint = document.createElement("small");
    input.id = "registry-field-" + (++serial);
    node.htmlFor = input.id;
    node.append(document.createTextNode(label));
    input.value = value === undefined ? "" : JSON.stringify(value, null, 2);
    input.rows = 4;
    input.spellcheck = false;
    input.setAttribute("aria-describedby", input.id + "-help");
    input.oninput = changed;
    hint.id = input.id + "-help";
    hint.textContent = help;
    node.append(input, hint);
    return { node, input };
  }
  function activeOptions(rename) {
    const select = $("registry-active"), current = rename ?? select.value;
    select.replaceChildren(
      new Option("Selecciona un tema (o ninguno si no hay temas)", ""),
    );
    for (const row of $("registry-themes").children) {
      select.add(new Option(row.fields.name.value, row.fields.name.value));
    }
    select.value = current;
  }
  function addRow(kind, name, definition) {
    const root = $("registry-" + kind),
      row = document.createElement("fieldset");
    row.className = "registry-row";
    const legend = document.createElement("legend");
    legend.textContent = kind === "layouts"
      ? "Layout con nombre"
      : "Tema con nombre";
    row.append(legend);
    row.fields = {};
    const add = (key, label, value, options) => {
      const item = field(label, value, options);
      row.fields[key] = item.input;
      row.append(item.node);
    };
    add("name", "Nombre", name, {
      maxLength: 64,
      pattern: "[a-z][a-z0-9\\-]{0,63}",
    });
    if (kind === "layouts") {
      add("columns", "Columnas", definition.columns, {
        type: "number",
        min: "1",
        max: "6",
        step: "1",
      });
      add("gap", "Separación (px)", definition.gap, {
        type: "number",
        min: "0",
        max: "1000",
        step: "any",
      });
      add("padding", "Margen interior (px)", definition.padding, {
        type: "number",
        min: "0",
        max: "1000",
        step: "any",
      });
    } else {
      for (
        const [key, label] of [["background", "Fondo"], ["color", "Texto"], [
          "accent",
          "Acento",
        ], ["fontFamily", "Familia tipográfica"]]
      ) {
        add(key, label, definition[key], {
          maxLength: key === "fontFamily" ? 200 : 100,
        });
      }
      const advanced = document.createElement("details"),
        summary = document.createElement("summary"),
        fields = document.createElement("div");
      advanced.className = "registry-advanced";
      summary.textContent = "Propiedades avanzadas (JSON)";
      fields.className = "registry-advanced-fields";
      fields.append(
        ...[
          [
            "styles",
            "Estilos (JSON)",
            "Estilos nativos estructurados del tema.",
          ],
          [
            "namedStyles",
            "Estilos con nombre (JSON)",
            "Estilos reutilizables con nombre incluidos en este tema.",
          ],
          ["variants", "Variantes (JSON)", "Variantes visuales del tema."],
        ].map(([key, label, help]) => {
          const item = advancedField(label, definition[key], help);
          row.fields[key] = item.input;
          return item.node;
        }),
      );
      const variant = field(
        "Variante predeterminada",
        definition.defaultVariant ?? "",
        {
          maxLength: 64,
          required: false,
        },
      );
      row.fields.defaultVariant = variant.input;
      variant.node.append(
        document.createTextNode(
          "Nombre de la variante que se activa por defecto.",
        ),
      );
      fields.append(variant.node);
      advanced.append(summary, fields);
      row.append(advanced);
      let previous = name;
      row.fields.name.addEventListener("input", () => {
        const active = $("registry-active").value === previous
          ? row.fields.name.value
          : $("registry-active").value;
        previous = row.fields.name.value;
        activeOptions(active);
      });
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = kind === "layouts"
      ? "Eliminar layout"
      : "Eliminar tema";
    remove.onclick = () => {
      row.remove();
      activeOptions();
      changed();
    };
    row.append(remove);
    root.append(row);
  }
  function display(value) {
    $("registry-layouts").replaceChildren();
    $("registry-themes").replaceChildren();
    for (const [name, definition] of Object.entries(value.layouts ?? {})) {
      addRow("layouts", name, definition);
    }
    for (const [name, definition] of Object.entries(value.themes ?? {})) {
      addRow("themes", name, definition);
    }
    activeOptions(value.activeTheme ?? "");
    dirty = false;
  }
  function controlsDisabled(value) {
    const disabled = value || operationLocked;
    $("designs").disabled = disabled;
    for (
      const node of $("registry-form").querySelectorAll(
        "input, select, textarea, button",
      )
    ) node.disabled = disabled;
  }
  async function load() {
    if (loading || saving) return;
    loading = true;
    controlsDisabled(true);
    note("Cargando el registro…");
    try {
      const next = await api("design-registry"), state = getState();
      if (next.docId !== state.docId || next.revision !== state.revision) {
        throw new Error(
          "Otra pestaña cambió el proyecto. Recarga el proyecto antes de editar sus diseños.",
        );
      }
      snapshot = next;
      display(next.registry);
      note(
        "Registro cargado. Guardar diseños no modifica QMD ni ejecuta cálculos.",
      );
    } finally {
      loading = false;
      controlsDisabled(false);
    }
  }
  function serialize() {
    const registry = { schemaVersion: 1 };
    for (const kind of ["layouts", "themes"]) {
      const result = Object.create(null);
      for (const row of $("registry-" + kind).children) {
        const { name, ...fields } = row.fields;
        if (Object.hasOwn(result, name.value)) {
          throw new Error(`El nombre ${name.value} está repetido.`);
        }
        const definition = Object.fromEntries(
          Object.entries(fields).map((
            [key, input],
          ) => [
            key,
            input.type === "number" ? Number(input.value) : input.value,
          ]),
        );
        if (kind === "themes") {
          for (const key of ["styles", "namedStyles", "variants"]) {
            const raw = fields[key].value.trim();
            if (!raw) {
              delete definition[key];
              continue;
            }
            try {
              definition[key] = JSON.parse(raw);
            } catch {
              throw new Error(
                `${key} de ${name.value} debe contener JSON válido.`,
              );
            }
          }
          if (!fields.defaultVariant.value.trim()) {
            delete definition.defaultVariant;
          }
        }
        result[name.value] = definition;
      }
      if (Object.keys(result).length) registry[kind] = result;
    }
    if ($("registry-active").value) {
      registry.activeTheme = $("registry-active").value;
    }
    if (registry.themes && !registry.activeTheme) {
      throw new Error(
        "Selecciona explícitamente el tema activo antes de guardar.",
      );
    }
    return registry;
  }
  $("designs").onclick = async () => {
    try {
      if (loading || saving) return;
      if (!snapshot || !dirty) await load();
      $("registry-dialog").showModal();
      if (dirty) {
        note(
          "Borrador conservado. Guardar comprobará si el proyecto o el registro cambiaron.",
        );
      }
    } catch (error) {
      showError(error);
    }
  };
  $("registry-add-layout").onclick = () => {
    if ($("registry-layouts").children.length >= 64) {
      note("Se admiten como máximo 64 layouts.");
      return;
    }
    let index = 1;
    while (
      [...$("registry-layouts").children].some((row) =>
        row.fields.name.value === "layout-" + index
      )
    ) index++;
    addRow("layouts", "layout-" + index, { columns: 2, gap: 32, padding: 0 });
    changed();
  };
  $("registry-add-theme").onclick = () => {
    if ($("registry-themes").children.length >= 32) {
      note("Se admiten como máximo 32 temas.");
      return;
    }
    let index = 1;
    while (
      [...$("registry-themes").children].some((row) =>
        row.fields.name.value === "tema-" + index
      )
    ) index++;
    addRow("themes", "tema-" + index, {
      background: "#ffffff",
      color: "#172a35",
      accent: "#156f65",
      fontFamily: "Arial, sans-serif",
    });
    activeOptions();
    changed();
  };
  $("registry-active").onchange = changed;
  $("registry-reload").onclick = async () => {
    try {
      await load();
    } catch (error) {
      note(error.message);
    }
  };
  $("registry-form").onsubmit = async (event) => {
    event.preventDefault();
    if (saving || loading || !snapshot) return;
    try {
      const registry = serialize();
      saving = true;
      controlsDisabled(true);
      try {
        const next = await api("design-registry", {
          registry,
          expectedDocId: snapshot.docId,
          expectedRevision: snapshot.revision,
          expectedHash: snapshot.hash,
        });
        snapshot = next;
        dirty = false;
        note(
          "Diseños guardados. Recalcular aplicará los valores seleccionados conservando tu diseño guardado y los cambios pendientes.",
        );
      } finally {
        saving = false;
        controlsDisabled(false);
      }
    } catch (error) {
      note(
        error.message +
          " El borrador se conserva.",
      );
    }
  };
  $("registry-close").onclick = () => {
    if (!saving && !loading) $("registry-dialog").close();
  };
  $("registry-dialog").addEventListener("cancel", (event) => {
    if (saving || loading) event.preventDefault();
  });
  addEventListener("beforeunload", (event) => {
    if (dirty || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return {
    isDirty: () => dirty,
    setOperationLocked: (value) => {
      operationLocked = Boolean(value);
      controlsDisabled(loading || saving);
    },
    reload: async () => {
      if (dirty) {
        throw new Error(
          "Guarda o descarta el borrador de Diseños y temas antes de recargar el registro.",
        );
      }
      await load();
      return snapshot;
    },
  };
}
