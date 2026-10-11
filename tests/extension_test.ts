import { resolve } from "node:path";
import { installQuartoProject } from "../src/integration/install.ts";
import {
  captureProject,
  readProject,
  renderProject,
} from "../src/core/project.ts";
import { extractDocument, spliceDocument } from "../src/render/html.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(String(e).includes(code), String(e));
    return;
  }
  throw new Error(`expected ${code}`);
}
async function fixture() {
  const directory = await Deno.makeTempDir({ prefix: "qbento-extension-" });
  const source = resolve(directory, "presentation.qmd");
  await Deno.writeTextFile(
    source,
    `---
title: Extension execution
---

## Results {#results}

::: {#finding}
The figure updates when the data change.
:::

\`\`\`{r}
#| label: fig-values
#| echo: false
#| dev: svg
cat("execution\\n", file="executions.txt", append=TRUE)
values <- read.csv("data.csv")
plot(values$x, values$y, type="b", col="#156f65", pch=19)
\`\`\`

## Conclusion {#conclusion}

::: {#closing}
Source and design remain independent.
:::
`,
  );
  await Deno.writeTextFile(
    resolve(directory, "data.csv"),
    "x,y\n1,2\n2,3\n3,5\n",
  );
  await installQuartoProject(source);
  return { directory, source, output: source.replace(/\.qmd$/, ".bento.html") };
}
async function render(directory: string, extra: string[] = []) {
  const result = await new Deno.Command("quarto", {
    cwd: directory,
    args: ["render", "presentation.qmd", ...extra],
    env: {
      XDG_CACHE_HOME: resolve(directory, "cache"),
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
}
async function count(directory: string) {
  return (await Deno.readTextFile(resolve(directory, "executions.txt"))).trim()
    .split("\n").length;
}
Deno.test("extension installer is offline and refuses to replace user configuration", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = resolve(dir, "deck.qmd");
    await Deno.writeTextFile(source, "## Test\n");
    await Deno.writeTextFile(
      resolve(dir, "_quarto.yml"),
      "project:\n  type: website\n",
    );
    await rejects(() => installQuartoProject(source), "QUARTO_CONFIG_EXISTS");
    assert(
      (await Deno.readTextFile(resolve(dir, "_quarto.yml"))).includes(
        "website",
      ),
    );
    await installQuartoProject(source, { configure: false });
    assert(
      (await Deno.stat(
        resolve(dir, "_extensions/qbento/runtime/vendor/bento/LICENSE"),
      )).isFile,
    );
    await rejects(
      () => installQuartoProject(source, { configure: false }),
      "QUARTO_EXTENSION_EXISTS",
    );
    assert(await Deno.readTextFile(source) === "## Test\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("ordinary quarto render executes once, protects uncaptured HTML, and retains design on recompute", async () => {
  const f = await fixture();
  try {
    let result = await render(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 1, "execution ran more than once");
    const html = await Deno.readTextFile(f.output);
    const original = extractDocument(html);
    const image = original.slides[0].elements.find((e) =>
      e.type === "image" || e.type === "svg"
    );
    assert(image, "executed figure missing");
    const priorContent = JSON.stringify(image);
    image.x = 503;
    image.y = 99;
    image.w = 550;
    image.h = 300;
    const edited = spliceDocument(html, original);
    await Deno.writeTextFile(f.output, edited);
    result = await render(f.directory);
    assert(
      !result.success && result.log.includes("UNCAPTURED_HTML"),
      result.log,
    );
    assert(await Deno.readTextFile(f.output) === edited, "native edits lost");
    assert(await count(f.directory) === 1, "guard should precede execution");
    await captureProject(f.source);
    await Deno.writeTextFile(
      resolve(f.directory, "data.csv"),
      "x,y\n1,9\n2,1\n3,7\n",
    );
    result = await render(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 2);
    const next = extractDocument(await Deno.readTextFile(f.output));
    const nextImage = next.slides[0].elements.find((e) => e.id === image.id);
    assert(next.docId === original.docId);
    assert(nextImage?.x === 503 && nextImage.y === 99 && nextImage.w === 550);
    // Compare generated content alone, not geometry which was deliberately edited.
    const oldParsed = JSON.parse(priorContent);
    assert(
      JSON.stringify(nextImage?.src ?? nextImage?.svg) !==
        JSON.stringify(oldParsed.src ?? oldParsed.svg),
      "computed SVG did not change",
    );
    const sourceBefore = await Deno.readTextFile(f.source);
    await Deno.remove(f.output);
    result = await render(f.directory);
    assert(result.success, result.log);
    assert(
      extractDocument(await Deno.readTextFile(f.output)).docId ===
        original.docId,
    );
    assert(await Deno.readTextFile(f.source) === sourceBefore);
    assert((await readProject(f.source)).overrides.length > 0);
    // CLI's internal execution skips inherited pre/post hooks, avoiding recursion.
    await renderProject(f.source);
    assert(await count(f.directory) === 4);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("preflight rejects final output override even with --to html", async () => {
  const f = await fixture();
  try {
    assert((await render(f.directory)).success);
    const prior = await Deno.readTextFile(f.output);
    const result = await render(f.directory, [
      "--to",
      "html",
      "--output",
      "presentation.bento.html",
    ]);
    assert(
      !result.success && result.log.includes("UNSAFE_QUARTO_ARGUMENT"),
      result.log,
    );
    assert(
      await Deno.readTextFile(f.output) === prior,
      "unsafe output override replaced the deck",
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("preflight rejects metadata/output/format overrides before executing any chunk", async () => {
  const f = await fixture();
  try {
    assert((await render(f.directory)).success);
    const original = await Deno.readTextFile(f.output);
    for (
      const flags of [
        ["--output", "presentation.bento.html"],
        ["-o", "presentation.bento.html"],
        ["--output=presentation.bento.html"],
        ["--output-dir", "/tmp"],
        ["-M", "output-file:presentation.bento.html"],
        ["--metadata", "output-file:presentation.bento.html"],
        ["--to", "html"],
      ]
    ) {
      const result = await render(f.directory, flags);
      assert(
        !result.success && result.log.includes("UNSAFE_QUARTO_ARGUMENT"),
        result.log,
      );
      assert(await Deno.readTextFile(f.output) === original);
      assert(await count(f.directory) === 1, "unsafe flags executed a chunk");
    }
    const text = await Deno.readTextFile(f.source);
    await Deno.writeTextFile(
      f.source,
      text.replace(
        "title: Extension execution",
        "title: Extension execution\noutput-file: presentation.bento.html",
      ),
    );
    const result = await render(f.directory);
    assert(
      !result.success && result.log.includes("UNSAFE_QUARTO_OUTPUT"),
      result.log,
    );
    assert(await Deno.readTextFile(f.output) === original);
    assert(await count(f.directory) === 1);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("failed execution retains baseline and explicit recovery clears only the stopped run", async () => {
  const { recoverQuartoRender } = await import("../src/integration/quarto.ts");
  const f = await fixture();
  try {
    assert((await render(f.directory)).success);
    const original = await Deno.readTextFile(f.output);
    const text = await Deno.readTextFile(f.source);
    await Deno.writeTextFile(
      f.source,
      text.replace(
        'values <- read.csv("data.csv")',
        'stop("test failure")\nvalues <- read.csv("data.csv")',
      ),
    );
    const result = await render(f.directory);
    assert(!result.success && result.log.includes("test failure"), result.log);
    assert(await Deno.readTextFile(f.output) === original);
    const receipt = JSON.parse(
      await Deno.readTextFile(resolve(f.directory, ".qbento/quarto-run.json")),
    );
    assert(receipt.backupHash && Number.isInteger(receipt.process.pid));
    const pending = await render(f.directory);
    assert(
      !pending.success && pending.log.includes("QUARTO_RENDER_PENDING"),
      pending.log,
    );
    const recovered = await recoverQuartoRender(f.source);
    assert(recovered.restored && recovered.retainedOutput === null);
    assert(await Deno.readTextFile(f.output) === original);
    await Deno.writeTextFile(f.source, text);
    assert(
      (await render(f.directory, ["--to", "qbento-html", "--quiet"])).success,
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("native HTML saved during execution survives post-render refusal and recovery", async () => {
  const { recoverQuartoRender } = await import("../src/integration/quarto.ts");
  const f = await fixture();
  try {
    assert((await render(f.directory)).success);
    const text = await Deno.readTextFile(f.source);
    await Deno.writeTextFile(
      f.source,
      text.replace(
        'values <- read.csv("data.csv")',
        'Sys.sleep(2)\nvalues <- read.csv("data.csv")',
      ),
    );
    const promise = render(f.directory);
    let started = false;
    for (let tries = 0; tries < 200; tries++) {
      if (await count(f.directory) === 2) {
        started = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(started, "Quarto did not start the chunk");
    await rejects(() => recoverQuartoRender(f.source), "QUARTO_RENDER_ACTIVE");
    const html = await Deno.readTextFile(f.output);
    const edited = extractDocument(html);
    edited.slides[0].elements[0].x = 77;
    const native = spliceDocument(html, edited);
    await Deno.writeTextFile(f.output, native);
    const result = await promise;
    assert(
      !result.success && result.log.includes("Capture its native Bento edits"),
      result.log,
    );
    assert(await Deno.readTextFile(f.output) === native);
    const recovered = await recoverQuartoRender(f.source);
    assert(!recovered.restored && recovered.retainedOutput === f.output);
    assert(
      await Deno.readTextFile(f.output) === native,
      "recovery replaced native edits",
    );
    await captureProject(f.source);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("preflight refuses disposable stage aliases to the final deck", async () => {
  const f = await fixture();
  try {
    assert((await render(f.directory)).success);
    const original = await Deno.readTextFile(f.output);
    const stage = resolve(f.directory, "presentation.qbento-stage.html");
    for (const hard of [false, true]) {
      await Deno.remove(stage);
      if (hard) await Deno.link(f.output, stage);
      else await Deno.symlink(f.output, stage);
      const result = await render(f.directory);
      assert(
        !result.success && result.log.includes("UNSAFE_STAGE_PATH"),
        result.log,
      );
      assert(await Deno.readTextFile(f.output) === original);
      assert(await count(f.directory) === 1);
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
