import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("real echoed figures and tables fit cards without losing their producer or source", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-cards-" });
  try {
    const source = dir + "/deck.qmd";
    const qmd = ["figure", "table", "styled"].map((kind) =>
      `## ${kind} {#${kind}}\n\n::: {#${kind}-card .bento-card${
        kind === "styled" ? ' font-size="38" line-height="1.4"' : ""
      }}\n\n\`\`\`{r}\n#| label: ${kind}-producer\n#| echo: true\n#| dev: svg\n${
        kind !== "table"
          ? "plot(1:3)"
          : 'knitr::kable(data.frame(x=1:2), format="pipe")'
      }\n\`\`\`\n\n:::\n`
    ).join("\n");
    await Deno.writeTextFile(source, qmd);
    const rendered = await renderProject(source);
    assert(!rendered.diagnostics.length, JSON.stringify(rendered.diagnostics));
    for (const slide of rendered.state.emitted.slides) {
      const card = slide.elements.find((element) => element.type === "shape")!;
      const code = slide.elements.find((element) => element.type === "code")!;
      const output = slide.elements.find((element) =>
        element.type === (slide.id !== "table" ? "image" : "table")
      )!;
      assert(!!code && !!output, slide.id);
      if (slide.id === "styled") {
        assert(code.fontSize === 38 && Number(code.h) >= 2 * 38 * 1.4);
      }
      assert(Number(output.y) >= Number(code.y) + Number(code.h) + 16);
      assert(
        Number(output.y) + Number(output.h) <=
          Number(card.y) + Number(card.h) - 24,
      );
      for (const element of [code, output]) {
        assert(
          rendered.state
            .provenance[targetKey({ slideId: slide.id, elementId: element.id })]
            .producer === slide.id + "-producer",
        );
      }
    }
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("original column and output-grid options retain all figures and saved visual edits on recomputation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-columns-" });
  try {
    const source = dir + "/deck.qmd";
    const qmd =
      `## Pair {#pair}\n\n::: {#panel .bento-card}\n\n\`\`\`{r}\n#| label: pair-producer\n#| echo: true\n#| output-location: column\n#| bento-code-width: 35\n#| layout-ncol: 2\n#| dev: svg\nd <- read.csv("data.csv")\nx <- d$value\nplot(x)\nplot(rev(x))\n\`\`\`\n\n:::\n`;
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
    const first = await renderProject(source);
    assert(!first.diagnostics.length, JSON.stringify(first.diagnostics));
    const slide = first.state.emitted.slides[0];
    const codes = slide.elements.filter((element) => element.type === "code");
    const figures = slide.elements.filter((element) =>
      element.type === "image"
    );
    assert(figures.length === 2 && figures[0].id !== figures[1].id);
    assert(Number(figures[0].y) === Number(figures[1].y));
    assert(Number(figures[1].x) > Number(figures[0].x));
    assert(
      codes.every((code) =>
        Number(code.x) + Number(code.w) < Number(figures[0].x)
      ),
    );
    const edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.find((element) => element.id === figures[0].id)!
      .opacity = .6;
    await saveProject(source, edited, first.state.revision);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n10\n30\n");
    const next = await renderProject(source);
    const nextFigures = next.state.emitted.slides[0].elements.filter(
      (element) => element.type === "image",
    );
    assert(
      next.state.docId === first.state.docId && next.state.pending.length === 0,
    );
    assert(
      nextFigures[0].opacity === .6 && nextFigures[0].src !== figures[0].src,
    );
    assert(
      JSON.stringify(nextFigures.map((element) => element.id)) ===
        JSON.stringify(figures.map((element) => element.id)),
    );
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("output continuation slides keep their producer and execute a chunk once", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-slide-" });
  try {
    const source = dir + "/deck.qmd";
    const qmd =
      `## Original {#original}\n\n\`\`\`{r}\n#| label: result\n#| echo: true\n#| output-location: slide\n#| dev: svg\ncat("run\\n", file="runs", append=TRUE)\nplot(1:3)\n\`\`\`\n\n::: {#after}\nAfter the chunk.\n:::\n\n## Next {#next}\n\n::: {#next-body}\nNext slide.\n:::\n`;
    await Deno.writeTextFile(source, qmd);
    const first = await renderProject(source);
    assert(!first.diagnostics.length, JSON.stringify(first.diagnostics));
    assert((await Deno.readTextFile(dir + "/runs")) === "run\n");
    const slides = first.state.emitted.slides;
    assert(
      slides.length === 3 && slides[0].id === "original" &&
        slides[1].id.startsWith("qb-output-") && slides[2].id === "next",
    );
    assert(
      slides[0].elements.some((element) => element.html === "After the chunk."),
    );
    const image = slides[1].elements.find((element) =>
      element.type === "image"
    )!;
    assert(
      !!image &&
        first.state
            .provenance[
              targetKey({ slideId: slides[1].id, elementId: image.id })
            ].producer === "result",
    );
    let emptyPlan = false;
    try {
      await previewSync(source);
    } catch (error) {
      emptyPlan = String(error).includes("No pending changes");
    }
    assert(emptyPlan, "A generated output slide must not propose source edits");
    await renderProject(source);
    const loaded = await readProject(source);
    assert(loaded.docId === first.state.docId && loaded.pending.length === 0);
    assert((await Deno.readTextFile(dir + "/runs")) === "run\nrun\n");
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("invalid original output options refuse before executing R", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-refuse-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(
      source,
      '## Test {#test}\n\n```{r}\n#| output-location: fragment\nfile.create("ran")\n```\n',
    );
    let refused = false;
    try {
      await renderProject(source);
    } catch (error) {
      refused = String(error).includes("EXECUTION_LAYOUT");
    }
    assert(refused);
    assert(!await Deno.stat(dir + "/ran").then(() => true, () => false));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("real stdout and figure grids keep text clear of the next row", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-output-mixed-grid-" });
  try {
    const source = dir + "/deck.qmd";
    const qmd = `## Mixed {#mixed}

\`\`\`{r}
#| label: mixed-output
#| echo: false
#| layout-ncol: 2
#| dev: svg
cat(paste0("line", seq_len(10)), sep="\\n")
plot(1:3)
plot(3:1)
plot(2:4)
\`\`\`
`;
    await Deno.writeTextFile(source, qmd);
    const rendered = await renderProject(source);
    const elements = rendered.state.emitted.slides[0].elements;
    const stdout = elements.find((element) => element.type === "code")!;
    const figures = elements.filter((element) => element.type === "image");
    assert(stdout && figures.length === 3);
    assert(stdout.fontSize === 24 && String(stdout.content).includes("line10"));
    assert(Number(figures[1].y) >= Number(stdout.y) + Number(stdout.h) + 20);
    assert(Number(figures[0].h) >= Number(stdout.h));
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
