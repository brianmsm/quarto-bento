import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applySlideAction } from "../src/core/slide-actions.ts";
import { canonical } from "../src/state/mod.ts";
import { scanSource, sliceBytes } from "../src/source/mod.ts";
import { previewStructure } from "../src/source/structure.ts";
import {
  applyAnnotations,
  previewAnnotations,
} from "../src/source/annotations.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
Deno.test("default source boundaries match native H1/H2 while explicit slideLevel stays exact", () => {
  const text =
    "---\r\ntitle: Metadata β\r\n---\r\n\r\nPreamble.\r\n\r\n# Chapter β {#chapter}\r\n\r\nLead.\r\n\r\n## Findings {#findings}\r\n\r\n### Detail {#detail}\r\n\r\n:::: {#card .bento-card}\r\n# Card heading {#card-heading}\r\n::::\r\n\r\n```text\r\n# Literal code heading\r\n```\r\n\r\n# Closing {#closing}\r\n\r\nFinal.\r\n";
  const source = scanSource(text);
  eq(source.slides.map((s) => s.id), ["chapter", "findings", "closing"]);
  eq(source.blocks.find((b) => b.id === "detail")?.slideId, "findings");
  eq(source.blocks.find((b) => b.id === "card-heading")?.slideId, "findings");
  eq(
    sliceBytes(text, source.preambleSpan),
    "---\r\ntitle: Metadata β\r\n---\r\n\r\nPreamble.\r\n\r\n",
  );
  eq(
    source.slides.map((s) => sliceBytes(text, s.span)).join(""),
    text.slice(text.indexOf("# Chapter")),
  );
  eq(scanSource(text, { slideLevel: 1 }).slides.map((s) => s.id), [
    "chapter",
    "closing",
  ]);
  eq(scanSource(text, { slideLevel: 2 }).slides.map((s) => s.id), ["findings"]);
  eq(scanSource(text, { slideLevel: 3 }).slides.map((s) => s.id), ["detail"]);
  const annotated = previewAnnotations(source, "minimal", [{
    slideId: "chapter",
    features: ["overrides"],
    references: [".qbento/state.json"],
  }]);
  eq(
    applyAnnotations(text, annotated),
    text.replace("{#chapter}", "{#chapter .qbento-design}"),
  );
  eq(previewAnnotations(scanSource(annotated.result), "none", []).result, text);
  const deleted = previewStructure(source, [{
    type: "delete-slide",
    id: "chapter",
    confirmed: true,
  }]);
  eq(
    deleted.result,
    sliceBytes(text, source.preambleSpan) +
      source.slides.slice(1).map((s) => sliceBytes(text, s.span)).join(""),
  );
  const reordered = previewStructure(source, [{
    type: "reorder-slides",
    ids: ["closing", "chapter", "findings"],
  }]);
  eq(
    reordered.result,
    sliceBytes(text, source.preambleSpan) +
      [2, 0, 1].map((i) => sliceBytes(text, source.slides[i].span)).join(""),
  );
});
Deno.test("mixed ordinary H1/H2 slides preserve metadata, reviewed identities, hide and HTML-free reconstruction", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-h1-boundaries-" });
  const source = dir + "/deck.qmd";
  const producer =
    '```{r}\n#| label: count\n#| include: false\ncat("x",file="counter.txt",append=TRUE)\n```\n';
  const original =
    "---\ntitle: Metadata β\nqbento-annotations: none\n---\n\n# Introduction β\n\nOriginal prose.\n\n```python\nx = 1\n```\n\n$$\nx^{2}+1\n$$\n\n" +
    producer +
    "\n## Results {#results}\n\nResult prose.\n\n### Detail\n\n# Closing {#closing}\n\nFinal prose.\n";
  try {
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    eq(first.state.emitted.title, "Metadata β");
    eq(first.state.emitted.slides.map((s) => s.id), [
      "introduction-β",
      "results",
      "closing",
    ]);
    eq(await Deno.readTextFile(dir + "/counter.txt"), "x");
    const edit = structuredClone(first.state.emitted);
    const body = edit.slides[0].elements.find((e) =>
      e.html === "Original prose."
    )!;
    body.html = "Reviewed prose β.";
    body.x = 219;
    const saved = await saveProject(source, edit, first.state.revision);
    eq(await Deno.readTextFile(source), original);
    const plan = await previewSync(source);
    eq(plan.result.includes(producer), true);
    eq(
      plan.result.startsWith(
        "---\ntitle: Metadata β\nqbento-annotations: none\n---\n",
      ),
      true,
    );
    eq(plan.result.includes("# Introduction β {#introduction-β"), true);
    await applySync(source, plan);
    eq(await Deno.readTextFile(dir + "/counter.txt"), "x");
    const synced = await renderProject(source);
    eq(synced.state.emitted, edit);
    eq(synced.state.pending.length, 0);
    eq(await Deno.readTextFile(dir + "/counter.txt"), "xx");
    const hidden = await applySlideAction(source, {
      action: "hide",
      slideId: "closing",
      revision: synced.state.revision,
    });
    const hiddenRender = await renderProject(source);
    eq(hiddenRender.state.emitted, hidden.emitted);
    eq(hiddenRender.state.emitted.slides[2].hidden, true);
    eq(await Deno.readTextFile(dir + "/counter.txt"), "xxx");
    const rebuilt = dir + "/rebuild";
    await Deno.mkdir(rebuilt + "/.qbento", { recursive: true });
    for (
      const name of ["deck.qmd", ".qbento/project.json", ".qbento/state.json"]
    ) await Deno.copyFile(dir + "/" + name, rebuilt + "/" + name);
    const fresh = await renderProject(rebuilt + "/deck.qmd");
    eq(fresh.state.emitted, hiddenRender.state.emitted);
    eq(fresh.state.docId, first.state.docId);
    eq(fresh.state.pending.length, 0);
    eq(await Deno.readTextFile(rebuilt + "/counter.txt"), "x");
    eq(await Deno.readTextFile(source), plan.result);
    eq(saved.pending.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
