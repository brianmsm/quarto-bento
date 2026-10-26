import { renderProject } from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import { extractDocument } from "../src/render/html.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function figureMime(document: {
  slides: { elements: { type: string; src?: unknown }[] }[];
}) {
  const images = document.slides.flatMap((slide) => slide.elements).filter(
    (element) => element.type === "image",
  );
  assert(images.length === 1, "Expected one actual computed figure");
  return String(images[0].src).match(/^data:([^;,]+)/)?.[1];
}

function qmd(metadata = "", options = "", setup = "") {
  return `---
${metadata}---

## Figure {#figure}

${setup}\`\`\`{r}
#| label: fig-values
#| echo: false
${options}plot(1:3, type="b")
\`\`\`
`;
}

Deno.test("direct render defaults to SVG and preserves authored figure formats and R device settings", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-figure-format-" });
  const cases = [
    { name: "default", mime: "image/svg+xml" },
    { name: "chunk-device", options: "#| dev: png\n", mime: "image/png" },
    {
      name: "chunk-format",
      options: "#| fig-format: png\n",
      mime: "image/png",
    },
    { name: "document", metadata: "fig-format: png\n", mime: "image/png" },
    {
      name: "format",
      metadata: "format:\n  html:\n    fig-format: png\n",
      mime: "image/png",
    },
    {
      name: "project",
      config: "format:\n  html:\n    fig-format: png\n",
      mime: "image/png",
    },
    {
      name: "knitr-options",
      metadata: "knitr:\n  opts_chunk:\n    dev: png\n",
      mime: "image/png",
    },
    {
      name: "programmatic",
      setup:
        '```{r}\n#| label: setup\n#| include: false\nknitr::opts_chunk$set(dev="png")\n```\n\n',
      mime: "image/png",
    },
    {
      name: "metadata-file",
      metadata: "metadata-files: [options.yml]\n",
      metadataFile: "fig-format: retina\n",
      mime: "image/png",
    },
  ];
  try {
    for (const test of cases) {
      const child = directory + "/" + test.name;
      await Deno.mkdir(child);
      const source = child + "/deck.qmd";
      const original = qmd(test.metadata, test.options, test.setup);
      await Deno.writeTextFile(source, original);
      if (test.config) {
        await Deno.writeTextFile(child + "/_quarto.yml", test.config);
      }
      if (test.metadataFile) {
        await Deno.writeTextFile(child + "/options.yml", test.metadataFile);
      }
      const rendered = await renderProject(source);
      assert(
        figureMime(rendered.state.emitted) === test.mime,
        `${test.name}: ${figureMime(rendered.state.emitted)}`,
      );
      assert(await Deno.readTextFile(source) === original, test.name);
      if (test.config) {
        assert(
          await Deno.readTextFile(child + "/_quarto.yml") === test.config,
          test.name,
        );
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("installed ordinary Quarto keeps the SVG default and explicit project PNG override", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-figure-hook-" });
  try {
    for (const format of [undefined, "png"]) {
      const child = directory + "/" + (format ?? "default");
      await Deno.mkdir(child);
      const source = child + "/deck.qmd", original = qmd();
      await Deno.writeTextFile(source, original);
      await installQuartoProject(source);
      if (format) {
        await Deno.writeTextFile(
          child + "/_quarto.yml",
          "project:\n  type: qbento\nformat:\n  qbento-html:\n    fig-format: png\n",
        );
      }
      const result = await new Deno.Command("quarto", {
        cwd: child,
        args: ["render", "deck.qmd"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(result.success, new TextDecoder().decode(result.stderr));
      const document = extractDocument(
        await Deno.readTextFile(child + "/deck.bento.html"),
      );
      assert(figureMime(document) === (format ? "image/png" : "image/svg+xml"));
      assert(await Deno.readTextFile(source) === original);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("an explicit unavailable R device fails without replacing the previous figure publication", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-figure-device-" });
  try {
    const source = directory + "/deck.qmd";
    await Deno.writeTextFile(source, qmd());
    await renderProject(source);
    const output = await Deno.readTextFile(directory + "/deck.bento.html");
    const state = await Deno.readTextFile(directory + "/.qbento/state.json");
    const original = qmd("", "#| dev: qbento-unavailable-device\n");
    await Deno.writeTextFile(source, original);
    try {
      await renderProject(source);
      throw new Error("Unavailable device was silently replaced");
    } catch (error) {
      assert(String(error).includes("QUARTO_FAILED"), String(error));
    }
    assert(await Deno.readTextFile(source) === original);
    assert(await Deno.readTextFile(directory + "/deck.bento.html") === output);
    assert(
      await Deno.readTextFile(directory + "/.qbento/state.json") === state,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
