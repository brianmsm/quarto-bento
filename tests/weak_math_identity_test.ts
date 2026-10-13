import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import {
  applyIdentities,
  previewIdentities,
} from "../src/source/identities.ts";
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
Deno.test("weak display math identity rejects collisions, component scopes and modified plans", async () => {
  const text = "## Test\n\n$$\nx^{2}+1\n$$\n";
  const source = scanSource(text),
    math = source.blocks.find((b) => b.kind === "math")!;
  const request = {
    blockId: math.id,
    sourceId: "equation",
    nativeId: "qb-math-1",
    title: false,
  };
  const plan = previewIdentities(source, [request]);
  eq(
    scanSource(plan.result).blocks.find((b) => b.kind === "math")!.content,
    math.content,
  );
  await refuses(
    () => previewIdentities(source, [request, request]),
    "ambiguous-identity",
  );
  const tampered = structuredClone(plan);
  tampered.requests[0].nativeId = "forged";
  await refuses(() => applyIdentities(text, tampered), "invalid-identity-plan");
  await refuses(() => applyIdentities(text + "\n", plan), "stale-source");
  const nested = scanSource(
    "## Test\n\n::: {#card .bento-card}\n\n$$\nx^{2}+1\n$$\n\n:::\n",
  );
  await refuses(
    () =>
      previewIdentities(nested, [{
        ...request,
        blockId: nested.blocks.find((b) => b.kind === "math")!.id,
      }]),
    "ambiguous-identity",
  );
});
Deno.test({
  name:
    "ordinary weak math survives selected prose sync, notes, formula sync and HTML-free rebuild",
  ignore: (await Deno.permissions.query({ name: "run" })).state !== "granted",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-weak-math-" }),
      source = dir + "/deck.qmd";
    try {
      const producer =
        "```{r}\r\n#| label: counter\r\n#| include: false\r\ncat('x', file='executions.txt', append=TRUE)\r\n```\r\n";
      const original =
        "---\r\nengine: knitr\r\nqbento-annotations: none\r\n---\r\n\r\n## Test β 😀\r\n\r\nOrdinary paragraph.\r\n\r\n$$\r\nx^{2}+1\r\n$$\r\n\r\n" +
        producer;
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      const math = edited.slides[0].elements.find((e) =>
          String(e.html).startsWith("$$")
        )!,
        para = edited.slides[0].elements.find((e) =>
          e.html === "Ordinary paragraph."
        )!;
      para.html = "Revised paragraph β.";
      math.html = "$$x^{3}+2$$";
      math.x = 237;
      math.y = 298;
      math.color = "#123456";
      edited.slides[0].notes = "Notas β 😀.";
      const saved = await saveProject(source, edited, first.state.revision);
      eq(await Deno.readTextFile(source), original);
      const pending = await renderProject(source);
      eq(pending.state.emitted, edited);
      eq(await Deno.readTextFile(source), original);
      const selected = saved.pending.filter((c) =>
        c.target.elementId === para.id || c.path?.[0] === "notes"
      ).map((c) => c.id);
      const plan = await previewSync(source, selected);
      eq(plan.identities?.requests.length, 3);
      eq(plan.excludedChangeIds.length, 1);
      eq(plan.result.includes(producer), true);
      eq(plan.result.replaceAll("\r\n", "").includes("\n"), false);
      await applySync(source, plan);
      const second = await renderProject(source);
      eq(second.state.emitted, edited);
      eq(second.state.pending.length, 1);
      const mathPlan = await previewSync(source);
      await applySync(source, mathPlan);
      const third = await renderProject(source);
      eq(third.state.pending.length, 0);
      eq(third.state.emitted, edited);
      eq((await Deno.readTextFile(source)).includes(producer), true);
      const fresh = dir + "/rebuild";
      await Deno.mkdir(fresh + "/.qbento", { recursive: true });
      await Deno.copyFile(source, fresh + "/deck.qmd");
      await Deno.copyFile(
        dir + "/.qbento/state.json",
        fresh + "/.qbento/state.json",
      );
      const rebuilt = await renderProject(fresh + "/deck.qmd");
      eq(rebuilt.state.docId, first.state.docId);
      eq(rebuilt.state.emitted, edited);
      eq(rebuilt.state.pending.length, 0);
      eq((await readProject(source)).emitted, edited);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "ordinary displayed code binds exact fence and language through reviewed sync and rebuild",
  ignore: (await Deno.permissions.query({ name: "run" })).state !== "granted",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-weak-code-" }),
      source = dir + "/deck.qmd";
    try {
      const original =
        "## Code β\n\nOrdinary paragraph.\n\n```r\nx <- 1\n```\n\n```python\nx <- 1\n```\n";
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      const para = edited.slides[0].elements.find((e) =>
        e.html === "Ordinary paragraph."
      )!;
      const code = edited.slides[0].elements.find((e) =>
        e.type === "code" && e.grammarName === "r"
      )!;
      para.html = "Updated prose.";
      code.content = "x <- 2\n# β";
      code.x = 341;
      code.fontSize = 27;
      const saved = await saveProject(source, edited, first.state.revision);
      eq(await Deno.readTextFile(source), original);
      const plan = await previewSync(
        source,
        saved.pending.filter((c) => c.target.elementId === para.id).map((c) =>
          c.id
        ),
      );
      eq(plan.identities?.requests.length, 4);
      eq(plan.excludedChangeIds.length, 1);
      const forged = structuredClone(plan);
      forged.identityBindings!.find((b) => b.expectedCode)!.expectedCode!
        .grammarName = "python";
      forged.planHash = hashSource(
        canonical(Object.fromEntries(
          Object.entries(forged).filter(([key]) => key !== "planHash"),
        )),
      );
      await refuses(() => applySync(source, forged), "INVALID_PLAN");
      eq(await Deno.readTextFile(source), original);
      await applySync(source, plan);
      const second = await renderProject(source);
      eq(second.state.emitted, edited);
      eq(second.state.pending.length, 1);
      const codePlan = await previewSync(source);
      await applySync(source, codePlan);
      const third = await renderProject(source);
      eq(third.state.emitted, edited);
      eq(third.state.pending.length, 0);
      const fresh = dir + "/rebuilt";
      await Deno.mkdir(fresh + "/.qbento", { recursive: true });
      await Deno.copyFile(source, fresh + "/deck.qmd");
      await Deno.copyFile(
        dir + "/.qbento/state.json",
        fresh + "/.qbento/state.json",
      );
      const rebuilt = await renderProject(fresh + "/deck.qmd");
      eq(rebuilt.state.emitted, edited);
      eq(rebuilt.state.docId, first.state.docId);
      await Deno.mkdir(dir + "/ambiguous");
      await Deno.writeTextFile(
        dir + "/ambiguous/deck.qmd",
        "## Test\n\n```r\nx <- 1\n```\n\n```r\nx <- 1\n```\n",
      );
      await refuses(
        () => renderProject(dir + "/ambiguous/deck.qmd"),
        "UNMAPPED_PROVENANCE",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "displayed code provenance refuses altered language, content and cross-slide binding",
  ignore: (await Deno.permissions.query({ name: "run" })).state !== "granted",
  fn: async () => {
    const { readSourceInline } = await import("../src/render/source-inline.ts");
    const { projectAst, validateProjectionOrigins } = await import(
      "../src/render/project.ts"
    );
    const source = scanSource(
      "## First {#first}\n\n```r\nx <- 1\n```\n\n## Second {#second}\n",
    );
    const proof = await readSourceInline(source);
    const projected = await projectAst(
      {
        meta: {},
        blocks: [
          {
            t: "Header",
            c: [2, ["first", [], []], [{ t: "Str", c: "First" }]],
          },
          { t: "CodeBlock", c: [["", ["r"], []], "x <- 1"] },
          {
            t: "Header",
            c: [2, ["second", [], []], [{ t: "Str", c: "Second" }]],
          },
        ],
      },
      "doc",
      [],
    );
    validateProjectionOrigins(source, projected, proof);
    for (const field of ["grammarName", "content"]) {
      const forged = structuredClone(projected);
      forged.document.slides[0].elements[1][field] = "forged";
      await refuses(
        () => validateProjectionOrigins(source, forged, proof),
        "UNMAPPED_PROVENANCE",
      );
    }
    const moved = structuredClone(projected),
      code = moved.document.slides[0].elements.pop()!;
    moved.document.slides[1].elements.push(code);
    moved.origins.second[code.id] = moved.origins.first[code.id];
    delete moved.origins.first[code.id];
    await refuses(
      () => validateProjectionOrigins(source, moved, proof),
      "UNMAPPED_PROVENANCE",
    );
  },
});
