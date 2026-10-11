import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (String(e).includes(code) || (e as { code?: string }).code === code) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "displayed code syncs exact CRLF content and reviewed minimal annotation without execution",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-displayed-code-" });
    try {
      const source = dir + "/deck.qmd";
      const original =
        '## Example {#example}\r\n\r\n```{#shown .r font-size="20"}\r\nfile.create("must-not-exist")\r\nx <- 1\r\n```\r\n';
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        code = first.state.emitted.slides[0].elements[1];
      eq(code.type, "code");
      eq(code.grammarName, "r");
      eq(code.fontSize, 20);
      eq(code.content, 'file.create("must-not-exist")\nx <- 1');
      await refuses(() => Deno.stat(dir + "/must-not-exist"), "No such file");
      const edited = structuredClone(first.state.emitted);
      const changed = 'file.create("must-not-exist")\nx <- 2\n';
      edited.slides[0].elements[1].content = changed;
      edited.slides[0].elements[1].x = 220;
      edited.slides[0].elements[1].fontSize = 22;
      const saved = await saveProject(source, edited, first.state.revision);
      eq(saved.pending.length, 2);
      const plan = await previewSync(source);
      eq(plan.patch.patches.length, 1);
      eq(plan.attributes!.patches.length, 1);
      eq(plan.annotations.level, "minimal");
      eq(plan.annotations.patches.length, 1);
      eq(plan.annotations.patches[0].blockId, "example");
      eq(plan.annotations.patches[0].replacement, " .qbento-design");
      eq(plan.annotations.diagnostics, []);
      eq(
        plan.result,
        original.replace("{#example}", "{#example .qbento-design}").replace(
          'font-size="20"',
          'font-size="22"',
        ).replace(
          "x <- 1\r\n",
          "x <- 2\r\n\r\n",
        ),
      );
      await applySync(source, plan);
      const final = await renderProject(source);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].elements[1].content, changed);
      eq(final.state.emitted.slides[0].elements[1].x, 220);
      await refuses(() => Deno.stat(dir + "/must-not-exist"), "No such file");
      const malicious = structuredClone(final.state.emitted);
      malicious.slides[0].elements[1].content =
        '```\n```{r}\nfile.create("must-not-exist")\n```';
      await saveProject(source, malicious, final.state.revision);
      await refuses(() => previewSync(source), "structural-replacement");
      eq(await Deno.readTextFile(source), plan.result);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "echoed executable code stays computed and cannot be synchronized as displayed source",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-code-provenance-" });
    try {
      const source = dir + "/deck.qmd";
      const original =
        "## Results {#results}\n\n```{r}\n#| label: producer\n#| echo: true\nx <- 1\n```\n";
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted),
        code = edited.slides[0].elements.find((e) => e.type === "code")!;
      eq(
        first.state
          .provenance[targetKey({ slideId: "results", elementId: code.id })]
          .origin,
        "computed",
      );
      code.content = "x <- 999";
      const saved = await saveProject(source, edited, first.state.revision);
      eq(saved.pending[0].origin, "computed");
      await refuses(() => previewSync(source), "SYNC_CONFLICT");
      eq(await Deno.readTextFile(source), original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test("an unlabeled executed cell requires one exact original echoed producer, never a guess", async () => {
  const { projectAst, validateProjectionOrigins } = await import(
    "../src/render/project.ts"
  );
  const { scanSource } = await import("../src/source/mod.ts");
  const ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["results", [], []], [{ t: "Str", c: "Results" }]],
    }, {
      t: "Div",
      c: [["", ["cell"], []], [{
        t: "CodeBlock",
        c: [["", ["r", "cell-code"], []], "x <- 1"],
      }]],
    }],
  };
  const source = scanSource(
    "## Results {#results}\n\n```{r}\n#| label: producer\nx <- 1\n```\n",
  );
  const projected = validateProjectionOrigins(
    source,
    await projectAst(ast, "doc", [], source),
  );
  eq(projected.origins.results["producer/code:1"].producer, "producer");
  eq(projected.origins.results["producer/code:1"].origin, "computed");
  for (
    const text of [
      source.text.replace("x <- 1", "x <- 2"),
      source.text + "\n```{r}\n#| label: other\nx <- 1\n```\n",
    ]
  ) {
    await refuses(
      () => projectAst(ast, "doc", [], scanSource(text)),
      "UNMAPPED_PROVENANCE",
    );
  }
});
