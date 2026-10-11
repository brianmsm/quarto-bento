import { parseNativeList, renderList } from "../src/render/lists.ts";
import { previewPatches, scanSource } from "../src/source/mod.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
const eq = (a: unknown, b: unknown) => {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
};
const ok = (a: unknown) => {
  if (!a) throw new Error("assertion failed");
};
async function refuses(fn: () => unknown, match: string) {
  try {
    await fn();
  } catch (e) {
    if ((e as { code?: string }).code === match || String(e).includes(match)) {
      return;
    }
    throw e;
  }
  throw new Error("Expected " + match);
}
Deno.test("native list codec preserves nested rich leaves and rejects lossy or unsafe structure", async () => {
  const html =
    '<ul><li>Primero <b>β</b><ol><li><code>fit(x)</code></li><li><a href="https://example.org/x">Fuente</a></li></ol></li><li>Segundo</li></ul>';
  eq(parseNativeList(html), {
    html,
    markdown:
      "- Primero **β**\n  1. `fit(x)`\n  2. [Fuente](<https://example.org/x>)\n- Segundo",
  });
  for (
    const bad of [
      '<ol start="2"><li>a</li></ol>',
      '<ul><li value="3">a</li></ul>',
      '<ul><li><img src="x"></li></ul>',
      "<ul><li><script>x</script></li></ul>",
      "<ul><li>a</li></ul><p>outside</p>",
      "<ul><li></li></ul>",
      "<ul><li><b>a</li></ul>",
      "<ul><li>a<ul><li>b</li></ul>tail</li></ul>",
    ]
  ) await refuses(() => parseNativeList(bad), "Error");
  for (
    const attrs of [[2, { t: "Decimal" }, { t: "Period" }], [1, {
      t: "LowerAlpha",
    }, { t: "Period" }], [1, { t: "Decimal" }, { t: "OneParen" }]]
  ) {
    await refuses(() =>
      renderList({
        t: "OrderedList",
        c: [attrs, [[{ t: "Plain", c: [{ t: "Str", c: "x" }] }]]],
      }), "UNSUPPORTED_LIST");
  }
});
Deno.test("original list proofs preserve CRLF Unicode and reject computed fragments", async () => {
  const text =
    "## Lista β\r\n\r\n- Uno **útil**\r\n  - Niño\r\n- Dos\r\n\r\nDespués.\r\n";
  const doc = scanSource(text);
  eq(doc.blocks.map((b) => b.kind), ["heading", "list", "paragraph"]);
  const list = doc.blocks[1], proof = await readSourceInline(doc);
  eq(
    proof.get(list.id)?.html,
    "<ul><li>Uno <b>útil</b><ul><li>Niño</li></ul></li><li>Dos</li></ul>",
  );
  const patched = previewPatches(doc, [{
    blockId: list.id,
    replacement: "- Cambio β\n- Dos",
  }]);
  eq(
    patched.result,
    "## Lista β\r\n\r\n- Cambio β\r\n- Dos\r\n\r\nDespués.\r\n",
  );
  const dynamic = scanSource("## A\n\n- Valor `r 1+1`\n");
  eq(dynamic.blocks[1].origin, "computed");
  eq((await readSourceInline(dynamic)).has(dynamic.blocks[1].id), false);
  await refuses(
    () =>
      previewPatches(doc, [{
        blockId: list.id,
        replacement: "- Valor `r 1+1`",
      }]),
    "computed-replacement",
  );
});
Deno.test("real lists save reopen reviewed identities recompute and HTML-free rebuild preserve design", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-lists-" }),
    source = dir + "/deck.qmd";
  try {
    const original =
      "---\nqbento-annotations: none\n---\n\n## Listas β\n\n- Uno **útil**\n  - Niño\n- Dos\n\n::: {#ordered}\n\n1. Paso primero\n2. Paso segundo\n\n:::\n";
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    const list = edited.slides[0].elements.find((e) =>
      String(e.html).startsWith("<ul>")
    )!;
    const ordered = edited.slides[0].elements.find((e) =>
      String(e.html).startsWith("<ol>")
    )!;
    ok(list);
    ok(ordered);
    list.html =
      "<ul><li>Uno <b>editado β</b><ul><li>Niño nuevo</li></ul></li><li>Tres</li></ul>";
    list.x = 241;
    list.w = 782;
    list.fontSize = 31;
    ordered.html =
      "<ol><li>Paso <i>revisado</i></li><li>Paso segundo</li><li>Final</li></ol>";
    const saved = await saveProject(source, edited, first.state.revision);
    eq(saved.pending.length, 2);
    eq(await Deno.readTextFile(source), original);
    const reopened = await readProject(source);
    eq(reopened.emitted, edited);
    const plan = await previewSync(source);
    eq(plan.identityBindings?.length, 2);
    eq(await Deno.readTextFile(source), original);
    ok(plan.result.includes("- Uno **editado β**\n  - Niño nuevo\n- Tres"));
    ok(plan.result.includes("1. Paso *revisado*\n2. Paso segundo\n3. Final"));
    await applySync(source, plan);
    const second = await renderProject(source);
    eq(second.state.pending.length, 0);
    eq(second.state.docId, first.state.docId);
    const regenerated = second.state.emitted.slides[0].elements.find((e) =>
      e.id === list.id
    )!;
    eq([regenerated.html, regenerated.x, regenerated.w, regenerated.fontSize], [
      list.html,
      241,
      782,
      31,
    ]);
    await Deno.remove(dir + "/deck.bento.html");
    const rebuilt = await renderProject(source);
    eq(rebuilt.state.emitted, second.state.emitted);
    eq(rebuilt.state.docId, first.state.docId);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("lists reject changed execution projection and computed inline reverse mapping", async () => {
  for (
    const body of [
      "- Resultado `r 1 + 1`",
      "2. Segundo\n3. Tercero",
      "- Uno\n\n  ```r\n  print(1)\n  ```",
    ]
  ) {
    const dir = await Deno.makeTempDir({ prefix: "qbento-list-refusal-" }),
      source = dir + "/deck.qmd";
    try {
      const original = "---\nengine: knitr\n---\n\n## A\n\n" + body + "\n";
      await Deno.writeTextFile(source, original);
      await refuses(() => renderProject(source), "Error");
      eq(await Deno.readTextFile(source), original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("loose lists with multiple paragraphs and nesting round-trip through Pandoc", async () => {
  const markdown =
    "- Primero **β**\n\n  Segundo párrafo.\n\n  1. Hijo\n  2. Otro\n\n  Último párrafo.\n\n- Final\n";
  const document = scanSource(markdown),
    proof = await readSourceInline(document),
    html = proof.get(document.blocks[0].id)!.html;
  const expected =
    "<ul><li><p>Primero <b>β</b></p><p>Segundo párrafo.</p><ol><li>Hijo</li><li>Otro</li></ol><p>Último párrafo.</p></li><li><p>Final</p></li></ul>";
  eq(html, expected);
  const converted = parseNativeList(html);
  eq(converted.html, expected);
  const result = scanSource(converted.markdown);
  eq((await readSourceInline(result)).get(result.blocks[0].id)?.html, expected);
  const different = scanSource("- Viñeta\n\n1. Número\n2. Otro\n");
  eq(different.blocks.map((b) => b.kind), ["list", "list"]);
  eq((await readSourceInline(different)).size, 2);
});
Deno.test("identified computed lists remain computed; unsafe edits and stale source retain pending data", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-list-guards-" }),
    source = dir + "/deck.qmd";
  const original =
    "---\nengine: knitr\nqbento-annotations: none\n---\n\n## Guardas {#guards}\n\n::: {#authored}\n\n- Uno\n- Dos\n\n:::\n\n::: {#computed}\n\n- Resultado `r 2 + 3`\n\n:::\n";
  try {
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    const computed = first.state.emitted.slides[0].elements.find((e) =>
      e.id === "computed/list:1"
    )!;
    ok(computed);
    eq(computed.html, "<ul><li>Resultado 5</li></ul>");
    eq(
      first.state
        .provenance[targetKey({ slideId: "guards", elementId: computed.id })]
        .origin,
      "computed",
    );
    const changed = structuredClone(first.state.emitted);
    changed.slides[0].elements.find((e) => e.id === computed.id)!.html =
      "<ul><li>Resultado 999</li></ul>";
    const saved = await saveProject(source, changed, first.state.revision);
    ok(saved.pending.length);
    eq(saved.pending[0].origin, "computed");
    eq(saved.pending[0].status, "conflict");
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), original);
    eq((await readProject(source)).emitted, changed);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("list sync refuses executable text, non-roundtripping formatting, stale source and tampered plans without writes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-list-conflicts-" }),
    source = dir + "/deck.qmd";
  const original =
    "---\nqbento-annotations: none\n---\n\n## Guardas {#guards}\n\n::: {#authored}\n\n- Uno\n- Dos\n\n:::\n";
  try {
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    for (
      const html of [
        '<ul><li><span style="color:red">Texto</span></li></ul>',
        "<ul><li><code>r 1 + 1</code></li></ul>",
        "<ul><li><b><i>Nested</i></b></li></ul>",
        "<ul><li><p>Single loose item</p></li></ul>",
      ]
    ) {
      const changed = structuredClone(first.state.emitted);
      changed.slides[0].elements.find((e) => e.id === "authored/list:1")!.html =
        html;
      const current = await readProject(source);
      const saved = await saveProject(source, changed, current.revision);
      const bytes = await Deno.readTextFile(dir + "/.qbento/state.json");
      await refuses(() => previewSync(source), "Error");
      eq(await Deno.readTextFile(source), original);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), bytes);
      eq((await readProject(source)).pending, saved.pending);
    }
    const changed = structuredClone(first.state.emitted);
    changed.slides[0].elements.find((e) => e.id === "authored/list:1")!.html =
      "<ul><li>Válido</li><li>Dos</li></ul>";
    await saveProject(source, changed, (await readProject(source)).revision);
    const plan = await previewSync(source);
    const tampered = structuredClone(plan);
    tampered.result = original;
    await refuses(() => applySync(source, tampered), "INVALID_PLAN");
    eq(await Deno.readTextFile(source), original);
    await Deno.writeTextFile(
      source,
      original.replace("- Uno", "- Fuente editada"),
    );
    await refuses(() => previewSync(source), "SOURCE_CONFLICT");
    eq((await readProject(source)).emitted, changed);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("executed list transformations and task checkbox semantics refuse publication", async () => {
  for (const transformed of [true, false]) {
    const dir = await Deno.makeTempDir({ prefix: "qbento-list-transform-" }),
      source = dir + "/deck.qmd";
    try {
      const original = "---\nqbento-annotations: none\n" +
        (transformed ? "filters: [rewrite.lua]\n" : "") +
        "---\n\n## A {#a}\n\n::: {#list}\n\n" +
        (transformed ? "- Original\n- Dos" : "- [ ] Pendiente\n- [x] Hecho") +
        "\n\n:::\n";
      await Deno.writeTextFile(source, original);
      if (transformed) {
        await Deno.writeTextFile(
          dir + "/rewrite.lua",
          'function BulletList(el) el.content[1][1].content = pandoc.Inlines({pandoc.Str("Altered")}); return el end\n',
        );
      }
      await refuses(
        () => renderProject(source),
        transformed ? "UNMAPPED_PROVENANCE" : "UNSUPPORTED_LIST",
      );
      eq(await Deno.readTextFile(source), original);
      await refuses(() => Deno.stat(dir + "/deck.bento.html"), "NotFound");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});
