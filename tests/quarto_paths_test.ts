import { basename, resolve } from "node:path";
import { installQuartoProject } from "../src/integration/install.ts";
import { captureProject } from "../src/core/project.ts";
import { extractDocument, spliceDocument } from "../src/render/html.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("ordinary Quarto hooks handle spaces and quotes without bypassing preflight", async () => {
  const root = await Deno.makeTempDir({ prefix: "qbento-quarto-paths-" });
  const directory = resolve(root, `project with spaces 'quoted' "double"`);
  const source = resolve(
    directory,
    `slides with spaces 'quoted' "double" β café.qmd`,
  );
  const output = source.replace(/\.qmd$/, ".bento.html");
  try {
    await Deno.mkdir(directory);
    const qmd = `## Results {#results}

::: {#body}
Paths are arguments, not shell commands.
:::

\`\`\`{r}
#| label: fig-values
#| echo: false
#| dev: svg
cat("execution\\n", file="executions.txt", append=TRUE)
values <- read.csv("data.csv")
plot(values$x, values$y, type="b", col="#156f65", pch=19)
\`\`\`
`;
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(resolve(directory, "data.csv"), "x,y\n1,2\n2,3\n");
    await installQuartoProject(source);
    const render = async (args: string[]) => {
      const result = await new Deno.Command("quarto", {
        cwd: directory,
        args: ["render", ...args],
        env: {
          XDG_CACHE_HOME: resolve(root, "cache"),
          QUARTO_RUN_NO_NETWORK: "true",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: result.success,
        log: new TextDecoder().decode(result.stdout) +
          new TextDecoder().decode(result.stderr),
      };
    };
    const count = async () =>
      (await Deno.readTextFile(resolve(directory, "executions.txt"))).trim()
        .split("\n").length;

    let result = await render([]);
    assert(result.success, result.log);
    assert(await count() === 1, "ordinary project render executed twice");
    const html = await Deno.readTextFile(output);
    const original = extractDocument(html);
    const image = original.slides[0].elements.find((element) =>
      element.type === "image" || element.type === "svg"
    );
    assert(image, "computed figure missing");
    const originalContent = image.src ?? image.svg;
    image.x = 481;
    const edited = spliceDocument(html, original);
    await Deno.writeTextFile(output, edited);

    result = await render([basename(source)]);
    assert(
      !result.success && result.log.includes("UNCAPTURED_HTML"),
      result.log,
    );
    assert(await count() === 1, "uncaptured edit guard ran after execution");
    assert(
      await Deno.readTextFile(output) === edited,
      "native edits overwritten",
    );

    await captureProject(source);
    result = await render([
      basename(source),
      "--output",
      basename(output),
    ]);
    assert(
      !result.success && result.log.includes("UNSAFE_QUARTO_ARGUMENT"),
      result.log,
    );
    assert(await count() === 1, "unsafe output override executed a chunk");
    assert(await Deno.readTextFile(output) === edited);

    await Deno.writeTextFile(resolve(directory, "data.csv"), "x,y\n1,8\n2,1\n");
    result = await render([basename(source), "--to", "qbento-html"]);
    assert(result.success, result.log);
    assert(await count() === 2, "recompute executed twice");
    const next = extractDocument(await Deno.readTextFile(output));
    const nextImage = next.slides[0].elements.find((element) =>
      element.id === image.id
    );
    assert(next.docId === original.docId);
    assert(nextImage?.x === 481, "captured geometry lost");
    assert(
      JSON.stringify(nextImage?.src ?? nextImage?.svg) !==
        JSON.stringify(originalContent),
      "figure was not recomputed",
    );
    assert(
      await Deno.readTextFile(source) === qmd,
      "QMD changed during render",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ordinary Quarto producer mapping accepts double-quoted Unicode basenames", async () => {
  const root = await Deno.makeTempDir({ prefix: "qbento-quarto-quoted-path-" });
  const directory = resolve(root, "project with 'quoted' path");
  const source = resolve(
    directory,
    "slides with spaces 'single' \"double\" β café.qmd",
  );
  const output = source.replace(/\.qmd$/, ".bento.html");
  const qmd = `# Quoted source path {#quoted-source-path}

\`\`\`{r}
#| label: path-proof
#| echo: false
#| include: false
cat("executed\\n", file="executions.txt", append=TRUE)
\`\`\`
`;
  try {
    await Deno.mkdir(directory);
    await Deno.writeTextFile(source, qmd);
    await installQuartoProject(source);
    const result = await new Deno.Command("quarto", {
      cwd: directory,
      args: ["render", basename(source)],
      env: {
        XDG_CACHE_HOME: resolve(root, "cache"),
        QUARTO_RUN_NO_NETWORK: "true",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const log = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    assert(result.success, log);
    assert((await Deno.stat(output)).size > 0, "rendered Bento output missing");
    assert(
      await Deno.readTextFile(resolve(directory, "executions.txt")) ===
        "executed\n",
      "quoted Unicode source should execute exactly once",
    );
    assert(
      await Deno.readTextFile(source) === qmd,
      "render should preserve the original QMD path and contents",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
