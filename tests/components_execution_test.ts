import {
  applyComponentDesign,
  parseDesignAttributes,
} from "../src/render/design.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}

Deno.test("integrated native charts refuse unadapted component placement", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-component-native-" });
  try {
    for (const kind of ["chart"]) {
      const projectDir = `${dir}/${kind}`;
      await Deno.mkdir(projectDir);
      const source = `${projectDir}/deck.qmd`;
      const intent = kind === "chart"
        ? '.bento-chart bento-chart-kind="bar"'
        : "";
      const original = `## Data {#data}

:::: {#card .bento-card}

::: {#values ${intent}}
| | N |
| :--- | ---: |
| Alpha | 12 |
| Beta | 5 |
:::

::::
`;
      await Deno.writeTextFile(source, original);
      await refuses(
        () => renderProject(source),
        "COMPONENT_CONTENT_LAYOUT_UNSUPPORTED",
      );
      assert(await Deno.readTextFile(source) === original);
      try {
        await Deno.stat(`${projectDir}/deck.bento.html`);
        throw new Error("unadapted component was published");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
async function refuses(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(
      String(e).includes(code) || (e as { code?: string }).code === code,
      String(e),
    );
    return;
  }
  throw new Error(`expected ${code}`);
}
Deno.test("two-column cards preserve internal headings, source text and sidecar design through real recomputation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-components-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      '## Results {#results}\n\n::::: {#grid .bento-layout bento-layout-name="two-column"}\n\n:::: {#left .bento-card fill="#eefaff"}\n\n## Internal heading\n\nLiteral β result.\n\n::::\n\n:::: {#right .bento-card}\n\n### Computed figure\n\n```{r}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nplot(read.csv("data.csv")$value)\n```\n\n::::\n\n:::::\n';
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
    const first = await renderProject(source);
    assert(
      first.state.emitted.slides.length === 1,
      "internal H2 became a slide",
    );
    const elements = first.state.emitted.slides[0].elements;
    const left = elements.find((e) => e.id === "left/qb-card-background")!;
    const right = elements.find((e) => e.id === "right/qb-card-background")!;
    assert(
      left.type === "shape" && left.fill === "#eefaff" &&
        Number(right.x) > Number(left.x),
    );
    assert(
      elements.some((e) =>
        e.id === "left/heading:1" && e.html === "Internal heading"
      ),
    );
    const headingProof = first.state
      .provenance[
        targetKey({ slideId: "results", elementId: "left/heading:1" })
      ];
    assert(
      headingProof.source?.kind === "heading" &&
        headingProof.source.blockId === "left/heading:1",
    );
    const figure = elements.find((e) => e.id === "fig-values")!;
    assert(left.w === 544 && left.h === 470 && right.h === 470);
    assert(elements.find((e) => e.id === "left/heading:1")!.fontSize === 32);
    assert(elements.find((e) => e.id === "left/paragraph:1")!.fontSize === 26);
    assert(figure.w === 496 && Number(figure.h) >= 340);
    assert(
      first.state
        .provenance[targetKey({ slideId: "results", elementId: figure.id })]
        .origin === "computed",
    );
    const edited = structuredClone(first.state.emitted);
    const body = edited.slides[0].elements.find((e) =>
      e.id === "left/paragraph:1"
    )!;
    body.html = "Updated literal β result.";
    body.x = 150;
    body.fontSize = 29;
    edited.slides[0].elements.find((e) => e.id === left.id)!.fill = "#ffeeaa";
    edited.slides[0].elements.find((e) => e.id === figure.id)!.x = 711;
    const saved = await saveProject(source, edited, first.state.revision);
    assert(saved.pending.length === 2);
    assert(await Deno.readTextFile(source) === original);
    const plan = await previewSync(source);
    assert(
      plan.patch.patches.length === 1 && plan.attributes?.patches.length === 1,
    );
    assert(
      plan.result ===
        original.replace("Literal β result.", "Updated literal β result.")
          .replace('fill="#eefaff"', 'fill="#ffeeaa"')
          .replace("{#results}", "{#results .qbento-design}"),
    );
    await applySync(source, plan);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n20\n30\n");
    const next = await renderProject(source);
    assert(
      next.state.pending.length === 0 && next.state.docId === first.state.docId,
    );
    const nextBody = next.state.emitted.slides[0].elements.find((e) =>
      e.id === body.id
    )!;
    assert(
      nextBody.x === 150 && nextBody.fontSize === 29 &&
        nextBody.html === body.html,
    );
    const nextFigure = next.state.emitted.slides[0].elements.find((e) =>
      e.id === figure.id
    )!;
    assert(nextFigure.x === 711 && nextFigure.src !== figure.src);
    assert(
      next.state.emitted.slides[0].elements.find((e) => e.id === left.id)!
        .fill === "#ffeeaa",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("explicit parent geometry remains recoverable pending and refuses a guessed parent source patch", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-component-geometry-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      '## Results {#results}\n\n::: {#card .bento-card x="84" y="166" w="530" h="320" font-size="28"}\n\n### Heading\n\nBody.\n\n:::\n';
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    const body = edited.slides[0].elements.find((e) =>
      e.id === "card/paragraph:1"
    )!;
    body.x = 199;
    body.fontSize = 32;
    const saved = await saveProject(source, edited, first.state.revision);
    assert(
      saved.pending.some((p) => p.path[0] === "x") &&
        saved.pending.some((p) => p.path[0] === "fontSize"),
    );
    await refuses(() => previewSync(source), "UNMAPPED_DESIGN");
    assert(await Deno.readTextFile(source) === original);
    const next = await renderProject(source);
    assert(next.state.pending.length === saved.pending.length);
    const kept = (await readProject(source)).emitted.slides[0].elements.find((
      e,
    ) => e.id === body.id)!;
    assert(kept.x === 199 && kept.fontSize === 32);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("displayed bento-code wrapper retains authored fence and safely syncs compatible wrapper attributes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-code-component-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      '## Code {#code}\n\n::: {#example .bento-code x="210" font-size="22"}\n\n```{.python}\nprint("hello")\n```\n\n:::\n';
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    const code = edited.slides[0].elements.find((e) => e.type === "code")!;
    assert(
      code.id === "example/code:1" && code.x === 210 && code.fontSize === 22 &&
        code.grammarName === "python",
    );
    code.content = 'print("world")';
    code.x = 230;
    await saveProject(source, edited, first.state.revision);
    const plan = await previewSync(source);
    assert(
      plan.result ===
        original.replace('print("hello")', 'print("world")').replace(
          'x="210"',
          'x="230"',
        ),
    );
    await applySync(source, plan);
    const next = await renderProject(source);
    assert(
      next.state.pending.length === 0 &&
        next.state.emitted.slides[0].elements.find((e) => e.type === "code")!
            .content === code.content,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("components refuse unknown layouts, missing columns, executable code and competing child geometry", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-component-refusal-" });
  try {
    const source = dir + "/deck.qmd";
    for (
      const [body, code] of [
        [
          ':::: {#grid .bento-layout bento-layout-name="unknown"}\n::: {#left}\nOne.\n:::\n::: {#right}\nTwo.\n:::\n::::\n',
          "UNKNOWN_LAYOUT",
        ],
        [
          ':::: {#grid .bento-layout bento-layout-name="two-column"}\n::: {#left}\nOne.\n:::\n::::\n',
          "LAYOUT_ARITY",
        ],
        [
          "::: {#code .bento-code}\n```{r}\n#| echo: true\nx <- 1\n```\n:::\n",
          "CODE_COMPONENT_CONTENT",
        ],
        [
          ':::: {#card .bento-card}\n::: {#body x="100"}\nBody.\n:::\n::::\n',
          "COMPONENT_CHILD_GEOMETRY",
        ],
      ]
    ) {
      await Deno.writeTextFile(source, `## Results {#results}\n\n${body}`);
      await refuses(() => renderProject(source), code);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("legacy layout names refuse before computation in CLI and installed ordinary Quarto hooks", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-layout-collision-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      '## Results {#results}\n\n:::: {#grid .bento-layout layout="two-column"}\n\n::: {#left}\n\n```{r}\nfile.create("must-not-exist")\n```\n\n:::\n\n::: {#right}\n\nTwo.\n\n:::\n\n::::\n';
    await Deno.writeTextFile(source, original);
    await refuses(
      () => renderProject(source),
      "QUARTO_LAYOUT_ATTRIBUTE_COLLISION",
    );
    await installQuartoProject(source);
    const result = await new Deno.Command("quarto", {
      cwd: dir,
      args: ["render", "deck.qmd"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      !result.success &&
        new TextDecoder().decode(result.stderr).includes(
          "QUARTO_LAYOUT_ATTRIBUTE_COLLISION",
        ),
    );
    assert(await Deno.readTextFile(source) === original);
    try {
      await Deno.stat(dir + "/must-not-exist");
      throw new Error("legacy layout executed producer");
    } catch (e) {
      assert(e instanceof Deno.errors.NotFound);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("layout projects code into the final slot, preserving readable metrics and refusing explicit child styles when a small frame forces fitting", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-layout-code-scale-" });
  try {
    const source = dir + "/deck.qmd";
    const content = Array.from({ length: 8 }, (_, i) => `print(${i})`).join(
      "\n",
    );
    const original =
      `## Code {#code}\n\n:::: {#grid .bento-layout bento-layout-name="two-column"}\n\n::: {#shown .bento-code}\n\n\`\`\`{.python}\n${content}\n\`\`\`\n\n:::\n\n::: {#body}\n\nBody.\n\n:::\n\n::::\n`;
    await Deno.writeTextFile(source, original);
    const result = await renderProject(source);
    const code = result.state.emitted.slides[0].elements.find((e) =>
      e.type === "code"
    )!;
    assert(code.w === 544 && code.fontSize === 24);
    assert(code.h === 270 && code.lineHeight === 1.25);
    assert(
      Number(code.h) >= 8 * Number(code.fontSize) * Number(code.lineHeight),
    );
    const invalid = original.replace(
      "{#shown .bento-code}",
      '{#shown .bento-code font-size="24"}',
    );
    await Deno.writeTextFile(source, invalid);
    const owned = await renderProject(source);
    assert(
      owned.state.emitted.slides[0].elements.find((e) => e.type === "code")!
        .fontSize === 24,
    );
    const small = invalid.replace(
      'bento-layout-name="two-column"',
      'bento-layout-name="two-column" h="180"',
    );
    await Deno.writeTextFile(source, small);
    await refuses(() => renderProject(source), "COMPONENT_CHILD_DESIGN_SCALE");
    assert(await Deno.readTextFile(source) === small);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("card code rows retain all eight lines at native font size and excessive text refuses readable placement", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-card-readable-" });
  try {
    const source = `${dir}/deck.qmd`;
    const content = Array.from({ length: 8 }, (_, i) => `print(${i})`).join(
      "\n",
    );
    const original =
      `## Code {#code}\n\n::::: {#grid .bento-layout bento-layout-name="two-column"}\n\n:::: {#left .bento-card}\n\n### Eight lines\n\n\`\`\`{.python}\n${content}\n\`\`\`\n\n::::\n\n::: {#right}\n\nReadable body.\n\n:::\n\n:::::\n`;
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    const elements = first.state.emitted.slides[0].elements;
    const code = elements.find((e) => e.type === "code")!;
    assert(
      code.fontSize === 24 && code.w === 496 && code.h === 270 &&
        code.content === content,
    );
    assert(elements.find((e) => e.id === "left/heading:1")!.fontSize === 32);
    const excessive = original.replace(
      "Eight lines",
      "A very long heading ".repeat(80),
    );
    await Deno.writeTextFile(source, excessive);
    await refuses(() => renderProject(source), "CARD_CONTENT_OVERFLOW");
    assert(await Deno.readTextFile(source) === excessive);
    assert((await readProject(source)).revision === first.state.revision);
    const nested = original.replace(
      "### Eight lines\n\n```{.python}\n" + content + "\n```",
      "::: {#nested}\n\n" + Array.from({ length: 18 }, (_, i) =>
        `Paragraph ${i}: a long preserved source paragraph with enough words to wrap within the final column width.`)
        .join("\n\n") +
        "\n\n:::\n\nFinal sibling.",
    );
    await Deno.writeTextFile(source, nested);
    await refuses(() =>
      renderProject(source), "CARD_CONTENT_OVERFLOW");
    const styled = original.replace(
      "{#left .bento-card}",
      '{#left .bento-card font-size="48"}',
    );
    await Deno.writeTextFile(source, styled);
    await refuses(() =>
      renderProject(source), "CARD_CONTENT_OVERFLOW");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("component layout rejects native types with unadapted internal metrics", () => {
  for (const type of ["chart", "embed", "svg", "video"]) {
    try {
      applyComponentDesign([[{
        id: "unadapted",
        type,
        x: 80,
        y: 166,
        w: 400,
        h: 300,
      }]], parseDesignAttributes(["card", ["bento-card"], []]));
      throw new Error("unadapted type accepted");
    } catch (e) {
      assert(
        String(e).includes("COMPONENT_CONTENT_LAYOUT_UNSUPPORTED"),
        String(e),
      );
    }
  }
});
