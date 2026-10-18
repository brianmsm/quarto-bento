/** Optional local style sampling; the resulting package still needs import review. */
export function attachDesignAdaptation({ api, designsEditor }) {
  const $ = (id) => document.getElementById(id);
  let generation = 0, busy = false;
  const mapping = $("adaptation-mapping");
  mapping.value = JSON.stringify(
    {
      version: 1,
      name: "diseno-adaptado",
      canvas: ".reveal",
      title: ".slides > section:nth-of-type(2) > h2",
      body: ".slides > section:nth-of-type(2) > p:first-of-type",
      accent: "#156f65",
    },
    null,
    2,
  );
  const changed = () => {
    generation++;
    $("adaptation-report").textContent =
      "Referencia o muestras cambiadas. Prepara un nuevo borrador.";
  };
  mapping.addEventListener("input", changed);
  $("adaptation-file").addEventListener("change", changed);
  $("adaptation-sample").onclick = async () => {
    if (busy) return;
    const file = $("adaptation-file").files[0];
    const current = ++generation;
    busy = true;
    $("adaptation-sample").disabled = true;
    try {
      if (!file) {
        throw new Error("Selecciona la referencia HTML autocontenida.");
      }
      if (file.size > 16 * 1024 * 1024) {
        throw new Error("La referencia supera 16 MiB.");
      }
      const selected = JSON.parse(mapping.value);
      $("adaptation-report").textContent =
        "Leyendo muestras con Chromium local…";
      const html = await file.text();
      if (current !== generation) return;
      const draft = await api("design/adapt", { html, mapping: selected });
      if (current !== generation) return;
      designsEditor.offerPackage(draft.package, draft.report);
      $("adaptation-report").textContent =
        `Borrador preparado con ${draft.report.samples.length} muestras. Las fuentes no se incluyen. Abre el informe de adaptación en el paquete y revisa la importación.`;
    } catch (error) {
      if (current === generation) {
        $("adaptation-report").textContent = error.message;
      }
    } finally {
      busy = false;
      $("adaptation-sample").disabled = false;
    }
  };
}
