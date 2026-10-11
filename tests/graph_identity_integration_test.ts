import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import { graphFlowSignature, sourceGraph } from "../src/source/graphs.ts";
import { scanSource } from "../src/source/mod.ts";
import { fork } from "./helpers/graphs.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("reviewed plain identity acquisition preserves graph flow and combines exact endpoint sync", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-identity-" });
  try {
    const source = dir + "/deck.qmd";
    const text = fork.replace(
      "## Proceso {#flow}\n\n",
      "## Proceso {#flow}\n\nAntes **del** diagrama.\n\n",
    );
    await Deno.writeTextFile(source, text);
    const first = await renderProject(source);
    const doc = structuredClone(first.state.emitted);
    const plain = doc.slides[0].elements.find((element) =>
      typeof element.html === "string" && element.html.startsWith("Antes ")
    )!;
    plain.html = "Antes <b>del</b> diagrama revisado.";
    plain.x = 173;
    const edge = doc.slides[0].elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!;
    edge.from = { el: "right/qb-node", side: "left" };
    await saveProject(source, doc, first.state.revision);
    const plan = await previewSync(source);
    assert(plan.identities?.patches.length === 1);
    assert(plan.graphs?.patches.length === 1);
    assert(plan.result.includes('from="right" to="left"'));
    assert(plan.result.includes("Antes **del** diagrama revisado."));
    assert(!plan.result.includes('bento-element-id="input/paragraph:1"'));
    assert(await Deno.readTextFile(source) === text);
    await applySync(source, plan);
    const final = await renderProject(source);
    assert(final.state.docId === first.state.docId);
    assert(final.state.pending.length === 0);
    const emitted = final.state.emitted.slides[0].elements;
    assert(
      canonical(emitted.find((element) => element.id === plain.id)) ===
        canonical(plain),
    );
    assert(
      canonical(emitted.find((element) => element.id === edge.id)?.from) ===
        canonical(edge.from),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("graph flow accepts only transparent identity wrappers and keeps media and geometry guards", () => {
  const before = fork.replace(
    "## Proceso {#flow}\n\n",
    "## Proceso {#flow}\n\nBefore.\n\n",
  );
  const signature = (text: string) => {
    const source = scanSource(text);
    return graphFlowSignature(source, sourceGraph(source, "graph"));
  };
  const plain = signature(before);
  const pinned = before.replace(
    "Before.",
    '::: {#identity bento-element-id="native-text"}\n\nBefore.\n\n:::',
  );
  assert(signature(pinned) === plain);
  for (
    const changed of [
      pinned.replace(
        'bento-element-id="native-text"',
        'bento-element-id="native-text" h="300"',
      ),
      pinned.replace("#identity", "#identity .semantic-container"),
      pinned.replace("Before.", "![Figure](figure.svg)"),
      pinned.replace("Before.", "`r output`"),
      pinned.replace("Before.", "Before.\n\nSecond paragraph."),
      pinned.replace("Before.", "<!-- unexpected -->\nBefore."),
      pinned.replace(' bento-element-id="native-text"', ""),
    ]
  ) assert(signature(changed) !== plain);
});
