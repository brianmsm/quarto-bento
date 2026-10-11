import { scanSource, sliceBytes, SourceError } from "../src/source/mod.ts";
import { applyStructure, previewStructure } from "../src/source/structure.ts";
import type { StructureOperation } from "../src/source/structure.ts";
function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
function fails(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof SourceError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const fixture =
  '---\r\ntitle: "Éxito 😀"\r\n---\r\n\r\n## Uno {#one}\r\n\r\nβ = .32\r\n\r\n## Dos {#two}\r\n\r\n```{r}\r\n#| label: fig-values\r\nplot(1:3)\r\n```\r\n\r\n';
Deno.test("insert authored slide with explicit identities and preserve all original UTF8/CRLF bytes", () => {
  const preview = previewStructure(scanSource(fixture), [{
    type: "insert-slide",
    id: "new",
    title: "Nuevo β 😀",
    body: "Primer párrafo.\n\nSegundo.",
    afterId: "one",
  }]);
  const result = applyStructure(fixture, preview), doc = scanSource(result);
  eq(doc.slides.map((s) => s.id), ["one", "new", "two"]);
  const inserted = doc.slides.find((s) => s.id === "new")!;
  eq(result.replace(sliceBytes(result, inserted.span), ""), fixture);
  eq(
    doc.blocks.filter((b) => b.id.startsWith("new-text")).map(
      (b) => [b.id, b.content, b.stable],
    ),
    [["new-text-1", "Primer párrafo.", true], ["new-text-2", "Segundo.", true]],
  );
  eq(
    result.includes("\n") && result.replace(/\r\n/g, "").includes("\n"),
    false,
  );
});
Deno.test("reordering authored and single computed slides preserves section bytes and producer order", () => {
  const doc = scanSource(fixture),
    preamble = sliceBytes(fixture, doc.preambleSpan);
  const result = applyStructure(
    fixture,
    previewStructure(doc, [{ type: "reorder-slides", ids: ["two", "one"] }]),
  );
  eq(
    result,
    preamble + sliceBytes(fixture, doc.slides[1].span) +
      sliceBytes(fixture, doc.slides[0].span),
  );
  eq(scanSource(result).slides.map((s) => s.id), ["two", "one"]);
});
Deno.test("reordering multiple executable producers refuses changed relative execution order", () => {
  const source =
    "## A {#a}\n\n```{r}\n#| label: setup\nx=1\n```\n\n## B {#b}\n\n```{r}\n#| label: output\nprint(x)\n```\n\n";
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "reorder-slides",
        ids: ["b", "a"],
      }]),
    "execution-order",
  );
});
Deno.test("inline computations participate in dependency protection", () => {
  const source =
    "## A {#a}\n\n```{r}\nx=1\n```\n\n## B {#b}\n\nValue `r x`.\n\n";
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "reorder-slides",
        ids: ["b", "a"],
      }]),
    "execution-order",
  );
});
Deno.test("delete requires confirmation, refuses computed producers and cross references", () => {
  const doc = scanSource(fixture);
  fails(
    () =>
      previewStructure(doc, [
        {
          type: "delete-slide",
          id: "one",
          confirmed: false,
        } as unknown as StructureOperation,
      ]),
    "confirmation-required",
  );
  fails(
    () =>
      previewStructure(doc, [{
        type: "delete-slide",
        id: "two",
        confirmed: true,
      }]),
    "unsafe-delete",
  );
  const source = "## A {#a}\n\nText.\n\n## B {#b}\n\nSee @a and [slide](#a).\n";
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "delete-slide",
        id: "a",
        confirmed: true,
      }]),
    "shared-reference",
  );
  const result = applyStructure(
    fixture,
    previewStructure(doc, [{
      type: "delete-slide",
      id: "one",
      confirmed: true,
    }]),
  );
  eq(
    result,
    sliceBytes(fixture, doc.preambleSpan) +
      sliceBytes(fixture, doc.slides[1].span),
  );
});
Deno.test("identity pinning changes only inserted comment bytes and survives later edits", () => {
  const source =
    "## Uno\r\n\r\nTexto β 😀.\r\n\r\n## Dos {#two}\r\n\r\nOtro.\r\n";
  const doc = scanSource(source),
    heading = doc.blocks[0],
    paragraph = doc.blocks[1];
  const operations: StructureOperation[] = [{
    type: "pin-identities",
    bindings: [{ blockId: heading.id, id: "one" }, {
      blockId: paragraph.id,
      id: "body",
    }],
  }];
  const pinned = applyStructure(source, previewStructure(doc, operations));
  eq(
    pinned.replace("<!-- qb:one -->\r\n", "").replace(
      "<!-- qb:body -->\r\n",
      "",
    ),
    source,
  );
  eq(scanSource(pinned).blocks.slice(0, 2).map((b) => [b.id, b.stable]), [[
    "one",
    true,
  ], ["body", true]]);
  const reordered = applyStructure(
    pinned,
    previewStructure(scanSource(pinned), [{
      type: "reorder-slides",
      ids: ["two", "one"],
    }]),
  );
  eq(scanSource(reordered).slides.map((s) => s.id), ["two", "one"]);
  eq(reordered.includes("<!-- qb:one -->\r\n## Uno"), true);
});
Deno.test("insert refuses heading/fence/frontmatter/comment injections and duplicate source identities", () => {
  const doc = scanSource(fixture);
  for (
    const body of [
      "## Injected",
      "```{r}\n42\n```",
      "<!-- qb:stolen -->\nText",
      "---\ntitle: x\n---",
      "::: {.card}\nText\n:::",
      "Text\n\n`r 42`",
    ]
  ) {
    fails(() =>
      previewStructure(doc, [{
        type: "insert-slide",
        id: "new",
        title: "Title",
        body,
      }]), "invalid-slide");
  }
  for (const title of ["A\n## Injected", "A ###", "`r 42`", "A {#stolen}"]) {
    fails(
      () =>
        previewStructure(doc, [{
          type: "insert-slide",
          id: "new",
          title,
          body: "Text",
        }]),
      "invalid-slide",
    );
  }
  fails(
    () =>
      previewStructure(doc, [{
        type: "insert-slide",
        id: "one",
        title: "Duplicate",
        body: "Text",
      }]),
    "duplicate-id",
  );
  const collision = scanSource("## A {#a}\n\n<!-- qb:new-text-1 -->\nText\n");
  fails(
    () =>
      previewStructure(collision, [{
        type: "insert-slide",
        id: "new",
        title: "Title",
        body: "Text",
      }]),
    "duplicate-id",
  );
});
Deno.test("stale and tampered structural previews refuse", () => {
  const preview = previewStructure(scanSource(fixture), [{
    type: "insert-slide",
    id: "new",
    title: "Title",
    body: "Text",
  }]);
  fails(() => applyStructure(fixture + "\r\n", preview), "stale-source");
  const changed = structuredClone(preview);
  changed.steps[0].edits[0].span.start--;
  fails(() => applyStructure(fixture, changed), "invalid-preview");
});
Deno.test("incomplete/duplicate slide orders and unpinned identities refuse", () => {
  const doc = scanSource(fixture);
  for (const ids of [["one"], ["one", "one"], ["one", "missing"]]) {
    fails(
      () => previewStructure(doc, [{ type: "reorder-slides", ids }]),
      "invalid-order",
    );
  }
  const unpinned = scanSource("## A\n\nText\n");
  fails(
    () =>
      previewStructure(unpinned, [{
        type: "reorder-slides",
        ids: [unpinned.slides[0].id],
      }]),
    "unstable-slide",
  );
});
Deno.test("source without terminal newline cannot silently merge headings when reordered", () => {
  const source = "## A {#a}\n\nText\n\n## B {#b}\n\nLast";
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "reorder-slides",
        ids: ["b", "a"],
      }]),
    "ambiguous-boundary",
  );
});
Deno.test("pinning nested div and child preserves meaningful content and rejects duplicate bindings", () => {
  const source = "## A {#a}\n\n::: {.card}\nBody.\n:::\n";
  const doc = scanSource(source),
    div = doc.blocks.find((b) => b.kind === "div")!,
    body = doc.blocks.find((b) => b.kind === "paragraph")!;
  const result = applyStructure(
    source,
    previewStructure(doc, [{
      type: "pin-identities",
      bindings: [{ blockId: div.id, id: "card" }, {
        blockId: body.id,
        id: "body",
      }],
    }]),
  );
  eq(scanSource(result).blocks.map((b) => b.id), ["a", "card", "body"]);
  eq(
    result.replace("<!-- qb:card -->\n", "").replace("<!-- qb:body -->\n", ""),
    source,
  );
  fails(
    () =>
      previewStructure(doc, [{
        type: "pin-identities",
        bindings: [{ blockId: body.id, id: "one" }, {
          blockId: body.id,
          id: "two",
        }],
      }]),
    "duplicate-id",
  );
});
Deno.test("created slide preserves explicitly supplied native title and paragraph IDs", () => {
  const source = "## Existing {#existing}\n\nText.\n";
  const result = applyStructure(
    source,
    previewStructure(scanSource(source), [{
      type: "insert-slide",
      id: "native-slide",
      title: "Native title",
      titleElementId: "native-title",
      body: "First.\n\nSecond.",
      bodyIds: ["native-first", "native-second"],
    }]),
  );
  eq(
    result.includes(
      '## Native title {#native-slide bento-title-id="native-title"}',
    ),
    true,
  );
  eq(
    scanSource(result).blocks.filter((b) => b.kind === "paragraph").map((b) =>
      b.id
    ).slice(-2),
    ["native-first", "native-second"],
  );
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "insert-slide",
        id: "new",
        title: "T",
        body: "Body",
        titleElementId: 'bad" injected="yes',
        bodyIds: ["body"],
      }]),
    "invalid-id",
  );
  fails(
    () =>
      previewStructure(scanSource(source), [{
        type: "insert-slide",
        id: "new",
        title: "T",
        body: "Body",
        bodyIds: ["one", "two"],
      }]),
    "invalid-slide",
  );
});
Deno.test("native template visual IDs can repeat across slides without duplicate semantic IDs", () => {
  const source = "## Original {#original}\n\nText.\n";
  const operations: StructureOperation[] = ["first", "second"].map((id) => ({
    type: "insert-slide",
    id,
    title: id,
    titleElementId: "ltc-title",
    body: `${id} body.`,
    bodyElementIds: ["ltc-body"],
  }));
  const result = applyStructure(
    source,
    previewStructure(scanSource(source), operations),
  );
  const doc = scanSource(result);
  eq(doc.diagnostics, []);
  eq(doc.blocks.filter((b) => b.parentId).map((b) => b.id), [
    "first-text-1/paragraph:1",
    "second-text-1/paragraph:1",
  ]);
  eq(result.split('bento-element-id="ltc-body"').length - 1, 2);
  fails(() =>
    previewStructure(scanSource(source), [{
      type: "insert-slide",
      id: "bad",
      title: "Bad",
      body: "A.\n\nB.",
      bodyElementIds: ["same", "same"],
    }]), "duplicate-id");
});
