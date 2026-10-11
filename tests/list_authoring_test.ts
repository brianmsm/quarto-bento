import { applySync, previewSync } from "../src/core/sync.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { patchAgentDeck } from "../src/core/agent.ts";
import { canonical } from "../src/state/mod.ts";
import { applyStructure, previewStructure } from "../src/source/structure.ts";
import { scanSource } from "../src/source/mod.ts";
const eq = (a: unknown, b: unknown) => {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
};
const ok = (a: unknown) => {
  if (!a) throw new Error("assertion failed");
};
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if ((e as { code?: string }).code === code || String(e).includes(code)) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
const front = "---\nengine: knitr\nqbento-annotations: none\n---\n\n";
const counter =
  '\n\n```{r}\n#| include: false\ncat("x",file="executions.txt",append=TRUE)\n```\n';
async function fixture(body: string) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-list-author-" }),
    source = dir + "/deck.qmd",
    original = front + body + counter;
  await Deno.writeTextFile(source, original);
  const state = (await renderProject(source)).state;
  return { dir, source, original, state };
}
Deno.test("new lists on existing and agent-created slides preserve separate native identities after reviewed sync", async () => {
  const f = await fixture("## A {#a}\n\n::: {#body}\nOriginal.\n:::\n");
  try {
    const doc = structuredClone(f.state.emitted),
      prototype = doc.slides[0].elements[1];
    doc.slides[0].elements.push({
      ...prototype,
      id: "new-list",
      html: "<ul><li>Uno <b>β</b></li><li>Dos</li></ul>",
      x: 341,
    });
    let state = await saveProject(f.source, doc, f.state.revision);
    eq(await Deno.readTextFile(f.source), f.original);
    eq((await readProject(f.source)).emitted, doc);
    let plan = await previewSync(f.source);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    await applySync(f.source, plan);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    state = (await renderProject(f.source)).state;
    eq(state.pending.length, 0);
    eq(
      state.emitted.slides[0].elements.find((e) => e.id === "new-list")?.x,
      341,
    );
    const slide = {
      ...structuredClone(state.emitted.slides[0]),
      id: "created",
      elements: [{
        ...state.emitted.slides[0].elements[0],
        id: "created-title",
        html: "Nueva lista",
      }, {
        ...prototype,
        id: "created-list-1",
        html: "<ul><li>A</li><li>B</li></ul>",
        x: 211,
      }, {
        ...prototype,
        id: "created-list-2",
        html: "<ul><li>C</li><li>D</li></ul>",
        x: 611,
      }],
    };
    const before = await Deno.readTextFile(f.source);
    await patchAgentDeck(f.source, {
      version: 1,
      docId: state.docId,
      expectedRevision: state.revision,
      operations: [{
        op: "slide.create",
        slideId: "created",
        afterId: "a",
        slide,
      }],
    });
    eq(await Deno.readTextFile(f.source), before);
    plan = await previewSync(f.source);
    eq(
      plan.structure?.operations.find((op) => op.type === "insert-slide")?.type,
      "insert-slide",
    );
    await applySync(f.source, plan);
    state = (await renderProject(f.source)).state;
    eq(state.pending.length, 0);
    eq(
      state.emitted.slides[1].elements.map((e) => e.id),
      slide.elements.map((e) => e.id),
    );
    eq(
      state.emitted.slides[1].elements.slice(1).map((e) => e.html),
      slide.elements.slice(1).map((e) => e.html),
    );
    await Deno.remove(f.dir + "/deck.bento.html");
    eq((await renderProject(f.source)).state.emitted, state.emitted);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("paragraph to list and back preserve QMD producer, source boundaries and native geometry", async () => {
  for (
    const body of [
      "## A\n\nPlain **β**.\n",
      "## A {#a}\n\n::: {#body}\nPlain **β**.\n:::\n",
      '## A {#a}\n\n::: {#body x="181"}\nPlain **β**.\n:::\n',
      "## A {#a}\n\n<!-- qb:body -->\nPlain **β**.\n",
    ]
  ) {
    const f = await fixture(body);
    try {
      let state = f.state;
      const id = state.emitted.slides[0].elements[1].id;
      for (
        const html of [
          "<ol><li>Uno <b>β</b></li><li>Dos</li></ol>",
          "Texto <i>recuperado</i>.",
        ]
      ) {
        const before = await Deno.readTextFile(f.source),
          doc = structuredClone(state.emitted),
          element = doc.slides[0].elements.find((e) => e.id === id)!;
        element.html = html;
        element.x = 392;
        element.fontSize = 30;
        state = await saveProject(f.source, doc, state.revision);
        eq(await Deno.readTextFile(f.source), before);
        const executed = await Deno.readTextFile(f.dir + "/executions.txt");
        const plan = await previewSync(f.source);
        eq(
          plan.structure?.operations.filter((op) => op.type === "convert-text")
            .length,
          1,
        );
        ok(plan.identityBindings?.some((b) => b.target.elementId === id));
        eq(await Deno.readTextFile(f.dir + "/executions.txt"), executed);
        const fake = structuredClone(plan);
        fake.result = before;
        await refuses(() => applySync(f.source, fake), "INVALID_PLAN");
        eq(await Deno.readTextFile(f.source), before);
        await applySync(f.source, plan);
        eq(await Deno.readTextFile(f.dir + "/executions.txt"), executed);
        state = (await renderProject(f.source)).state;
        eq(state.pending.length, 0);
        const retained = state.emitted.slides[0].elements.find((e) =>
          e.id === id
        )!;
        eq([retained.html, retained.x, retained.fontSize], [html, 392, 30]);
        eq(
          scanSource(await Deno.readTextFile(f.source)).blocks.filter((b) =>
            b.kind === "chunk"
          ).map((b) => b.raw),
          scanSource(f.original).blocks.filter((b) => b.kind === "chunk").map(
            (b) => b.raw,
          ),
        );
      }
      await Deno.remove(f.dir + "/deck.bento.html");
      eq((await renderProject(f.source)).state.emitted, state.emitted);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
Deno.test("list deletion retains pending edits for restore and requires exact confirmation before source removal", async () => {
  const f = await fixture(
    "## A {#a}\n\n::: {#list}\n- Uno\n- Dos\n:::\n\n::: {#keep}\nKeep.\n:::\n",
  );
  try {
    let doc = structuredClone(f.state.emitted);
    doc.slides[0].elements[1].html =
      "<ul><li>Pendiente β</li><li>Dos</li></ul>";
    doc.slides[0].elements[1].x = 299;
    let state = await saveProject(f.source, doc, f.state.revision);
    const retained = structuredClone(doc);
    doc.slides[0].elements = doc.slides[0].elements.filter((e) =>
      e.id !== "list/list:1"
    );
    state = await saveProject(f.source, doc, state.revision);
    let deletion = state.pending.find((p) => p.kind === "delete-element")!;
    ok(deletion);
    await refuses(() => previewSync(f.source), "CONFIRM_DELETE_REQUIRED");
    eq(await Deno.readTextFile(f.source), f.original);
    await applyReconcile(f.source, await previewReconcile(f.source), [{
      changeId: deletion.id,
      action: "keep-source",
    }]);
    state = await readProject(f.source);
    eq(state.emitted, retained);
    ok(state.pending.length);
    doc = structuredClone(state.emitted);
    doc.slides[0].elements = doc.slides[0].elements.filter((e) =>
      e.id !== "list/list:1"
    );
    state = await saveProject(f.source, doc, state.revision);
    deletion = state.pending.find((p) => p.kind === "delete-element")!;
    const plan = await previewSync(f.source, undefined, {
      confirmedDeleteIds: [deletion.id],
    });
    ok(!plan.result.includes("#list}"));
    const receipt = await applySync(f.source, plan);
    eq(await Deno.readTextFile(receipt.sourceBackup), f.original);
    state = (await renderProject(f.source)).state;
    eq(state.pending.length, 0);
    eq(state.emitted.slides[0].elements.map((e) => e.id), [
      "a-title",
      "keep/paragraph:1",
    ]);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("list authoring refuses computed edits, executable insertions, mixed HTML and stale source without losing pending state", async () => {
  const f = await fixture(
    "## A {#a}\n\n::: {#body}\nLiteral.\n:::\n\n::: {#computed}\n- Value `r 2+3`\n:::\n",
  );
  try {
    for (
      const html of [
        "<ul><li><code>r 99</code></li></ul>",
        "<ul><li>A</li></ul><p>Other block</p>",
        '<ul start="2"><li>A</li></ul>',
      ]
    ) {
      let state = await readProject(f.source);
      const doc = structuredClone(f.state.emitted);
      doc.slides[0].elements.push({
        ...doc.slides[0].elements[1],
        id: "new-list",
        html,
      });
      state = await saveProject(f.source, doc, state.revision);
      const bytes = await Deno.readTextFile(f.dir + "/.qbento/state.json");
      await refuses(() => previewSync(f.source), "Error");
      eq(await Deno.readTextFile(f.source), f.original);
      eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), bytes);
      eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    }
    let state = await readProject(f.source),
      doc = structuredClone(f.state.emitted);
    doc.slides[0].elements.find((e) => e.id === "computed/list:1")!.html =
      "Converted computed value.";
    state = await saveProject(f.source, doc, state.revision);
    await refuses(() => previewSync(f.source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(f.source), f.original);
    doc = structuredClone(f.state.emitted);
    doc.slides[0].elements.find((e) => e.id === "body/paragraph:1")!.html =
      "<ul><li>Safe</li><li>List</li></ul>";
    state = await saveProject(f.source, doc, state.revision);
    const plan = await previewSync(f.source);
    await Deno.writeTextFile(
      f.source,
      f.original.replace("Literal.", "Externally modified."),
    );
    await refuses(() => applySync(f.source, plan), "STALE_SOURCE");
    await refuses(() => previewSync(f.source), "AMBIGUOUS_IDENTITY");
    eq((await readProject(f.source)).emitted, doc);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("plain list deletion reviews identity and removes only the selected unit retaining unrelated source", async () => {
  const f = await fixture(
    "## Plain heading\n\n- Uno β\n- Dos\n\nUnchanged paragraph.\n",
  );
  try {
    const doc = structuredClone(f.state.emitted),
      id = doc.slides[0].elements[1].id;
    doc.slides[0].elements = doc.slides[0].elements.filter((e) => e.id !== id);
    const state = await saveProject(f.source, doc, f.state.revision),
      deletion = state.pending.find((p) => p.kind === "delete-element")!;
    await refuses(() => previewSync(f.source), "CONFIRM_DELETE_REQUIRED");
    const plan = await previewSync(f.source, undefined, {
      confirmedDeleteIds: [deletion.id],
    });
    ok(!plan.result.includes("- Uno"));
    ok(plan.result.includes("Unchanged paragraph."));
    await applySync(f.source, plan);
    const rendered = await renderProject(f.source);
    eq(rendered.state.pending.length, 0);
    eq(
      rendered.state.emitted.slides[0].elements.map((e) => e.id),
      doc.slides[0].elements.map((e) => e.id),
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("conversion retains explicit child marker inside a styled wrapper without adding conflicting native binding", async () => {
  const f = await fixture(
    '## A {#a}\n\n::: {#body x="181"}\n<!-- qb:child -->\nLiteral.\n:::\n',
  );
  try {
    let state = f.state;
    for (
      const html of ["<ul><li>One</li><li>Two</li></ul>", "Paragraph again."]
    ) {
      const doc = structuredClone(state.emitted);
      const element = doc.slides[0].elements.find((e) => e.id === "child")!;
      element.html = html;
      element.x = 311;
      state = await saveProject(f.source, doc, state.revision);
      const plan = await previewSync(f.source);
      ok(plan.result.includes("<!-- qb:child -->"));
      ok(!plan.result.includes('bento-element-id="child"'));
      await applySync(f.source, plan);
      state = (await renderProject(f.source)).state;
      eq(state.pending.length, 0);
      eq(
        state.emitted.slides[0].elements.find((e) => e.id === "child")?.html,
        html,
      );
      eq(
        state.emitted.slides[0].elements.find((e) => e.id === "child")?.x,
        311,
      );
    }
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("structural conversion preserves CRLF and rejects component, shared, computed and forged source plans", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const text =
        ('## A {#a}\n\n::: {#body x="181"}\nLiteral β.\n:::\n\n<!-- qb-producer:chunk@123 -->\n```{r}\n1+1\n```\n')
          .replaceAll("\n", newline),
      doc = scanSource(text);
    const op = {
      type: "convert-text" as const,
      blockId: "body/paragraph:1",
      expected: "Literal β.",
      markdown: "- One\n- Two",
      from: "paragraph" as const,
      to: "list" as const,
      nativeId: "body/paragraph:1",
    };
    const plan = previewStructure(doc, [op]);
    eq(applyStructure(text, plan), plan.result);
    ok(plan.result.includes('bento-element-id="body/paragraph:1"'));
    eq(
      scanSource(plan.result).blocks.filter((b) => b.kind === "chunk").map(
        (b) => b.raw,
      ),
      doc.blocks.filter((b) => b.kind === "chunk").map((b) => b.raw),
    );
    if (newline === "\r\n") {
      eq(plan.result.replaceAll("\r\n", "").includes("\n"), false);
    }
    const forged = structuredClone(plan);
    forged.operations[0] = { ...op, nativeId: "wrong" };
    await refuses(
      () => applyStructure(text, forged),
      "invalid-preview",
    );
    for (
      const body of [
        "::: {#body .bento-card}\nLiteral β.\n:::\n",
        "::: {#body}\nLiteral β.\n\nOther.\n:::\n",
        "::: {#body}\nComputed `r 1+1`.\n:::\n",
      ]
    ) {
      await refuses(
        () => previewStructure(scanSource("## A {#a}\n\n" + body), [op]),
        "Error",
      );
    }
  }
});
