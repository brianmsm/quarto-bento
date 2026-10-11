import { applyComponentAction } from "../src/core/component-actions.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import { fork } from "./helpers/graphs.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("reviewed component insertion combines with plain identity and graph endpoints then rebuilds exact native design", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-component-graph-" });
  try {
    const source = dir + "/deck.qmd";
    const text = "---\nqbento-annotations: none\n---\n\n" +
      fork.replace(
        "## Proceso {#flow}\n\n",
        "## Proceso\n\nAntes del diagrama.\n\n",
      );
    await Deno.writeTextFile(source, text);
    let state = (await renderProject(source)).state;
    for (const kind of ["card", "kpi"] as const) {
      state = await applyComponentAction(source, {
        action: "create",
        kind,
        slideId: state.emitted.slides[0].id,
        fields: kind === "card"
          ? { title: "Conclusión β", body: "Contenido aprobado." }
          : { label: "Casos", value: "123", detail: "Valor escrito" },
        revision: state.revision,
        expectedDocId: state.docId,
      });
    }
    const doc = structuredClone(state.emitted);
    const elements = doc.slides[0].elements;
    const paragraph = elements.find((e) => e.html === "Antes del diagrama.")!;
    paragraph.html = "Antes del diagrama revisado.";
    paragraph.x = 170;
    const graphNode = elements.find((e) => e.id === "input/qb-node")!;
    graphNode.x = Number(graphNode.x) + 12;
    graphNode.fill = "#d1eee4";
    const edge = elements.find((e) => e.id === "edge-a/qb-edge")!;
    edge.from = { el: "right/qb-node", side: "left" };
    const backgrounds = state.componentCreations!.map((intent) =>
      elements.find((e) => e.id === intent.backgroundId)!
    );
    backgrounds[0].x = 110;
    backgrounds[0].h = 50;
    backgrounds[1].x = 220;
    backgrounds[1].h = 70;
    state = await saveProject(source, doc, state.revision);
    const plan = await previewSync(source);
    assert(plan.identities && plan.graphs?.patches.length === 1);
    assert(
      plan.structure?.steps.filter((s) =>
        s.operation.type === "insert-component"
      ).length === 2,
    );
    assert(await Deno.readTextFile(source) === text);
    await applySync(source, plan);
    const rendered = await renderProject(source);
    assert(rendered.state.pending.length === 0);
    assert(!rendered.state.componentCreations?.length);
    assert(Object.keys(rendered.state.componentProjections ?? {}).length === 2);
    assert(rendered.state.docId === state.docId);
    const finalElements = rendered.state.emitted.slides[0].elements;
    const retainedIds = [
      paragraph.id,
      ...state.componentCreations!.flatMap(
        (intent) => [
          intent.backgroundId,
          ...intent.members.map((member) => member.nativeId),
        ],
      ),
    ];
    for (const id of retainedIds) {
      assert(
        canonical(finalElements.find((e) => e.id === id)) ===
          canonical(elements.find((e) => e.id === id)),
        "retained design changed: " + id,
      );
    }
    assert(
      canonical(finalElements.find((e) => e.id === edge.id)!.from) ===
        canonical(edge.from),
    );
    assert(finalElements.find((e) => e.id === graphNode.id)!.x === graphNode.x);
    assert(
      finalElements.find((e) => e.id === graphNode.id)!.fill === graphNode.fill,
    );
    await Deno.remove(dir + "/deck.bento.html");
    const rebuilt = await renderProject(source);
    assert(
      canonical(rebuilt.state.emitted) === canonical(rendered.state.emitted),
      "HTML-free rebuild changed native fields",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
